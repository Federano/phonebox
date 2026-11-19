// Federano: every 2 seconds (and on play/pause/seek), tells the Federano agent which YouTube video this tab shows and
// where it is. When the video was taken to the tablet, the agent answers "pause" and the video pauses here.
(() => {
  const videoId = () => {
    const u = new URL(location.href);
    if (u.pathname === '/watch') return u.searchParams.get('v');
    const m = u.pathname.match(/^\/(?:shorts|live|embed)\/([A-Za-z0-9_-]{11})/);
    return m ? m[1] : null;
  };
  const player = () => document.querySelector('video.html5-main-video') || document.querySelector('video');
  const title = () => (document.title || '').replace(/^\(\d+\)\s*/, '').replace(/\s*-\s*YouTube$/, '');

  function report() {
    const v = videoId(), video = player();
    if (!v || !/^[A-Za-z0-9_-]{11}$/.test(v) || !video) return;
    // a background tab with a paused video must not hide the one being watched
    if (video.paused && document.visibilityState !== 'visible') return;
    try {
      chrome.runtime.sendMessage({ type: 'federano-youtube', v, t: Math.max(0, video.currentTime || 0), playing: !video.paused, title: title() },
        (answer) => { if (chrome.runtime.lastError) return; if (answer && answer.pause && !video.paused) video.pause(); });
    } catch (_) { /* extension reloaded: this page's script is orphaned until the tab reloads */ }
  }

  setInterval(report, 2000);
  document.addEventListener('play', report, true);
  document.addEventListener('pause', report, true);
  document.addEventListener('seeked', report, true);
})();
