// Federano extension, offscreen document: receives the mirrored tab as a video stream (chrome.tabCapture). A tab being
// captured keeps rendering at full speed even in the background or behind other windows, unlike a hidden page.
// Each frame is cropped to the video's rectangle, encoded as JPEG and sent to the Federano agent on this PC.
// Video only: the tab's sound keeps playing on the PC as usual.
const AGENT = 'http://127.0.0.1:8775/api';
const FPS = 30, MAX_W = 1280, QUALITY = 0.72;

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
  const reader = new MediaStreamTrackProcessor({ track, maxBufferSize: 1 }).readable.getReader();
  const s = { tab, stream, reader, rect: rect || null, started: performance.now() };
  session = s;
  // ask the agent where the video is before the first frame (the page reports it there every second)
  const probe = async () => {
    for (let i = 0; i < 20 && session === s && !s.rect; i++) {
      try {
        const r = await fetch(`${AGENT}/mirror/push?tab=${tab}&probe=true`, { method: 'POST', cache: 'no-store' });
        const j = r.ok ? await r.json() : {};
        if (j.rect) s.rect = j.rect;
      } catch (_) {}
      if (!s.rect) await new Promise((res) => setTimeout(res, 250));
    }
  };
  probe();
  // Federano: two frames can be encoding at once (two workers), so a slow encode no longer halves the frame rate
  let canvas = null, ctx = null, busy = 0, last = 0;
  // measurements, sent with the frames so the agent can log where time goes
  let got = 0, sent = 0, encMs = 0, postMs = 0, statFrom = performance.now(), stats = '';
  while (session === s) {
    let res;
    try { res = await reader.read(); } catch (_) { break; }
    if (res.done) break;
    const frame = res.value;
    const ts = Date.now();
    got++;
    const now = performance.now();
    if (now - statFrom >= 2000) {
      const secs = (now - statFrom) / 1000;
      stats = `&src=tab&in=${(got / secs).toFixed(1)}&out=${(sent / secs).toFixed(1)}&enc=${sent ? Math.round(encMs / sent) : 0}&post=${sent ? Math.round(postMs / sent) : 0}&size=${frame.displayWidth}x${frame.displayHeight}&vis=${document.visibilityState}`;
      got = 0; sent = 0; encMs = 0; postMs = 0; statFrom = now;
    }
    // wait (up to 2 s) for the video rectangle so the tablet never shows the whole page
    // a few ms of slack: the tab sends ~30 frames a second with jitter, and a frame 1 ms early must not be dropped
    if (busy >= 2 || now - last < 1000 / FPS - 6 || (!s.rect && now - s.started < 2000)) { frame.close(); continue; }
    last = now; busy++;
    const mySeq = ++frameSeq;   // counts on across sessions, like sentSeq
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
      const t0 = performance.now();
      const st = stats; stats = '';
      // not awaited: the next frame starts encoding in the other worker meanwhile
      encode(frame, sx, sy, sw, sh, w, h).then((jpeg) => {   // the worker closes the frame
        encMs += performance.now() - t0; sent++;
        // a frame that finished after a newer one is stale: drop it
        if (mySeq < sentSeq) return;
        sentSeq = mySeq;
        // the send runs in parallel with the next encode; only the newest frame waits for the link
        send(s, `${AGENT}/mirror/push?tab=${tab}&ts=${ts}${st}`, jpeg, (ms) => { postMs += ms; });
      }).catch(() => {}).finally(() => { busy--; });
    } catch (_) {
      try { frame.close(); } catch (__) {}
      busy--;
    }
  }
  if (session === s) stop();
}

// One frame on its way to the agent at a time; a newer one waits and replaces any older waiting frame.
let inFlight = false, waiting = null;
function send(s, url, body, onDone) {
  if (inFlight) { waiting = { s, url, body, onDone }; return; }
  inFlight = true;
  const t = performance.now();
  fetch(url, { method: 'POST', body, headers: { 'Content-Type': 'image/jpeg' }, cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : { mirror: false }))
    .then((j) => {
      onDone(performance.now() - t);
      if (j.rect && session === s) s.rect = j.rect;           // where the video is in the tab (from the agent)
      if (j.mirror !== true && session === s) stop();         // the tablet closed it
    })
    .catch(() => {})
    .finally(() => {
      inFlight = false;
      const next = waiting; waiting = null;
      if (next && session === next.s) send(next.s, next.url, next.body, next.onDone);
    });
}

// JPEG encoding in a worker: in this background page Chrome delays canvas encoding by about a second per frame
let workers = [], nextId = 0, sentSeq = 0, frameSeq = 0;
const pending = new Map();
function encode(frame, sx, sy, sw, sh, w, h) {
  if (!workers.length) {
    for (let i = 0; i < 2; i++) {
      const wk = new Worker('encoder.js');
      wk.onmessage = (e) => {
        const p = pending.get(e.data.id);
        if (!p) return;
        pending.delete(e.data.id);
        if (e.data.error) p.reject(new Error(e.data.error)); else p.resolve(e.data.buf);
      };
      workers.push(wk);
    }
  }
  const id = ++nextId, worker = workers[id % workers.length];
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, frame, sx, sy, sw, sh, w, h, quality: QUALITY }, [frame]);
  });
}

function stop() {
  const s = session;
  session = null;
  if (!s) return;
  try { s.reader.cancel(); } catch (_) {}
  for (const t of s.stream.getTracks()) t.stop();
  chrome.runtime.sendMessage({ type: 'federano-offscreen-stopped', tab: s.tab });
}
