// Federano: every second (and on play/pause/seek/resize), tells the Federano agent on this PC where the playing video
// is inside the browser window, so the tablet mirror shows just the video. On YouTube it also sends the video id and
// time (for "abrir no YouTube do tablet"). On other sites nothing but the rectangle is sent: no address, no title.
(() => {
  const onYouTube = /(^|\.)youtube\.com$/.test(location.hostname);
  const youTubeId = () => {
    const u = new URL(location.href);
    if (u.pathname === '/watch') return u.searchParams.get('v');
    const m = u.pathname.match(/^\/(?:shorts|live|embed)\/([A-Za-z0-9_-]{11})/);
    return m ? m[1] : null;
  };

  // the biggest visible video on the page, playing ones first
  function mainVideo() {
    let best = null, bestScore = 0;
    for (const v of document.querySelectorAll('video')) {
      const r = v.getBoundingClientRect();
      const area = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
      if (area < 20000) continue;
      const score = area * (v.paused ? 1 : 10);
      if (score > bestScore) { best = v; bestScore = score; }
    }
    return best;
  }

  // the video's rectangle in the window, in physical pixels (what the PC's window capture sees)
  function windowRect(v) {
    const r = v.getBoundingClientRect();
    const dpr = devicePixelRatio || 1;
    if (document.fullscreenElement) return { x: 0, y: 0, w: Math.round(screen.width * dpr), h: Math.round(screen.height * dpr) };
    const border = Math.max(0, (outerWidth - innerWidth) / 2);           // window frame, left and right
    const top = Math.max(0, outerHeight - innerHeight - border);          // tabs + address bar
    return { x: Math.round((border + r.left) * dpr), y: Math.round((top + r.top) * dpr), w: Math.round(r.width * dpr), h: Math.round(r.height * dpr) };
  }

  function report() {
    if (document.visibilityState !== 'visible') return;   // a hidden tab is not on screen
    const v = mainVideo();
    if (!v) return;
    const id = onYouTube ? youTubeId() : null;
    if (v.paused && !id) return;
    const msg = { type: 'federano-video', playing: !v.paused, ...windowRect(v) };
    if (id && /^[A-Za-z0-9_-]{11}$/.test(id)) {
      msg.v = id; msg.t = Math.max(0, v.currentTime || 0);
      msg.title = (document.title || '').replace(/^\(\d+\)\s*/, '').replace(/\s*-\s*YouTube$/, '');
    }
    try {
      chrome.runtime.sendMessage(msg, (answer) => {
        if (chrome.runtime.lastError) return;
        if (answer && answer.pause && !v.paused) v.pause();
      });
    } catch (_) { /* extension reloaded: this page's script is orphaned until the tab reloads */ }
  }

  setInterval(report, 1000);
  for (const e of ['play', 'pause', 'seeked']) document.addEventListener(e, report, true);
  addEventListener('resize', report);
  document.addEventListener('fullscreenchange', () => setTimeout(report, 300));
})();
