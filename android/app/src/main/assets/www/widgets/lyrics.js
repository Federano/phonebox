import { API, D, PANEL_HEADERS, api, averageColor, curPage, h, haptic, media as liveMedia, pages, streaming, toast } from '../main.js';
import { W } from '../registry.js';

// ---------------------------------------------------------------- Federano "Letra"
// The song playing on the PC: the lyrics take most of the screen, centred, with the line being sung lit up and kept in
// the middle and a Portuguese translation under each line (switch "Tradução"); a card on the right has the artist's
// photo (Spotify), the song, the controls and the next songs of the queue (tap one to play it). Data: GET /api/lyrics/now (lyrics from LRCLIB and the translation,
// sent once per song). Without timed lyrics the text is shown still.

const clock = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)), p2 = (n) => String(n).padStart(2, '0'); return s >= 3600 ? `${Math.floor(s / 3600)}:${p2(Math.floor(s / 60) % 60)}:${p2(s % 60)}` : `${Math.floor(s / 60)}:${p2(s % 60)}`; };
const LEAD = 350;   // show a line a little before it is sung

// ---- background: the artist's photo blurred behind the lyrics, and many thin lines waving together like fabric. The
// lines follow the PC's sound (the agent's spectrum analyser, the same as the Spectrum bars widget) and take the
// cover's colours. Drawn ~30 times a second, only while the page is on screen.
// st: bass / mid / high (0..1, smoothed), pulse (1 on a beat, fading), act (1 playing .. ~0 paused), ph (phase, moves
// with act so a paused song almost stops the lines), now (ms) and waveAt (ms: a new lyric line started)
function weave(g, W, H, st, cols) {
  g.clearRect(0, 0, W, H);
  const n = 22, s = W / 660, ph = st.ph, t = st.now / 1000;
  const rgb = cols.map((c) => c.split(',').map(Number));
  const waveT = (st.now - st.waveAt) / 1000, waveR = waveT * 520 * s;
  for (let k = 0; k < n; k++) {
    const f = k / (n - 1);                       // 0 = top line, 1 = bottom line
    const y0 = H * (.1 + .85 * f);
    // depth: three layers; near lines sharper, bolder and faster, far ones softer and slower
    const layer = k % 3, depth = [1, .7, .45][layer];
    // the cover's colours drift slowly from line to line
    const ci = (k + t * .35) % rgb.length, c0 = rgb[Math.floor(ci)], c1 = rgb[(Math.floor(ci) + 1) % rgb.length], fr = ci % 1;
    const col = c0.map((v, i) => Math.round(v + (c1[i] - v) * fr)).join(',');
    // the bottom lines follow the bass, the middle ones the voice, the top ones the highs
    const lvl = (f > .6 ? st.bass : f < .35 ? st.high : st.mid) * 1.3;
    const amp = ((6 + 34 * lvl * st.act) * depth) + 4;
    const sp = depth;
    g.beginPath();
    for (let x = 0; x <= W; x += 12 * s) {
      let y = y0 + (Math.sin(x / s * .009 + ph * .9 * sp + k * .35) * amp + Math.sin(x / s * .021 - ph * 1.4 * sp + k * .2) * 6 * depth) * s;
      // a ring of light moving out from the centre when a new lyric line starts
      if (waveT < 1.4) { const d = Math.hypot(x - W / 2, y0 - H * .45); y += Math.exp(-((d - waveR) ** 2) / (1800 * s * s)) * 14 * s * (1 - waveT / 1.4); }
      x ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    // a beat makes the lines glow and thicken for a moment
    const alpha = (.16 + .08 * Math.sin(k + ph)) * [1.25, .85, .55][layer] * (.35 + .65 * st.act) + .45 * st.pulse;
    g.strokeStyle = `rgba(${col},${Math.min(.9, alpha).toFixed(3)})`;
    g.lineWidth = (1.2 + 1.8 * st.pulse) * [1.4, 1, .8][layer] * s;
    g.stroke();
  }
}
// Federano: podcast background (animation 1, voice wave): three soft lines across the screen that move when someone talks
// and lie almost flat in the pauses. st.voice is the PC's voice band (0..1), st.act fades it out when paused.
function voiceWave(g, W, H, st, cols) {
  g.clearRect(0, 0, W, H);
  const s = W / 1000, t = st.now / 1000, v = st.voice * st.act;
  const rgb = cols.map((c) => c.split(',').map(Number));
  for (let k = 0; k < 3; k++) {
    const c = rgb[k % rgb.length].join(','), y0 = H * .84, amp = (8 + 90 * v) * (1 - k * .25) * s;
    g.beginPath();
    for (let x = 0; x <= W; x += 4 * s) {
      const env = Math.sin(Math.PI * x / W) ** 2, xs = x / s;
      const y = y0 + env * amp * Math.sin(xs * (.018 + k * .006) + t * (3 + k)) * Math.cos(xs * .004 - t * .7);
      x ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.strokeStyle = `rgba(${c},${(.5 - k * .12) * (.45 + .55 * st.act)})`;
    // soft glow: a wide faint stroke under the line (much lighter than a canvas shadow)
    g.lineWidth = (9 - k * 2) * s; g.globalAlpha = .18; g.stroke(); g.globalAlpha = 1;
    g.lineWidth = (3 - k * .7) * s; g.stroke();
  }
}

/** The cover's own colours: its pixels grouped by hue, the four strongest groups (vivid and common first), each
 * brightened enough to show on a dark background. Greys and near-black are left out unless the cover has nothing else. */
export function coverPalette(img) {
  const c = document.createElement('canvas'); c.width = c.height = 40;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0, 40, 40);
  const d = g.getImageData(0, 0, 40, 40).data;
  const bins = Array.from({ length: 12 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
  let grey = { w: 0, r: 0, g: 0, b: 0 };
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], gg = d[i + 1], b = d[i + 2], mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), sat = mx ? (mx - mn) / mx : 0;
    if (mx < 35) continue;
    if (sat < .18) { grey.w += 1; grey.r += r; grey.g += gg; grey.b += b; continue; }
    let hue;
    if (mx === r) hue = ((gg - b) / (mx - mn) + 6) % 6; else if (mx === gg) hue = (b - r) / (mx - mn) + 2; else hue = (r - gg) / (mx - mn) + 4;
    const bin = bins[Math.floor(hue * 2) % 12], w = sat * (mx / 255);
    bin.w += w; bin.r += r * w; bin.g += gg * w; bin.b += b * w;
  }
  const lift = (rgb) => { const m2 = Math.max(...rgb) || 1, k = Math.max(1, 200 / m2); return rgb.map((v) => Math.round(Math.min(255, v * k))); };
  const picked = bins.filter((b) => b.w > 1).sort((a, b) => b.w - a.w).slice(0, 4).map((b) => lift([b.r / b.w, b.g / b.w, b.b / b.w]));
  if (!picked.length && grey.w) picked.push(lift([grey.r / grey.w, grey.g / grey.w, grey.b / grey.w]));
  if (!picked.length) picked.push([150, 120, 220]);
  while (picked.length < 4) picked.push(picked[picked.length % Math.max(1, picked.length)].map((v) => Math.round(v * .8)));
  return picked;
}
const SVG = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><rect x="6.5" y="5" width="4" height="14" rx="1.2" fill="currentColor"/><rect x="13.5" y="5" width="4" height="14" rx="1.2" fill="currentColor"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M12 5a7 7 0 1 1-6.6 9.3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M12 2.2v5.6L8.2 5z" fill="currentColor"/><text x="12" y="15.6" text-anchor="middle" font-size="6.6" font-weight="700" fill="currentColor" font-family="system-ui,sans-serif">10</text></svg>',
  fwd: '<svg viewBox="0 0 24 24"><path d="M12 5a7 7 0 1 0 6.6 9.3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M12 2.2v5.6L15.8 5z" fill="currentColor"/><text x="12" y="15.6" text-anchor="middle" font-size="6.6" font-weight="700" fill="currentColor" font-family="system-ui,sans-serif">10</text></svg>',
  prev: '<svg viewBox="0 0 24 24"><path d="M18 5.5v13l-9-6.5z" fill="currentColor"/><rect x="5.4" y="5.5" width="2.6" height="13" rx="1" fill="currentColor"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M6 5.5v13l9-6.5z" fill="currentColor"/><rect x="16" y="5.5" width="2.6" height="13" rx="1" fill="currentColor"/></svg>',
};

W.lyrics = {
  needs: [],
  create(box, { page }) {
    box.classList.add('ly');
    const img = h('img', 'ly-photo'); img.alt = '';
    const chip = h('div', 'ly-chip', '');
    const trBtn = h('button', 'ly-tr', h('i'), 'Tradução'); trBtn.hidden = true;
    // discreet full-screen switch: only the lyrics, centred, bigger (the card with the photo and controls goes away)
    const FS_ON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/></svg>';
    const FS_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h5V3M21 8h-5V3M3 16h5v5M21 16h-5v5"/></svg>';
    const fsBtn = h('button', 'ly-fsbtn');
    let fullOnly = false;
    try { fullOnly = localStorage.getItem('federano.lyricsFull') === '1'; } catch (_) {}
    const applyFs = () => {
      box.classList.toggle('ly-fs', fullOnly);
      fsBtn.innerHTML = fullOnly ? FS_OFF : FS_ON;
      fsBtn.setAttribute('aria-label', fullOnly ? 'Mostrar o cartão' : 'Só a letra em tela cheia');
      fsBtn.title = fsBtn.getAttribute('aria-label');
    };
    applyFs();
    fsBtn.onclick = () => { haptic(); fullOnly = !fullOnly; applyFs(); try { localStorage.setItem('federano.lyricsFull', fullOnly ? '1' : '0'); } catch (_) {} active = -2; };
    const title = h('div', 'ly-title', '');
    const artist = h('div', 'ly-artist', '');
    const fill = h('i');
    const bar = h('div', 'ly-bar', fill);
    const now = h('span', null, '0:00'), total = h('span', null, '');
    const times = h('div', 'ly-times', now, total);
    const btn = (cls, svg, label) => { const b = h('button', 'ly-btn ' + cls); b.innerHTML = svg; b.setAttribute('aria-label', label); b.title = label; return b; };
    const bBack = btn('ly-back', SVG.back, 'Voltar 10 segundos'), bPrev = btn('ly-prev', SVG.prev, 'Música anterior');
    const bPlay = btn('ly-play', SVG.pause, 'Play / pausa'), bNext = btn('ly-next', SVG.next, 'Próxima música'), bFwd = btn('ly-fwd', SVG.fwd, 'Avançar 10 segundos');
    const ctl = h('div', 'ly-ctl', bBack, bPrev, bPlay, bNext, bFwd);
    const list = h('div', 'ly-lines');
    // podcast episode: show, episode name, date / length / publisher and the description, where the lyrics go
    const pShow = h('div', 'ly-pshow', ''), pName = h('div', 'ly-pname', ''), pMeta = h('div', 'ly-pmeta', ''), pDesc = h('div', 'ly-pdesc', '');
    const pod = h('div', 'ly-pod', pShow, pName, pMeta, pDesc);
    let podMode = false;
    const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
    const longTime = (ms) => { const mi = Math.round(ms / 60000); return mi >= 60 ? `${Math.floor(mi / 60)} h ${mi % 60} min` : `${mi} min`; };
    const niceDate = (d) => { const x = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || ''); return x ? `${+x[3]} ${MONTHS[+x[2] - 1]} ${x[1]}` : (d || ''); };
    const note = h('div', 'ly-note', '');
    const qHead = h('div', 'ly-qh', 'A seguir'), queue = h('div', 'ly-queue');
    const bgPhoto = h('img', 'ly-bgphoto'); bgPhoto.alt = '';
    const fx = h('canvas', 'ly-fx');
    // breathing vignette: the dark edges slowly close in and open up, a little more on the beat
    const vig = h('div', 'ly-vig');
    const fxs = { bass: .3, mid: .3, high: .3, avgBass: .3, pulse: 0, lastBeat: 0, act: 1, ph: 0, lastMs: 0, now: 0, waveAt: -1e9, voice: 0 };
    let cols = ['150,120,220', '120,90,200', '200,120,180', '90,140,220'], lastWant = 0, raf = 0, lastFrame = 0;
    function animate(ms) {
      raf = requestAnimationFrame(animate);
      if (!visible() || ms - lastFrame < 15) return;   // the tablet is always plugged in: up to 60 fps
      lastFrame = ms;
      const w = Math.round(fx.clientWidth), hgt = Math.round(fx.clientHeight);
      if (!w || !hgt) return;
      if (fx.width !== w || fx.height !== hgt) { fx.width = w; fx.height = hgt; }
      // the PC's sound (48 bands): bass, voice and highs, smoothed; a beat when the bass jumps well over its average
      const bands = Date.now() - (D.spectrumAt || 0) < 800 ? D.spectrum : null;
      const playing = !!(m && m.playing);
      const part = (a, b) => bands ? Math.min(1, bands.slice(a, b).reduce((x, v) => x + v, 0) / (b - a) / 60) : .3;
      const nb = part(0, 10), nm = part(10, 30), nh = part(30, 48);
      fxs.bass += (nb - fxs.bass) * .25; fxs.mid += (nm - fxs.mid) * .2; fxs.high += (nh - fxs.high) * .2;
      fxs.avgBass += (nb - fxs.avgBass) * .03;
      if (playing && bands && nb > fxs.avgBass * 1.35 + .08 && ms - fxs.lastBeat > 280) { fxs.pulse = 1; fxs.lastBeat = ms; }
      fxs.pulse *= .88;
      fxs.act += ((playing ? 1 : .06) - fxs.act) * .05;
      fxs.ph += (ms - (fxs.lastMs || ms)) / 1000 * (.5 + .7 * fxs.act);
      fxs.lastMs = ms;
      fxs.now = ms;
      if (podMode) { fxs.voice += (nm * 1.4 - fxs.voice) * .15; voiceWave(fx.getContext('2d'), w, hgt, fxs, cols); }
      else weave(fx.getContext('2d'), w, hgt, fxs, cols);
      // the vignette breathes (a little darker on the beat); the blurred photo slowly zooms in and out
      vig.style.opacity = ((.55 + .3 * Math.sin(ms / 2600)) * (playing ? 1 : .7) + .15 * fxs.pulse).toFixed(3);
      bgPhoto.style.transform = `scale(${(1 + .04 * Math.sin(ms / 4000)).toFixed(4)})`;
      // keep the agent's analyser running while this page shows (it stops a few seconds after the last ask)
      if (Date.now() - lastWant > 2000) {
        lastWant = Date.now();
        api('/spectrum', 'GET', 1500).then((r) => { if (!streaming() && r && r.b) { D.spectrum = r.b; D.spectrumAt = Date.now(); } }).catch(() => {});
      }
    }
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) raf = requestAnimationFrame(animate);
    box.append(
      h('div', 'ly-main', bgPhoto, h('div', 'ly-bgveil'), fx, vig, h('div', 'ly-top', chip, h('div', 'ly-topr', trBtn, fsBtn)), h('div', 'ly-words', list, note, pod)),
      h('div', 'ly-card', h('div', 'ly-pic', img), h('div', 'ly-meta', title, artist), h('div', 'ly-prog', bar, times), ctl, qHead, queue));
    // the next songs; tapping one plays it (Spotify connected in the settings)
    let qKey = '', lastQueue = [];
    function fillQueue(items, nowTitle) {
      let list2 = Array.isArray(items) ? items.filter((q) => q && q.name) : [];
      // right after a skip Spotify can answer with an empty queue for a moment: keep the last one, minus the song now playing
      if (!list2.length && nowTitle && lastQueue.length) list2 = lastQueue.filter((q) => q.name !== nowTitle);
      if (nowTitle) lastQueue = list2;
      const k = JSON.stringify(list2.map((q) => q.id));
      if (k === qKey) return;
      qKey = k;
      qHead.hidden = !list2.length;
      queue.replaceChildren(...list2.map((q) => {
        const row = h('button', 'ly-q', h('b', null, q.name), h('span', null, q.artist || ''));
        row.onclick = async () => {
          haptic();
          try {
            const r = await fetch(`${API}/controls/spotify/action/play-queued?id=${encodeURIComponent(q.id)}`, { method: 'POST', cache: 'no-store', headers: PANEL_HEADERS });
            const j = await r.json();
            if (j && j.ok === false) toast(j.error || 'O Spotify não tocou essa música.', 'err');
          } catch (_) { toast('Sem conexão com o PC.', 'err'); }
          setTimeout(() => { clearTimeout(timer); poll(); }, 1200);
        };
        return row;
      }));
    }
    // translation on/off, remembered on this panel
    let showTr = true;
    try { showTr = localStorage.getItem('federano.lyricsTr') !== '0'; } catch (_) {}
    const applyTr = () => { box.classList.toggle('ly-show-tr', showTr); trBtn.classList.toggle('on', showTr); };
    applyTr();
    trBtn.onclick = () => { haptic(); showTr = !showTr; applyTr(); try { localStorage.setItem('federano.lyricsTr', showTr ? '1' : '0'); } catch (_) {} active = -2; draw(); };

    let lastArtistPending = false, follow = false, alive = true, key = '', pendingKey = '', lines = [], active = -2, m = null, at = 0, artId = -1, timer = 0;
    const visible = () => pages[curPage] === page && !document.body.classList.contains('night');
    // offset: how far Windows' position runs behind the player's own clock (the agent measures it for Spotify)
    let offset = 0;
    const pos = () => !m ? 0 : Math.min(m.durMs || Infinity, m.posMs + (m.ageMs || 0) + (m.playing ? performance.now() - at + offset : 0));

    // ---- controls: the PC's player through the media API (same as the media widget and the mirror)
    let holdUntil = 0;
    async function media(action, q = '', optimistic) {
      haptic();
      holdUntil = Date.now() + 1200;
      if (optimistic) optimistic();
      try {
        const r = await fetch(`${API}/media/${action}${q}`, { method: 'POST', cache: 'no-store', headers: PANEL_HEADERS });
        if (!r.ok) { toast(action.startsWith('seek') ? 'Esse player não deixa pular pelo Windows.' : 'O player do PC não respondeu.', 'err'); return; }
        const j = await r.json();
        if (j.media && m) { m = { ...m, ...j.media }; at = performance.now(); showPlay(); active = -2; draw(); }
      } catch (_) { toast('Sem conexão com o PC.', 'err'); }
      if (action === 'next' || action === 'prev') setTimeout(() => { clearTimeout(timer); poll(); }, 250);
    }
    const showPlay = () => {
      bPlay.innerHTML = m && m.playing ? SVG.pause : SVG.play;
      box.classList.toggle('ly-paused', !!m && !m.playing);
      if (m) chip.textContent = `● ${podMode ? 'Podcast' : (m.app || 'PC')} · ${m.playing ? 'tocando' : 'pausado'}`;
    };
    const jumpTo = (ms) => { if (!m) return; m = { ...m, posMs: Math.max(0, Math.min(m.durMs || Infinity, ms)), ageMs: 0 }; at = performance.now(); active = -2; draw(); };
    bPlay.onclick = () => media('playpause', '', () => { if (m) { m = { ...m, posMs: pos(), ageMs: 0, playing: !m.playing }; at = performance.now(); showPlay(); } });
    let backMs = 10000, fwdMs = 10000;
    const setSkips = (b, f) => {
      if (b === backMs && f === fwdMs) return;
      backMs = b; fwdMs = f;
      bBack.innerHTML = SVG.back.replace('>10<', `>${b / 1000}<`); bFwd.innerHTML = SVG.fwd.replace('>10<', `>${f / 1000}<`);
      bBack.setAttribute('aria-label', `Voltar ${b / 1000} segundos`); bBack.title = bBack.getAttribute('aria-label');
      bFwd.setAttribute('aria-label', `Avançar ${f / 1000} segundos`); bFwd.title = bFwd.getAttribute('aria-label');
    };
    bBack.onclick = () => media('seekby', `?ms=-${backMs}`, () => jumpTo(pos() - backMs));
    bFwd.onclick = () => media('seekby', `?ms=${fwdMs}`, () => jumpTo(pos() + fwdMs));
    bPrev.onclick = () => media('prev');
    bNext.onclick = () => media('next');
    const setPod = (on) => {
      podMode = on; box.classList.toggle('ly-podcast', on); pod.hidden = !on;
      setSkips(on ? 15000 : 10000, on ? 30000 : 10000);
      bPrev.setAttribute('aria-label', on ? 'Episódio anterior' : 'Música anterior'); bNext.setAttribute('aria-label', on ? 'Próximo episódio' : 'Próxima música');
    };
    setPod(false);
    // tap a line: the song jumps there (like Spotify)
    // scrolling the lyrics by hand: the page stops following the song for a while, so a later line can be picked
    let handUntil = 0, glideRaf = 0, glideTo = -1;
    const byHand = () => { handUntil = Date.now() + 6000; cancelAnimationFrame(glideRaf); glideTo = -1; };
    function glide(top) {
      if (Math.abs(top - glideTo) < 2 || Math.abs(top - list.scrollTop) < 2) return;
      cancelAnimationFrame(glideRaf); glideTo = top;
      const from = list.scrollTop, t0 = performance.now(), D = 320;
      const step = (now) => {
        const k = Math.min(1, (now - t0) / D), e = 1 - (1 - k) ** 3;
        list.scrollTop = from + (top - from) * e;
        if (k < 1) glideRaf = requestAnimationFrame(step); else glideTo = -1;
      };
      glideRaf = requestAnimationFrame(step);
    }
    for (const ev of ['touchstart', 'touchmove', 'wheel', 'pointerdown']) list.addEventListener(ev, byHand, { passive: true });
    list.addEventListener('click', (e) => {
      const el = e.target.closest('.ly-line'); if (!el || el.dataset.t == null) return;
      const t = +el.dataset.t;
      handUntil = 0;   // a line was picked: follow the song again from there
      media('seek', `?ms=${Math.max(0, t - 200)}`, () => jumpTo(t));
    });
    // tap the progress bar: jump to that point
    bar.addEventListener('click', (e) => {
      if (!m || !(m.durMs > 0)) return;
      const r = bar.getBoundingClientRect(), t = Math.round((e.clientX - r.left) / r.width * m.durMs);
      media('seek', `?ms=${t}`, () => jumpTo(t));
    });

    function setArt(src, isArtist) {
      if (img.dataset.src === src) return;
      img.dataset.src = src || '';
      box.classList.toggle('ly-noart', !src);
      box.classList.toggle('ly-artist-photo', !!isArtist);
      for (const el of [img, bgPhoto]) { if (src) el.src = src; else el.removeAttribute('src'); }
    }
    function tint() {
      // the background takes the cover's colour (same-origin /api/art, so it can be read)
      if (!m || m.artId === artId) return;
      artId = m.artId;
      const probe = new Image();
      probe.onload = () => {
        // the whole page takes the cover's colours: background, card, lines, bar, buttons, labels
        let pal;
        try { pal = coverPalette(probe); } catch (_) { return; }
        cols = pal.map((c) => c.join(','));
        const [a, b2] = pal, dark = (c, k) => `rgb(${c.map((v) => Math.round(v * k)).join(',')})`;
        box.style.setProperty('--ly-bg', dark(a, .34));
        box.style.setProperty('--ly-bg2', dark(b2, .16));
        box.style.setProperty('--ly-accent', `rgb(${a.join(',')})`);
        box.style.setProperty('--ly-accent2', `rgb(${b2.join(',')})`);
        box.style.setProperty('--ly-card', dark(a, .12));
      };
      probe.src = `${API}/art?v=${m.artId}`;
    }
    function fillLines(data) {
      list.replaceChildren(); lines = []; active = -2;
      box.classList.remove('ly-plain', 'ly-none');
      note.textContent = '';
      const tr = Array.isArray(data?.trans) ? data.trans : null;
      trBtn.hidden = !tr;
      const line = (text, i, cls) => { const el = h('div', 'ly-line' + (cls || ''), h('span', 'ly-txt', text)); if (tr && tr[i]) el.append(h('span', 'ly-tl', tr[i])); return el; };
      if (!data || !data.found || data.instrumental || (!data.lines?.length && !data.plain)) {
        box.classList.add('ly-none');
        note.textContent = data?.instrumental ? 'Instrumental' : 'Letra não encontrada para esta música.';
        return;
      }
      if (data.lines?.length) {
        lines = data.lines.map((l, i) => { const el = line(l.text || '♪', i, l.text ? '' : ' ly-gap'); el.dataset.t = l.t; return { t: l.t, el }; });
        list.append(...lines.map((l) => l.el));
      } else {
        box.classList.add('ly-plain');
        list.append(...data.plain.split('\n').map((t, i) => line(t.trim() || ' ', i)));
      }
      list.scrollTop = 0;
    }
    function draw() {
      if (!m) return;
      const p = pos();
      now.textContent = clock(p);
      fill.style.width = m.durMs > 0 ? (p / m.durMs * 100).toFixed(2) + '%' : '0';
      if (!lines.length) return;
      let i = -1;
      for (let k = 0; k < lines.length; k++) { if (lines[k].t <= p + LEAD) i = k; else break; }
      const hand = Date.now() < handUntil;
      if (i === active && !(follow && !hand)) return;
      if (i !== active) {
        if (i > active && active >= 0) fxs.waveAt = performance.now();
        active = i;
        lines.forEach((l, k) => { l.el.classList.toggle('on', k === i); l.el.classList.toggle('past', k < i); });
      }
      follow = hand;   // after a hand scroll ends, go back to the line being sung once
      if (hand) return;
      // the line being sung goes to the middle
      const el = lines[Math.max(0, i)].el;
      glide(Math.max(0, Math.min(list.scrollHeight - list.clientHeight, el.offsetTop + el.offsetHeight / 2 - list.clientHeight / 2)));
    }
    async function poll() {
      if (!alive) return;
      if (visible() || !key) {
        try {
          const r = await fetch(`${API}/lyrics/now?have=${encodeURIComponent(key)}`, { cache: 'no-store', headers: PANEL_HEADERS });
          const j = await r.json();
          if (!j.playing) {
            setPod(false); m = null; key = ''; box.classList.add('ly-idle'); title.textContent = 'Nada tocando no Spotify'; artist.textContent = ''; setArt('', false);
            chip.textContent = ''; trBtn.hidden = true; lastQueue = []; fillQueue([]);
            list.replaceChildren(); lines = []; note.textContent = '';
          } else {
            box.classList.remove('ly-idle');
            m = j.media; at = performance.now();
            offset = Number(j.posOffsetMs) || 0;
            lastArtistPending = !!j.artistPending;
            title.textContent = m.title; artist.textContent = [m.artist, m.album].filter(Boolean).join(' · ');
            if (m.app === 'Spotify') fillQueue(j.queue, m.title); else { lastQueue = []; fillQueue([]); }
            chip.textContent = `● ${m.app || 'PC'} · ${m.playing ? 'tocando' : 'pausado'}`;
            total.textContent = m.durMs > 0 ? clock(m.durMs) : '';
            showPlay();
            if (j.kind === 'episode' && j.episode) {
              const ep = j.episode;
              setPod(true);
              title.textContent = ep.name || m.title; artist.textContent = ep.show || m.artist || '';
              chip.textContent = `● Podcast · ${m.playing ? 'tocando' : 'pausado'}`;
              pShow.textContent = ep.show || ''; pName.textContent = ep.name || m.title;
              pMeta.textContent = [niceDate(ep.date), ep.durationMs > 0 ? longTime(ep.durationMs) : '', ep.publisher].filter(Boolean).join(' · ');
              pDesc.textContent = ep.description || '';
              lastQueue = []; fillQueue([]);
              setArt(ep.image || (m.artId ? `${API}/art?v=${m.artId}` : ''), false);
              tint();
              if (j.key !== key) { key = j.key; pendingKey = ''; list.replaceChildren(); lines = []; active = -2; trBtn.hidden = true; note.textContent = ''; box.classList.remove('ly-plain', 'ly-none'); }
              draw();
              timer = setTimeout(poll, visible() ? 4000 : 8000);
              return;
            }
            setPod(false);
            if (!j.artistPending) setArt(j.artistImage || (m.artId ? `${API}/art?v=${m.artId}` : ''), !!j.artistImage);
            tint();
            if (j.key !== key) {
              if (j.lyrics) { key = j.key; pendingKey = ''; fillLines(j.lyrics); }
              else if (j.pending && pendingKey !== j.key) {
                // the new song shows at once; its lyrics arrive on the next calls
                pendingKey = j.key; list.replaceChildren(); lines = []; active = -2; trBtn.hidden = true;
                box.classList.remove('ly-plain', 'ly-none'); note.textContent = 'Carregando a letra…';
              }
            }
            draw();
          }
        } catch (_) {}
      }
      timer = setTimeout(poll, pendingKey || lastArtistPending ? 400 : visible() ? 4000 : 8000);
    }
    // the shared media state streamed by the agent (pokes on every change): title, play/pause and position follow it at
    // once; a new song asks for its lyrics right away instead of waiting for the next poll
    function follow2() {
      const s = liveMedia;
      if (!s || !m || !s.title) return;
      const lk = `${s.app}|${s.title}`;
      if (lk !== lastLive) {
        lastLive = lk;
        // the song changed on the PC: ask for it (and its lyrics) now
        if ((s.title !== m.title || s.app !== m.app) && !pollNow.pending) { pollNow.pending = true; clearTimeout(timer); poll().finally(() => { pollNow.pending = false; }); }
      }
      if (s.title !== m.title || s.app !== m.app) return;
      if (Date.now() < holdUntil) return;   // a control just used: its own answer is newer
      const p = s.posMs + (s.playing ? performance.now() - s.at : 0);
      if (s.playing !== m.playing || Math.abs(p + (s.playing ? offset : 0) - pos()) > 700) {
        m = { ...m, playing: s.playing, posMs: p, ageMs: 0, durMs: s.durMs || m.durMs }; at = performance.now();
        showPlay(); active = -2;
      }
    }
    const pollNow = { pending: false };
    let lastLive = '';
    const ticker = setInterval(() => { if (visible()) { follow2(); draw(); } }, 150);
    poll();
    return {
      update() {},
      destroy() { alive = false; clearTimeout(timer); clearInterval(ticker); cancelAnimationFrame(raf); },
    };
  },
};
