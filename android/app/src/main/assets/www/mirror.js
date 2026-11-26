import { API, PANEL_HEADERS, bridge, gotoSkillPage, haptic, toast } from './main.js';

// ---------------------------------------------------------------- Federano mirroring
// Full-screen view of the PC's video, live. The agent captures the player's window (cropped to the video in a browser)
// and the panel pulls JPEG frames: two requests in flight keep the link busy, each waiting for a frame newer than the
// last one shown. Sound stays on the PC. Tap ✕ (or the back gesture) to close.
// Tap the picture to show the controls: play/pause, back/forward 10 s, next, a progress bar to jump, the PC's volume
// and a microphone for short voice commands. They drive the PC's player through the agent's media API
// (/api/media/*, /api/volume, /api/skills/run) — the same one the media widget uses.

const SVG = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><rect x="6.5" y="5" width="4" height="14" rx="1.2" fill="currentColor"/><rect x="13.5" y="5" width="4" height="14" rx="1.2" fill="currentColor"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M12 5a7 7 0 1 1-6.6 9.3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M12 2.2v5.6L8.2 5z" fill="currentColor"/><text x="12" y="15.6" text-anchor="middle" font-size="6.6" font-weight="700" fill="currentColor" font-family="system-ui,sans-serif">10</text></svg>',
  fwd: '<svg viewBox="0 0 24 24"><path d="M12 5a7 7 0 1 0 6.6 9.3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M12 2.2v5.6L15.8 5z" fill="currentColor"/><text x="12" y="15.6" text-anchor="middle" font-size="6.6" font-weight="700" fill="currentColor" font-family="system-ui,sans-serif">10</text></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M6 5.5v13l9-6.5z" fill="currentColor"/><rect x="16" y="5.5" width="2.6" height="13" rx="1" fill="currentColor"/></svg>',
  vol: '<svg viewBox="0 0 24 24"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  muted: '<svg viewBox="0 0 24 24"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M16 9.5l5 5M21 9.5l-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  mic: '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
};

const clock = (ms) => {
  const s = Math.max(0, Math.floor((ms || 0) / 1000));
  const mm = Math.floor(s / 60) % 60, ss = String(s % 60).padStart(2, '0');
  return s >= 3600 ? `${Math.floor(s / 3600)}:${String(mm).padStart(2, '0')}:${ss}` : `${Math.floor(s / 60)}:${ss}`;
};
const post = (path) => fetch(`${API}${path}`, { method: 'POST', cache: 'no-store', headers: PANEL_HEADERS });

// voice: the app's speech recognizer reports to window.onAndroidSpeech; ours is chained in front of the widgets' ones
let micSession = 0, micHandler = null, speechHooked = false;
function hookSpeech() {
  if (speechHooked) return;
  speechHooked = true;
  const prev = window.onAndroidSpeech;
  window.onAndroidSpeech = (kind, text, id) => {
    if (micSession && id === micSession && micHandler) micHandler(kind, text);
    else if (prev) prev(kind, text, id);
  };
}

let overlay = null;

export function openMirror(title) {
  if (overlay) { overlay.restore(); return; }
  const img = document.createElement('img');
  img.className = 'mirror-img';
  img.alt = '';
  const close = document.createElement('button');
  close.className = 'mirror-close';
  close.textContent = '✕';
  const mini = document.createElement('button');
  mini.className = 'mirror-mini';
  mini.title = 'Minimizar (vira uma bolinha)';
  mini.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19h14M8 9l4 4 4-4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const label = document.createElement('div');
  label.className = 'mirror-label';
  label.textContent = title || 'Espelhando o PC';
  const fps = document.createElement('div');
  fps.className = 'mirror-fps';
  const el = document.createElement('div');
  el.className = 'mirror';
  const ctl = controls();
  el.append(img, label, fps, ctl.el, mini, close);
  document.body.append(el);

  // ---- floating bubble while minimized: live thumbnail, drag it anywhere, tap to come back
  const bubble = document.createElement('div');
  bubble.className = 'mirror-bubble';
  bubble.title = 'Voltar ao vídeo do PC';
  const icon = document.createElement('div');
  icon.className = 'mirror-bubble-icon';
  icon.innerHTML = '<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="8" y="16" width="48" height="32" rx="10" fill="#e62117"/><path d="M27 24.5v15l13-7.5z" fill="#fff"/></svg>';
  const bx = document.createElement('button');
  bx.className = 'mirror-bubble-x';
  bx.textContent = '✕';
  bubble.append(icon, bx);
  let minimized = false;
  const pos = (() => { try { return JSON.parse(localStorage.getItem('federano.bubble') || 'null'); } catch (_) { return null; } })() || { x: innerWidth - 150, y: innerHeight - 190 };
  const place = () => {
    pos.x = Math.max(8, Math.min(innerWidth - 128, pos.x)); pos.y = Math.max(8, Math.min(innerHeight - 128, pos.y));
    bubble.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
  };
  let drag = null, pressTimer = 0;
  // the bubble keeps its touches: the panel must not also take them as a page swipe or tap
  for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'touchstart', 'touchmove', 'touchend', 'click', 'mousedown', 'mouseup'])
    bubble.addEventListener(t, (e) => e.stopPropagation());
  bubble.addEventListener('pointerdown', (e) => {
    if (e.target === bx) return;
    e.preventDefault();
    drag = { sx: e.clientX, sy: e.clientY, x: pos.x, y: pos.y, moved: false };
    bubble.setPointerCapture(e.pointerId);
    bubble.classList.add('held');
    pressTimer = setTimeout(() => { if (drag && !drag.moved) { drag = null; haptic(); stop(); } }, 900);   // long press: close
  });
  bubble.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (Math.abs(dx) + Math.abs(dy) > 8) { drag.moved = true; clearTimeout(pressTimer); }
    pos.x = drag.x + dx; pos.y = drag.y + dy; place();
  });
  bubble.addEventListener('pointerup', () => {
    clearTimeout(pressTimer);
    bubble.classList.remove('held');
    if (!drag) return;
    const tapped = !drag.moved;
    drag = null;
    // snap to the nearest side
    pos.x = pos.x + 60 < innerWidth / 2 ? 16 : innerWidth - 136; place();
    try { localStorage.setItem('federano.bubble', JSON.stringify(pos)); } catch (_) {}
    if (tapped) restore();
  });
  bx.onclick = (e) => { e.stopPropagation(); haptic(); stop(); };

  function minimize() {
    if (minimized) return;
    minimized = true;
    el.classList.add('hidden');
    place();
    document.body.append(bubble);
    requestAnimationFrame(() => bubble.classList.add('in'));
  }
  async function restore() {
    if (!minimized) return;
    minimized = false;
    bubble.classList.remove('in');
    setTimeout(() => bubble.remove(), 250);
    el.classList.remove('hidden');
    el.classList.remove('chrome');
    showChrome();
    // the PC may have paused the mirror while the tablet was elsewhere: start it again (same tab, nothing asked)
    fetch(`${API}/mirror/start`, { method: 'POST', cache: 'no-store', headers: PANEL_HEADERS }).catch(() => {});
  }
  window.federanoRestoreMirror = () => { if (overlay) overlay.restore(); };

  let alive = true, shown = 0, want = 0, lastUrl = '', frames = 0, lastOk = performance.now();
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
  const hideChrome = () => { clearTimeout(hideTimer); el.classList.remove('chrome'); };
  const showChrome = () => {
    const was = el.classList.contains('chrome');
    el.classList.add('chrome');
    clearTimeout(hideTimer);
    // the controls stay while a slider is held or the microphone listens
    const later = () => { hideTimer = setTimeout(() => (ctl.busy() ? later() : el.classList.remove('chrome')), 4000); };
    later();
    if (!was) ctl.refresh();
  };
  showChrome();
  // a tap on the picture shows the controls, another one hides them; touching a control keeps them up
  el.addEventListener('click', (e) => {
    if (e.target !== img && e.target !== el && e.target !== label && e.target !== ctl.el) return;
    if (el.classList.contains('chrome')) hideChrome(); else showChrome();
  });
  ctl.el.addEventListener('pointerdown', () => showChrome());

  // ---- the controls: state from GET /api/mirror/controls while they are on screen; the position runs on locally
  function controls() {
    const box = document.createElement('div');
    box.className = 'mirror-ctl';
    // the panel must not take a slider drag as a page swipe
    for (const t of ['pointerdown', 'pointermove', 'pointerup', 'touchstart', 'touchmove', 'touchend', 'mousedown', 'mouseup'])
      box.addEventListener(t, (e) => e.stopPropagation());
    const btn = (cls, svg, title) => {
      const b = document.createElement('button');
      b.className = 'mc-btn ' + cls; b.innerHTML = svg; b.title = title; b.setAttribute('aria-label', title);
      return b;
    };
    const back = btn('mc-back', SVG.back, 'Voltar 10 segundos');
    const play = btn('mc-play', SVG.pause, 'Play / pausa');
    const fwd = btn('mc-fwd', SVG.fwd, 'Avançar 10 segundos');
    const next = btn('mc-next', SVG.next, 'Próximo vídeo');
    const center = document.createElement('div');
    center.className = 'mc-center';
    center.append(back, play, fwd, next);

    const cur = document.createElement('span'); cur.className = 'mc-time'; cur.textContent = '0:00';
    const dur = document.createElement('span'); dur.className = 'mc-time'; dur.textContent = '--:--';
    const seek = document.createElement('input');
    seek.type = 'range'; seek.min = '0'; seek.max = '1000'; seek.value = '0'; seek.className = 'mc-seek'; seek.setAttribute('aria-label', 'Posição do vídeo');
    const mute = btn('mc-mute', SVG.vol, 'Mudo');
    const vol = document.createElement('input');
    vol.type = 'range'; vol.min = '0'; vol.max = '100'; vol.value = '50'; vol.className = 'mc-vol'; vol.setAttribute('aria-label', 'Volume do PC');
    const volN = document.createElement('span'); volN.className = 'mc-voln';
    const canMic = !!(bridge && bridge.listen && bridge.canListen);
    const mic = btn('mc-mic', SVG.mic, 'Falar um comando');
    const volBox = document.createElement('div');
    volBox.className = 'mc-volbox';
    volBox.append(mute, vol, volN);
    const bar = document.createElement('div');
    bar.className = 'mc-bar';
    bar.append(cur, seek, dur, volBox);
    if (canMic) bar.append(mic);
    const said = document.createElement('div');
    said.className = 'mc-said';
    box.append(center, bar, said);

    // media state: the position is counted on from when it was read
    let m = null, at = 0, seeking = false, volHeld = false, listening = false, pollTimer = 0, gen = 0;
    const posNow = () => !m ? 0 : Math.min(m.durMs > 0 ? m.durMs : Infinity, (m.posMs || 0) + (m.ageMs || 0) + (m.playing ? performance.now() - at : 0));
    function draw() {
      if (seeking || !m) return;
      const p = posNow();
      cur.textContent = clock(p);
      seek.value = m.durMs > 0 ? String(Math.round((p / m.durMs) * 1000)) : '0';
      seek.style.setProperty('--p', (Number(seek.value) / 10) + '%');
    }
    const apply = (media) => {
      if (!media) return;
      m = media; at = performance.now();
      play.innerHTML = m.playing ? SVG.pause : SVG.play;
      seek.disabled = !(m.canSeek && m.durMs > 0); back.disabled = !m.canSeek; fwd.disabled = !m.canSeek;
      dur.textContent = m.durMs > 0 ? clock(m.durMs) : '--:--';
      if (m.title) label.textContent = m.title;
      draw();
    };
    const applyAudio = (a) => {
      if (!a || volHeld) return;
      vol.value = String(a.volume);
      vol.style.setProperty('--p', a.volume + '%');
      volN.textContent = a.muted ? 'mudo' : a.volume + '%';
      mute.innerHTML = a.muted ? SVG.muted : SVG.vol;
      volBox.classList.toggle('muted', !!a.muted);
    };
    const ticker = setInterval(() => { if (el.classList.contains('chrome')) draw(); }, 250);

    async function refresh() {
      const my = ++gen;
      clearTimeout(pollTimer);
      if (!alive || minimized || !el.classList.contains('chrome')) return;
      try {
        const r = await fetch(`${API}/mirror/controls`, { cache: 'no-store', headers: PANEL_HEADERS });
        if (r.ok && my === gen) { const j = await r.json(); if (!seeking) apply(j.media); applyAudio(j.audio); }
      } catch (_) {}
      if (my === gen && alive) pollTimer = setTimeout(refresh, 1000);
    }

    async function media(action, q = '', optimistic) {
      haptic();
      if (optimistic) optimistic();
      try {
        const r = await post(`/media/${action}${q}`);
        if (!r.ok) { toast(action.startsWith('seek') ? 'Esse player não deixa pular pelo Windows.' : 'O player do PC não respondeu.', 'err'); refresh(); return; }
        apply((await r.json()).media);
      } catch (_) { toast('Sem conexão com o PC.', 'err'); }
    }
    play.onclick = () => media('playpause', '', () => {
      if (!m) return;
      m = { ...m, posMs: posNow(), ageMs: 0, playing: !m.playing }; at = performance.now();
      play.innerHTML = m.playing ? SVG.pause : SVG.play;
    });
    const jump = (d) => () => media('seekby', `?ms=${d}`, () => {
      if (!m || !m.canSeek) return;
      m = { ...m, posMs: Math.max(0, Math.min(m.durMs > 0 ? m.durMs : Infinity, posNow() + d)), ageMs: 0 }; at = performance.now(); draw();
    });
    back.onclick = jump(-10000);
    fwd.onclick = jump(10000);
    next.onclick = () => { media('next'); setTimeout(refresh, 900); };

    seek.addEventListener('input', () => {
      seeking = true;
      seek.style.setProperty('--p', (Number(seek.value) / 10) + '%');
      if (m && m.durMs > 0) cur.textContent = clock((Number(seek.value) / 1000) * m.durMs);
    });
    seek.addEventListener('change', () => {
      seeking = false;
      if (!m || !(m.durMs > 0)) return;
      const to = Math.round((Number(seek.value) / 1000) * m.durMs);
      media('seek', `?ms=${to}`, () => { m = { ...m, posMs: to, ageMs: 0 }; at = performance.now(); draw(); });
    });

    // volume: sent while the finger moves (at most every 120 ms) and once more where it stops
    let volSent = 0, volLast = -1, volTimer = 0;
    const sendVol = () => {
      const v = Number(vol.value);
      if (v === volLast) return;
      volLast = v; volSent = performance.now();
      post(`/volume?level=${v}`).catch(() => {});
    };
    vol.addEventListener('input', () => {
      volHeld = true;
      vol.style.setProperty('--p', vol.value + '%');
      volN.textContent = vol.value + '%';
      volBox.classList.remove('muted'); mute.innerHTML = SVG.vol;
      clearTimeout(volTimer);
      if (performance.now() - volSent > 120) sendVol(); else volTimer = setTimeout(sendVol, 120);
    });
    vol.addEventListener('change', () => { clearTimeout(volTimer); sendVol(); setTimeout(() => { volHeld = false; volLast = -1; }, 600); });
    mute.onclick = async () => {
      haptic();
      try { const r = await post('/volume?op=mute'); if (r.ok) applyAudio(await r.json()); } catch (_) {}
    };

    // voice: one short command ("pausa", "próximo", "volta 10 segundos", "aumenta o volume") goes to the skills
    let saidTimer = 0;
    const say = (text, keep) => {
      said.textContent = text; said.classList.toggle('in', !!text);
      clearTimeout(saidTimer);
      if (text && !keep) saidTimer = setTimeout(() => said.classList.remove('in'), 3500);
    };
    const micDone = () => { micSession = 0; micHandler = null; listening = false; mic.classList.remove('on'); };
    async function ask(text) {
      say('“' + text + '” …', true);
      try {
        const r = await post(`/skills/run?text=${encodeURIComponent(text)}`);
        const j = await r.json();
        say(j.reply || '—');
        if (j.open && bridge && bridge.openVideo) bridge.openVideo(j.open);
        if (j.page && gotoSkillPage(j.page) >= 0) minimize();
        refresh();
      } catch (_) { say('Não consegui falar com o PC.'); }
    }
    mic.onclick = () => {
      haptic();
      if (!bridge.canListen()) { say('Este aparelho não tem reconhecimento de voz.'); return; }
      if (micSession) { bridge.stopListening(micSession); return; }
      hookSpeech();
      const id = bridge.listen('pt-BR', false) || 0;
      if (!id) return;
      micSession = id; listening = true;
      mic.classList.add('on');
      say('Ouvindo…', true);
      micHandler = (kind, text) => {
        if (kind === 'partial') say(text || 'Ouvindo…', true);
        else if (kind === 'final') { micDone(); if (String(text || '').trim()) ask(String(text).trim()); else say('Não ouvi nada.'); showChrome(); }
        else if (kind === 'error') { micDone(); say(text === 'cancelled' ? '' : 'Não entendi. Toque no microfone de novo.'); showChrome(); }
      };
    };

    return {
      el: box, refresh,
      busy: () => seeking || volHeld || listening,
      stop() {
        clearInterval(ticker); clearTimeout(pollTimer); clearTimeout(volTimer); gen++;
        if (micSession && bridge && bridge.cancelListening) bridge.cancelListening(micSession);
        micDone();
      },
    };
  }

  async function pull(slowLane) {
    while (alive) {
      if (minimized) {
        if (!slowLane) { await new Promise((res) => setTimeout(res, 400)); continue; }
        await new Promise((res) => setTimeout(res, 1200));
      }
      try {
        // pipelined: each request asks for a frame newer than the one the other request is already fetching
        const after = Math.max(shown, want);
        want = after + 1;
        const t0 = performance.now();
        const r = await fetch(`${API}/mirror/frame?after=${after}`, { cache: 'no-store', headers: PANEL_HEADERS });
        if (r.status === 410) {
          if (minimized) { await new Promise((res) => setTimeout(res, 1500)); continue; }   // restore() starts it again
          stop('O espelhamento parou no PC.'); return;
        }
        // no new picture yet (e.g. the next video of a playlist is loading): keep waiting, the PC is still there
        if (r.status !== 200 || (r.headers.get('Content-Type') || '').includes('json')) {
          want = shown;
          if (r.status !== 200 && r.status !== 204) throw new Error('HTTP ' + r.status);
          lastOk = performance.now();
          continue;
        }
        lastOk = performance.now();
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
      } catch (e) {
        // only a PC that stays unreachable for a while closes the mirror (a playlist switching videos does not)
        if (performance.now() - lastOk > 30000) { stop('Perdi a conexão com o PC.'); return; }
        await new Promise((res) => setTimeout(res, 500));
      }
    }
  }

  function stop(message) {
    if (!alive) return;
    alive = false;
    clearInterval(fpsTimer);
    clearTimeout(hideTimer);
    ctl.stop();
    el.remove();
    bubble.remove();
    overlay = null;
    window.federanoRestoreMirror = null;
    if (bridge && bridge.setMirrorBubble) bridge.setMirrorBubble(false);
    if (lastUrl) URL.revokeObjectURL(lastUrl);
    fetch(`${API}/mirror/stop`, { method: 'POST', cache: 'no-store', headers: PANEL_HEADERS }).catch(() => {});
    if (message) toast(message);
  }

  close.onclick = () => { haptic(); stop(); };
  mini.onclick = () => { haptic(); minimize(); };
  overlay = { stop, restore, minimize };
  // the app shows the bubble over other apps while a mirror is open (Android permission "Exibir sobre outros apps")
  if (bridge && bridge.setMirrorBubble) bridge.setMirrorBubble(true);
  pull(true);
  pull(false); // a second request in flight: the next frame is already on its way while one is shown
}

// ---------------------------------------------------------------- "Ver no tablet?" pop-up
// Polls the agent every 2 s; when a video starts on the PC, a card slides in with a countdown ring. No answer in time
// (Settings › Federano, default 5 s) counts as "Agora não": nothing is mirrored and that video is not offered again.
let offerEl = null;

function showOffer(offer) {
  const secs = Math.max(2, Number(offer.seconds) || 10);
  const card = document.createElement('div');
  card.className = 'offer';
  card.style.setProperty('--offer-secs', secs + 's');   // Tema 01: the red line under the card runs out with the countdown
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
  // "Só ouvir": music on YouTube without the picture; the lyrics page shows it like a podcast (title, photo, sound lines)
  const ear = document.createElement('button');
  ear.className = 'offer-no offer-ear';
  ear.textContent = 'Só ouvir';
  const yes = document.createElement('button');
  yes.className = 'offer-yes';
  // countdown ring around the main button
  const R = 26, C = 2 * Math.PI * R;
  yes.innerHTML = `<svg class="offer-ring" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="${R}" class="offer-ring-bg"/>` +
    `<circle cx="32" cy="32" r="${R}" class="offer-ring-fg" style="stroke-dasharray:${C};animation-duration:${secs}s"/></svg>` +
    `<span class="offer-count">${secs}</span><span class="offer-yes-label">Ver no tablet</span>`;
  const count = yes.querySelector('.offer-count');
  card.append(thumb, text, no, ear, yes);
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
      const r = await fetch(`${API}/mirror/offer/answer?id=${encodeURIComponent(offer.id)}&yes=${answer === true}`,
        { method: 'POST', cache: 'no-store', headers: PANEL_HEADERS });
      const j = await r.json();
      if (answer === 'listen') {
        try { localStorage.setItem('federano.listenVideo', '1'); } catch (_) {}
        window.dispatchEvent(new Event('federano-listen'));
        if (gotoSkillPage('lyrics') < 0) toast('Adicione o widget Letra numa página para ouvir assim.', 'err');
      } else if (answer && j.mirror) openMirror(offer.title);
      else if (answer && j.error) toast(j.error, 'err');
    } catch (_) {}
  };
  const timer = setTimeout(() => finish(false), secs * 1000);
  yes.onclick = () => { haptic(); finish(true); };
  no.onclick = () => { haptic(); finish(false); };
  ear.onclick = () => { haptic(); finish('listen'); };
  scrim.onclick = () => finish(false);
}

// while "Só ouvir" is on, the next videos (a YouTube playlist) are not offered again
const listening = () => {
  try { if (localStorage.getItem('federano.listenVideo') === '1') return true; } catch (_) {}
  // the "Só ouvir" screen is in view: that video is already being listened to here
  const ly = document.querySelector('.w.ly.ly-video');
  if (!ly) return false;
  const r = ly.getBoundingClientRect();
  return r.width > 0 && r.left < innerWidth / 2 && r.right > innerWidth / 2;
};
async function pollOffer() {
  if (!overlay && !offerEl && !document.body.classList.contains('night')) {
    try {
      const r = await fetch(`${API}/mirror/offer`, { cache: 'no-store', headers: PANEL_HEADERS });
      if (r.ok) {
        const j = await r.json();
        if (j.open && !overlay) openMirror(j.title);            // started on the PC (Federano icon in Chrome)
        else if (j.offer && !overlay && !offerEl && !listening()) showOffer(j.offer);
      }
    } catch (_) {}
  }
  setTimeout(pollOffer, 2000);
}
setTimeout(pollOffer, 3000);

/** Federano: show the PC's playing video on the tablet now (the "Ver vídeo" button of "Só ouvir"). */
export async function mirrorNow(title) {
  try {
    const j = await fetch(`${API}/mirror/start`, { method: 'POST', cache: 'no-store', headers: PANEL_HEADERS }).then((r) => r.json());
    if (j.ok) openMirror(j.title || title); else toast(j.error || 'Não deu para mostrar o vídeo agora.', 'err');
  } catch (_) { toast('Sem conexão com o PC.', 'err'); }
}

export function closeMirror() { if (overlay) overlay.stop(); }
export const mirrorOpen = () => !!overlay;
