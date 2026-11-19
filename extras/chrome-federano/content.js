// Federano extension, in each page.
// - Every second, tells the Federano agent on this PC whether this tab plays a video (on YouTube also its id and time,
//   for "abrir no YouTube do tablet"). On other sites nothing is sent but "playing": no address, no title.
// - When the agent answers mirror=true (the tablet asked to mirror and this is the tab that was playing), this page
//   draws its own video into a canvas and sends the frames: only the video, whatever tab or window is in front on the
//   PC. Sound stays on the PC. It follows the next video in the same tab.
(() => {
  const FPS = 25, MAX_W = 1280, QUALITY = 0.78;
  const onYouTube = /(^|\.)youtube\.com$/.test(location.hostname);
  const youTubeId = () => {
    const u = new URL(location.href);
    if (u.pathname === '/watch') return u.searchParams.get('v');
    const m = u.pathname.match(/^\/(?:shorts|live|embed)\/([A-Za-z0-9_-]{11})/);
    return m ? m[1] : null;
  };

  // the biggest video on the page, playing ones first
  function mainVideo() {
    let best = null, bestScore = 0;
    for (const v of document.querySelectorAll('video')) {
      const w = v.videoWidth || v.clientWidth, h = v.videoHeight || v.clientHeight;
      if (w * h < 20000 || v.readyState < 2) continue;
      const score = w * h * (v.paused ? 1 : 10);
      if (score > bestScore) { best = v; bestScore = score; }
    }
    return best;
  }

  let mirroring = false;
  let port = null;

  function report() {
    const v = mainVideo();
    if (!v) { if (mirroring) stopMirror(); return; }
    const id = onYouTube ? youTubeId() : null;
    if (v.paused && !id && !mirroring) return;
    const msg = { type: 'federano-video', playing: !v.paused, rect: videoRect(v) };
    if (id && /^[A-Za-z0-9_-]{11}$/.test(id)) {
      msg.v = id; msg.t = Math.max(0, v.currentTime || 0);
      msg.title = (document.title || '').replace(/^\(\d+\)\s*/, '').replace(/\s*-\s*YouTube$/, '');
    }
    try {
      chrome.runtime.sendMessage(msg, (answer) => {
        if (chrome.runtime.lastError || !answer) return;
        if (answer.pause && !v.paused) v.pause();
        if (answer.mirror && !mirroring) begin();
        else if (!answer.mirror && mirroring) stopMirror();
        else if (answer.tabCapture && pagePipeRunning()) stopPagePipe();   // the tab capture took over
      });
    } catch (_) { stopMirror(); /* extension reloaded: this page's script is orphaned until the tab reloads */ }
  }

  // where the video is in the page, as fractions (the tab capture crops its frames to it)
  function videoRect(v) {
    if (document.fullscreenElement) return { fx: 0, fy: 0, fw: 1, fh: 1 };
    const r = v.getBoundingClientRect();
    if (!innerWidth || !innerHeight) return null;
    const x = Math.max(0, r.left), y = Math.max(0, r.top);
    const w = Math.min(innerWidth, r.right) - x, h = Math.min(innerHeight, r.bottom) - y;
    if (w <= 0 || h <= 0) return null;
    // the picture inside the element (letterboxing), so the tablet shows the picture, not black bars
    let px = x, py = y, pw = w, ph = h;
    if (v.videoWidth && v.videoHeight && w === r.width && h === r.height) {
      const ar = v.videoWidth / v.videoHeight;
      if (w / h > ar) { pw = h * ar; px = x + (w - pw) / 2; } else { ph = w / ar; py = y + (h - ph) / 2; }
    }
    return { fx: px / innerWidth, fy: py / innerHeight, fw: pw / innerWidth, fh: ph / innerHeight };
  }

  // the tablet accepted: the tab capture if Chrome allows it (Federano icon clicked on this tab), else the page draws
  function begin() {
    mirroring = true;
    try {
      chrome.runtime.sendMessage({ type: 'federano-mirror-start' }, (answer) => {
        if (chrome.runtime.lastError) { startMirror(); return; }
        if (!(answer && answer.tabCapture) && mirroring) startMirror();
      });
    } catch (_) { startMirror(); }
  }

  // ---------------------------------------------------------------- frames of this tab's video
  let timer = 0, busy = false, canvas = null, ctx = null, tainted = false;
  let reader = null, readerVideo = null, lastSent = 0;

  function startMirror() {
    if (tainted) return;
    mirroring = true;
    try {
      port = chrome.runtime.connect({ name: 'federano-frames' });
      port.onMessage.addListener((m) => { if (m && m.tabCapture) stopPagePipe(); else if (m && m.mirror === false) stopMirror(); else if (m && m.ready) busy = false; });
      port.onDisconnect.addListener(() => { port = null; stopMirror(); });
    } catch (_) { mirroring = false; return; }
    if (!startFramePipe()) timer = setInterval(sendFrame, Math.round(1000 / FPS));
  }

  // The video's own decoded frames (captureStream + MediaStreamTrackProcessor) drive the capture. Unlike timers, they
  // are not slowed to once a second when the tab is in the background or the window is covered.
  function startFramePipe() {
    const v = mainVideo();
    if (!v || typeof MediaStreamTrackProcessor !== 'function' || typeof v.captureStream !== 'function') return false;
    let track;
    try { track = v.captureStream().getVideoTracks()[0]; } catch (_) { return false; }
    if (!track) return false;
    const r = new MediaStreamTrackProcessor({ track }).readable.getReader();
    reader = r; readerVideo = v;
    (async () => {
      while (mirroring && reader === r) {
        let res;
        try { res = await r.read(); } catch (_) { break; }
        if (res.done) break;
        const frame = res.value;
        const now = performance.now();
        if (busy || !port || now - lastSent < 1000 / FPS) { frame.close(); continue; }
        lastSent = now;
        busy = true;
        try { await encodeAndSend(frame, frame.displayWidth, frame.displayHeight); }
        catch (e) { busy = false; if (e && e.name === 'SecurityError') { tainted = true; stopMirror(); } }
        finally { frame.close(); }
      }
      // the track ended (next video in the same tab): start again on the current video
      if (mirroring && reader === r) { reader = null; readerVideo = null; if (!startFramePipe()) timer = setInterval(sendFrame, Math.round(1000 / FPS)); }
    })();
    return true;
  }

  function stopMirror() {
    mirroring = false;
    stopPagePipe();
  }

  const pagePipeRunning = () => !!(port || timer || reader);

  function stopPagePipe() {
    clearInterval(timer); timer = 0; busy = false;
    if (reader) { try { reader.cancel(); } catch (_) {} reader = null; readerVideo = null; }
    if (port) { try { port.disconnect(); } catch (_) {} port = null; }
  }

  async function encodeAndSend(source, srcW, srcH) {
    const scale = Math.min(1, MAX_W / srcW);
    const w = Math.round(srcW * scale), h = Math.round(srcH * scale);
    if (!canvas || canvas.width !== w || canvas.height !== h) { canvas = new OffscreenCanvas(w, h); ctx = canvas.getContext('2d', { alpha: false }); }
    ctx.drawImage(source, 0, 0, w, h);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: QUALITY });
    const b64 = await toBase64(blob);
    if (port) port.postMessage({ frame: b64 }); else busy = false;   // "ready" from the worker frees the next frame
  }

  function toBase64(blob) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => { const s = String(r.result); res(s.slice(s.indexOf(',') + 1)); };
      r.onerror = rej;
      r.readAsDataURL(blob);
    });
  }

  async function sendFrame() {
    if (busy || !port) return;
    const v = mainVideo();
    if (!v || !v.videoWidth) return;
    busy = true;
    try {
      await encodeAndSend(v, v.videoWidth, v.videoHeight);
    } catch (e) {
      busy = false;
      // a video from another site without permission (or protected, like Netflix) cannot be read: give up on it
      if (e && e.name === 'SecurityError') { tainted = true; stopMirror(); }
    }
  }

  setInterval(report, 1000);
  // the next video in the same tab may be a new <video> element: follow it
  setInterval(() => { if (mirroring && reader && readerVideo && mainVideo() !== readerVideo) { const r = reader; reader = null; try { r.cancel(); } catch (_) {} if (!startFramePipe()) timer = timer || setInterval(sendFrame, Math.round(1000 / FPS)); } }, 1000);
  for (const e of ['play', 'pause', 'loadeddata']) document.addEventListener(e, report, true);
})();
