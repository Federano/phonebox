// Federano extension, offscreen document: receives the mirrored tab as a video stream (chrome.tabCapture). A tab being
// captured keeps rendering at full speed even in the background or behind other windows, unlike a hidden page.
// Each frame is cropped to the video's rectangle, encoded as JPEG and sent to the Federano agent on this PC.
// Video only: the tab's sound keeps playing on the PC as usual.
const AGENT = 'http://127.0.0.1:8775/api';
const FPS = 30, MAX_W = 1280, QUALITY = 0.8;

let session = null;   // { tab, stream, reader, rect }

chrome.runtime.onMessage.addListener((m) => {
  if (!m || m.target !== 'federano-offscreen') return;
  if (m.type === 'start') start(m.streamId, m.tab, m.rect);
  else if (m.type === 'rect' && session && session.tab === m.tab) session.rect = m.rect;
  else if (m.type === 'stop') stop();
});

async function start(streamId, tab, rect) {
  stop();
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId, maxWidth: 2560, maxHeight: 1440, maxFrameRate: FPS } },
    });
  } catch (e) {
    chrome.runtime.sendMessage({ type: 'federano-offscreen-stopped', tab, error: String(e && e.message || e) });
    return;
  }
  const track = stream.getVideoTracks()[0];
  const reader = new MediaStreamTrackProcessor({ track }).readable.getReader();
  const s = { tab, stream, reader, rect: rect || null };
  session = s;
  let canvas = null, ctx = null, busy = false, last = 0;
  // measurements, sent with the frames so the agent can log where time goes
  let got = 0, sent = 0, encMs = 0, postMs = 0, statFrom = performance.now(), stats = '';
  while (session === s) {
    let res;
    try { res = await reader.read(); } catch (_) { break; }
    if (res.done) break;
    const frame = res.value;
    got++;
    const now = performance.now();
    if (now - statFrom >= 2000) {
      const secs = (now - statFrom) / 1000;
      stats = `&src=tab&in=${(got / secs).toFixed(1)}&out=${(sent / secs).toFixed(1)}&enc=${sent ? Math.round(encMs / sent) : 0}&post=${sent ? Math.round(postMs / sent) : 0}&size=${frame.displayWidth}x${frame.displayHeight}&vis=${document.visibilityState}`;
      got = 0; sent = 0; encMs = 0; postMs = 0; statFrom = now;
    }
    if (busy || now - last < 1000 / FPS) { frame.close(); continue; }
    last = now; busy = true;
    try {
      const fw = frame.displayWidth, fh = frame.displayHeight;
      // Chrome fits the tab into the captured frame keeping its shape (black bars around it when the shapes differ):
      // find the tab's area in the frame first, then the video's rectangle in it
      const r = s.rect && s.rect.fw > 0.05 && s.rect.fh > 0.05 ? s.rect : { fx: 0, fy: 0, fw: 1, fh: 1, ar: 0 };
      let cx = 0, cy = 0, cw = fw, ch = fh;
      if (r.ar > 0) {
        if (fw / fh > r.ar) { cw = fh * r.ar; cx = (fw - cw) / 2; } else { ch = fw / r.ar; cy = (fh - ch) / 2; }
      }
      const sx = Math.max(0, Math.round(cx + r.fx * cw)), sy = Math.max(0, Math.round(cy + r.fy * ch));
      const sw = Math.min(fw - sx, Math.round(r.fw * cw)), sh = Math.min(fh - sy, Math.round(r.fh * ch));
      const scale = Math.min(1, MAX_W / sw);
      const w = Math.max(2, Math.round(sw * scale)), h = Math.max(2, Math.round(sh * scale));
      if (!canvas || canvas.width !== w || canvas.height !== h) { canvas = new OffscreenCanvas(w, h); ctx = canvas.getContext('2d', { alpha: false }); }
      const t0 = performance.now();
      ctx.drawImage(frame, sx, sy, sw, sh, 0, 0, w, h);
      frame.close();
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: QUALITY });
      const t1 = performance.now();
      const resp = await fetch(`${AGENT}/mirror/push?tab=${tab}${stats}`, { method: 'POST', body: blob, headers: { 'Content-Type': 'image/jpeg' }, cache: 'no-store' });
      stats = '';
      encMs += t1 - t0; postMs += performance.now() - t1; sent++;
      const j = resp.ok ? await resp.json() : { mirror: false };
      if (j.mirror !== true) { stop(); break; }   // the tablet closed the mirror
    } catch (_) {
      try { frame.close(); } catch (__) {}
    } finally { busy = false; }
  }
  if (session === s) stop();
}

function stop() {
  const s = session;
  session = null;
  if (!s) return;
  try { s.reader.cancel(); } catch (_) {}
  for (const t of s.stream.getTracks()) t.stop();
  chrome.runtime.sendMessage({ type: 'federano-offscreen-stopped', tab: s.tab });
}
