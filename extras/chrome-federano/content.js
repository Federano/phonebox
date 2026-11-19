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
    const msg = { type: 'federano-video', playing: !v.paused };
    if (id && /^[A-Za-z0-9_-]{11}$/.test(id)) {
      msg.v = id; msg.t = Math.max(0, v.currentTime || 0);
      msg.title = (document.title || '').replace(/^\(\d+\)\s*/, '').replace(/\s*-\s*YouTube$/, '');
    }
    try {
      chrome.runtime.sendMessage(msg, (answer) => {
        if (chrome.runtime.lastError || !answer) return;
        if (answer.pause && !v.paused) v.pause();
        if (answer.mirror && !mirroring) startMirror();
        else if (!answer.mirror && mirroring) stopMirror();
      });
    } catch (_) { stopMirror(); /* extension reloaded: this page's script is orphaned until the tab reloads */ }
  }

  // ---------------------------------------------------------------- frames of this tab's video
  let timer = 0, busy = false, canvas = null, ctx = null, tainted = false;

  function startMirror() {
    if (tainted) return;
    mirroring = true;
    try {
      port = chrome.runtime.connect({ name: 'federano-frames' });
      port.onMessage.addListener((m) => { if (m && m.mirror === false) stopMirror(); else if (m && m.ready) busy = false; });
      port.onDisconnect.addListener(() => { port = null; stopMirror(); });
    } catch (_) { mirroring = false; return; }
    // a tab playing sound is not throttled by Chrome, even in the background
    timer = setInterval(sendFrame, Math.round(1000 / FPS));
  }

  function stopMirror() {
    mirroring = false;
    clearInterval(timer); timer = 0; busy = false;
    if (port) { try { port.disconnect(); } catch (_) {} port = null; }
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
      const scale = Math.min(1, MAX_W / v.videoWidth);
      const w = Math.round(v.videoWidth * scale), h = Math.round(v.videoHeight * scale);
      if (!canvas || canvas.width !== w || canvas.height !== h) { canvas = new OffscreenCanvas(w, h); ctx = canvas.getContext('2d', { alpha: false }); }
      ctx.drawImage(v, 0, 0, w, h);
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: QUALITY });
      const b64 = await toBase64(blob);
      if (port) port.postMessage({ frame: b64 }); else busy = false;   // "ready" from the worker frees the next frame
    } catch (e) {
      busy = false;
      // a video from another site without permission (or protected, like Netflix) cannot be read: give up on it
      if (e && e.name === 'SecurityError') { tainted = true; stopMirror(); }
    }
  }

  setInterval(report, 1000);
  for (const e of ['play', 'pause', 'loadeddata']) document.addEventListener(e, report, true);
})();
