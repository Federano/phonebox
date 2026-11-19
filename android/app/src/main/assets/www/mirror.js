import { API, PANEL_HEADERS, haptic, toast } from './main.js';

// ---------------------------------------------------------------- Federano mirroring
// Full-screen view of the PC's video, live. The agent captures the player's window (cropped to the video in a browser)
// and the panel pulls JPEG frames: two requests in flight keep the link busy, each waiting for a frame newer than the
// last one shown. Sound stays on the PC. Tap ✕ (or the back gesture) to close.

let overlay = null;

export function openMirror(title) {
  if (overlay) return;
  const img = document.createElement('img');
  img.className = 'mirror-img';
  img.alt = '';
  const close = document.createElement('button');
  close.className = 'mirror-close';
  close.textContent = '✕';
  const label = document.createElement('div');
  label.className = 'mirror-label';
  label.textContent = title || 'Espelhando o PC';
  const fps = document.createElement('div');
  fps.className = 'mirror-fps';
  const el = document.createElement('div');
  el.className = 'mirror';
  el.append(img, label, fps, close);
  document.body.append(el);

  let alive = true, shown = 0, want = 0, lastUrl = '', frames = 0, failures = 0;
  const fpsTimer = setInterval(() => { fps.textContent = frames + ' fps'; frames = 0; }, 1000);
  let hideTimer = 0;
  const showChrome = () => {
    el.classList.add('chrome');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => el.classList.remove('chrome'), 3000);
  };
  showChrome();
  el.addEventListener('pointerdown', (e) => { if (e.target !== close) showChrome(); });

  async function pull() {
    while (alive) {
      try {
        // pipelined: each request asks for a frame newer than the one the other request is already fetching
        const after = Math.max(shown, want);
        want = after + 1;
        const r = await fetch(`${API}/mirror/frame?after=${after}`, { cache: 'no-store', headers: PANEL_HEADERS });
        if (r.status === 410) { stop('O espelhamento parou no PC.'); return; }
        if (r.status !== 200) { want = shown; if (r.status !== 204) throw new Error('HTTP ' + r.status); continue; }
        const seq = Number(r.headers.get('X-Seq') || 0);
        const blob = await r.blob();
        if (!alive || seq <= shown) continue;
        shown = seq;
        const url = URL.createObjectURL(blob);
        img.src = url;
        if (lastUrl) URL.revokeObjectURL(lastUrl);
        lastUrl = url;
        frames++;
        failures = 0;
      } catch (e) {
        if (++failures > 5) { stop('Perdi a conexão com o PC.'); return; }
        await new Promise((res) => setTimeout(res, 300));
      }
    }
  }

  function stop(message) {
    if (!alive) return;
    alive = false;
    clearInterval(fpsTimer);
    clearTimeout(hideTimer);
    el.remove();
    overlay = null;
    if (lastUrl) URL.revokeObjectURL(lastUrl);
    fetch(`${API}/mirror/stop`, { method: 'POST', cache: 'no-store', headers: PANEL_HEADERS }).catch(() => {});
    if (message) toast(message);
  }

  close.onclick = () => { haptic(); stop(); };
  overlay = { stop };
  pull();
  pull(); // a second request in flight: the next frame is already on its way while one is shown
}

export function closeMirror() { if (overlay) overlay.stop(); }
export const mirrorOpen = () => !!overlay;
