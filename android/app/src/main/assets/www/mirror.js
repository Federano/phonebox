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
  let dl = 0, dlN = 0, statFrames = 0, statFrom = performance.now();
  const fpsTimer = setInterval(() => {
    fps.textContent = frames + ' fps';
    statFrames += frames; frames = 0;
    const secs = (performance.now() - statFrom) / 1000;
    if (secs >= 3) {
      const q = `fetch=${dlN ? Math.round(dl / dlN) : 0}&fps=${(statFrames / secs).toFixed(1)}`;
      fetch(`${API}/mirror/tabletstats?${q}`, { method: 'POST', cache: 'no-store', headers: PANEL_HEADERS }).catch(() => {});
      dl = 0; dlN = 0; statFrames = 0; statFrom = performance.now();
    }
  }, 1000);
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
        const t0 = performance.now();
        const r = await fetch(`${API}/mirror/frame?after=${after}`, { cache: 'no-store', headers: PANEL_HEADERS });
        if (r.status === 410) { stop('O espelhamento parou no PC.'); return; }
        if (r.status !== 200) { want = shown; if (r.status !== 204) throw new Error('HTTP ' + r.status); continue; }
        const seq = Number(r.headers.get('X-Seq') || 0);
        const blob = await r.blob();
        dl += performance.now() - t0; dlN++;
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

// ---------------------------------------------------------------- "Ver no tablet?" pop-up
// Polls the agent every 2 s; when a video starts on the PC, a card slides in with a countdown ring. No answer in time
// (Settings › Federano, default 5 s) counts as "Agora não": nothing is mirrored and that video is not offered again.
let offerEl = null;

function showOffer(offer) {
  const secs = Math.max(2, Number(offer.seconds) || 5);
  const card = document.createElement('div');
  card.className = 'offer';
  const thumb = document.createElement('div');
  thumb.className = 'offer-thumb';
  if (offer.artId) {
    const im = document.createElement('img');
    im.alt = '';
    im.onerror = () => { im.remove(); thumb.textContent = '📺'; };
    im.src = `${API}/art?v=${offer.artId}`;
    thumb.append(im);
  } else thumb.textContent = '📺';
  const text = document.createElement('div');
  text.className = 'offer-text';
  const q = document.createElement('div');
  q.className = 'offer-q';
  q.textContent = 'Ver no tablet?';
  const t = document.createElement('div');
  t.className = 'offer-title';
  t.textContent = offer.title;
  const a = document.createElement('div');
  a.className = 'offer-app';
  a.textContent = offer.app ? 'tocando no PC · ' + offer.app : 'tocando no PC';
  text.append(q, t, a);
  const no = document.createElement('button');
  no.className = 'offer-no';
  no.textContent = 'Agora não';
  const yes = document.createElement('button');
  yes.className = 'offer-yes';
  // countdown ring around the main button
  const R = 26, C = 2 * Math.PI * R;
  yes.innerHTML = `<svg class="offer-ring" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="${R}" class="offer-ring-bg"/>` +
    `<circle cx="32" cy="32" r="${R}" class="offer-ring-fg" style="stroke-dasharray:${C};animation-duration:${secs}s"/></svg>` +
    `<span class="offer-count">${secs}</span><span class="offer-yes-label">Ver no tablet</span>`;
  const count = yes.querySelector('.offer-count');
  card.append(thumb, text, no, yes);
  const scrim = document.createElement('div');
  scrim.className = 'offer-scrim';
  document.body.append(scrim, card);
  requestAnimationFrame(() => { card.classList.add('in'); scrim.classList.add('in'); });
  offerEl = card;

  let left = secs, done = false;
  const tick = setInterval(() => { left -= 1; if (left > 0) count.textContent = String(left); }, 1000);
  const finish = async (answer) => {
    if (done) return;
    done = true;
    clearTimeout(timer); clearInterval(tick);
    card.classList.remove('in'); card.classList.add('out');
    scrim.classList.remove('in');
    setTimeout(() => { card.remove(); scrim.remove(); if (offerEl === card) offerEl = null; }, 450);
    try {
      const r = await fetch(`${API}/mirror/offer/answer?id=${encodeURIComponent(offer.id)}&yes=${answer}`,
        { method: 'POST', cache: 'no-store', headers: PANEL_HEADERS });
      const j = await r.json();
      if (answer && j.mirror) openMirror(offer.title);
      else if (answer && j.error) toast(j.error, 'err');
    } catch (_) {}
  };
  const timer = setTimeout(() => finish(false), secs * 1000);
  yes.onclick = () => { haptic(); finish(true); };
  no.onclick = () => { haptic(); finish(false); };
  scrim.onclick = () => finish(false);
}

async function pollOffer() {
  if (!overlay && !offerEl && !document.body.classList.contains('night')) {
    try {
      const r = await fetch(`${API}/mirror/offer`, { cache: 'no-store', headers: PANEL_HEADERS });
      if (r.ok) {
        const j = await r.json();
        if (j.open && !overlay) openMirror(j.title);            // started on the PC (Federano icon in Chrome)
        else if (j.offer && !overlay && !offerEl) showOffer(j.offer);
      }
    } catch (_) {}
  }
  setTimeout(pollOffer, 2000);
}
setTimeout(pollOffer, 3000);

export function closeMirror() { if (overlay) overlay.stop(); }
export const mirrorOpen = () => !!overlay;
