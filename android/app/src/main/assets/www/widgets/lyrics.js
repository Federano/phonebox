import { API, D, PANEL_HEADERS, api, averageColor, curPage, h, haptic, media as liveMedia, pages, streaming, toast } from '../main.js';
import { W } from '../registry.js';

// ---------------------------------------------------------------- Federano "Letra"
// The song playing on the PC: the lyrics take most of the screen, centred, with the line being sung lit up and kept in
// the middle and a Portuguese translation under each line (switch "Tradução"); a card on the right has the artist's
// photo (Spotify), the song, the controls and the next songs of the queue (tap one to play it). Data: GET /api/lyrics/now (lyrics from LRCLIB and the translation,
// sent once per song). Without timed lyrics the text is shown still.

const clock = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const LEAD = 350;   // show a line a little before it is sung

// ---- background: the artist's photo blurred behind the lyrics, and many thin lines waving together like fabric. The
// lines follow the PC's sound (the agent's spectrum analyser, the same as the Spectrum bars widget) and take the
// cover's colours. Drawn ~30 times a second, only while the page is on screen.
function weave(g, W, H, t, lvl, cols) {
  g.clearRect(0, 0, W, H);
  const n = 22, s = W / 660;
  for (let k = 0; k < n; k++) {
    const y0 = H * (.1 + .85 * k / (n - 1)), c = cols[k % cols.length];
    g.beginPath();
    for (let x = 0; x <= W; x += 6 * s) {
      const y = y0 + (Math.sin(x / s * .009 + t * .9 + k * .35) * (10 + 22 * lvl) + Math.sin(x / s * .021 - t * 1.4 + k * .2) * 6) * s;
      x ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.strokeStyle = `rgba(${c},${(.16 + .1 * Math.sin(k + t)).toFixed(3)})`;
    g.lineWidth = 1.2 * s;
    g.stroke();
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
    const note = h('div', 'ly-note', '');
    const qHead = h('div', 'ly-qh', 'A seguir'), queue = h('div', 'ly-queue');
    const bgPhoto = h('img', 'ly-bgphoto'); bgPhoto.alt = '';
    const fx = h('canvas', 'ly-fx');
    let cols = ['150,120,220', '120,90,200', '200,120,180', '90,140,220'], lvl = .3, lastWant = 0, raf = 0, lastFrame = 0;
    function animate(ms) {
      raf = requestAnimationFrame(animate);
      if (!visible() || ms - lastFrame < 33) return;
      lastFrame = ms;
      const w = Math.round(fx.clientWidth), hgt = Math.round(fx.clientHeight);
      if (!w || !hgt) return;
      if (fx.width !== w || fx.height !== hgt) { fx.width = w; fx.height = hgt; }
      // loudness from the PC's sound: the lower bands, smoothed; calm when there is no sound data or the song is paused
      const bands = Date.now() - (D.spectrumAt || 0) < 800 ? D.spectrum : null;
      let target = .25;
      if (m && !m.playing) target = .05;
      else if (Array.isArray(bands) && bands.length) target = Math.min(1, bands.slice(0, 14).reduce((a, v) => a + v, 0) / 14 / 55);
      lvl += (target - lvl) * .12;
      weave(fx.getContext('2d'), w, hgt, ms / 1000, lvl, cols);
      // keep the agent's analyser running while this page shows (it stops a few seconds after the last ask)
      if (Date.now() - lastWant > 2000) {
        lastWant = Date.now();
        api('/spectrum', 'GET', 1500).then((r) => { if (!streaming() && r && r.b) { D.spectrum = r.b; D.spectrumAt = Date.now(); } }).catch(() => {});
      }
    }
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) raf = requestAnimationFrame(animate);
    box.append(
      h('div', 'ly-main', bgPhoto, h('div', 'ly-bgveil'), fx, h('div', 'ly-top', chip, h('div', 'ly-topr', trBtn, fsBtn)), h('div', 'ly-words', list, note)),
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
      if (m) chip.textContent = `● ${m.app || 'PC'} · ${m.playing ? 'tocando' : 'pausado'}`;
    };
    const jumpTo = (ms) => { if (!m) return; m = { ...m, posMs: Math.max(0, Math.min(m.durMs || Infinity, ms)), ageMs: 0 }; at = performance.now(); active = -2; draw(); };
    bPlay.onclick = () => media('playpause', '', () => { if (m) { m = { ...m, posMs: pos(), ageMs: 0, playing: !m.playing }; at = performance.now(); showPlay(); } });
    bBack.onclick = () => media('seekby', '?ms=-10000', () => jumpTo(pos() - 10000));
    bFwd.onclick = () => media('seekby', '?ms=10000', () => jumpTo(pos() + 10000));
    bPrev.onclick = () => media('prev');
    bNext.onclick = () => media('next');
    // tap a line: the song jumps there (like Spotify)
    // scrolling the lyrics by hand: the page stops following the song for a while, so a later line can be picked
    let handUntil = 0;
    const byHand = () => { handUntil = Date.now() + 6000; };
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
      const line = (text, i, cls) => { const el = h('div', 'ly-line' + (cls || ''), text); if (tr && tr[i]) el.append(h('span', 'ly-tl', tr[i])); return el; };
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
        active = i;
        lines.forEach((l, k) => { l.el.classList.toggle('on', k === i); l.el.classList.toggle('past', k < i); });
      }
      follow = hand;   // after a hand scroll ends, go back to the line being sung once
      if (hand) return;
      // the line being sung goes to the middle
      const el = lines[Math.max(0, i)].el;
      list.scrollTo({ top: Math.max(0, el.offsetTop + el.offsetHeight / 2 - list.clientHeight / 2), behavior: 'smooth' });
    }
    async function poll() {
      if (!alive) return;
      if (visible() || !key) {
        try {
          const r = await fetch(`${API}/lyrics/now?have=${encodeURIComponent(key)}`, { cache: 'no-store', headers: PANEL_HEADERS });
          const j = await r.json();
          if (!j.playing) {
            m = null; key = ''; box.classList.add('ly-idle'); title.textContent = 'Nada tocando no PC'; artist.textContent = ''; setArt('', false);
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
