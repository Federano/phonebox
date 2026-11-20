import { API, PANEL_HEADERS, averageColor, curPage, h, haptic, pages, toast } from '../main.js';
import { W } from '../registry.js';

// ---------------------------------------------------------------- Federano "Letra"
// The song playing on the PC: the artist's photo (Spotify) fills the background, the lyrics sit in the middle with the
// line being sung lit up and kept at the centre, a Portuguese translation under each line (switch "Tradução"), and a
// bar at the bottom with the song and the controls. Data: GET /api/lyrics/now (lyrics from LRCLIB and the translation,
// sent once per song). Without timed lyrics the text is shown still.

const clock = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const LEAD = 350;   // show a line a little before it is sung
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
    const img = h('img', 'ly-bgimg'); img.alt = '';
    const thumb = h('img', 'ly-thumb'); thumb.alt = '';
    const chip = h('div', 'ly-chip', '');
    const trBtn = h('button', 'ly-tr', h('i'), 'Tradução'); trBtn.hidden = true;
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
    box.append(img, h('div', 'ly-veil'), h('div', 'ly-top', chip, trBtn), h('div', 'ly-words', list, note),
      h('div', 'ly-dock', thumb, h('div', 'ly-meta', title, artist), h('div', 'ly-prog', bar, times), ctl));
    // translation on/off, remembered on this panel
    let showTr = true;
    try { showTr = localStorage.getItem('federano.lyricsTr') !== '0'; } catch (_) {}
    const applyTr = () => { box.classList.toggle('ly-show-tr', showTr); trBtn.classList.toggle('on', showTr); };
    applyTr();
    trBtn.onclick = () => { haptic(); showTr = !showTr; applyTr(); try { localStorage.setItem('federano.lyricsTr', showTr ? '1' : '0'); } catch (_) {} active = -2; draw(); };

    let alive = true, key = '', lines = [], active = -2, m = null, at = 0, artId = -1, timer = 0;
    const visible = () => pages[curPage] === page && !document.body.classList.contains('night');
    const pos = () => !m ? 0 : Math.min(m.durMs || Infinity, m.posMs + (m.ageMs || 0) + (m.playing ? performance.now() - at : 0));

    // ---- controls: the PC's player through the media API (same as the media widget and the mirror)
    async function media(action, q = '', optimistic) {
      haptic();
      if (optimistic) optimistic();
      try {
        const r = await fetch(`${API}/media/${action}${q}`, { method: 'POST', cache: 'no-store', headers: PANEL_HEADERS });
        if (!r.ok) { toast(action.startsWith('seek') ? 'Esse player não deixa pular pelo Windows.' : 'O player do PC não respondeu.', 'err'); return; }
        const j = await r.json();
        if (j.media && m) { m = { ...m, ...j.media }; at = performance.now(); showPlay(); active = -2; draw(); }
      } catch (_) { toast('Sem conexão com o PC.', 'err'); }
      setTimeout(() => { clearTimeout(timer); poll(); }, 900);
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
    list.addEventListener('click', (e) => {
      const el = e.target.closest('.ly-line'); if (!el || el.dataset.t == null) return;
      const t = +el.dataset.t;
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
      for (const el of [img, thumb]) { if (src) el.src = src; else el.removeAttribute('src'); }
    }
    function tint() {
      // the background takes the cover's colour (same-origin /api/art, so it can be read)
      if (!m || m.artId === artId) return;
      artId = m.artId;
      const probe = new Image();
      probe.onload = () => {
        const c = averageColor(probe);
        if (c) box.style.setProperty('--ly-bg', `rgb(${c.split(',').map((v) => Math.round(+v * .45)).join(',')})`);
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
      if (i === active) return;
      active = i;
      lines.forEach((l, k) => { l.el.classList.toggle('on', k === i); l.el.classList.toggle('past', k < i); });
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
            chip.textContent = ''; trBtn.hidden = true;
            list.replaceChildren(); lines = []; note.textContent = '';
          } else {
            box.classList.remove('ly-idle');
            m = j.media; at = performance.now();
            title.textContent = m.title; artist.textContent = m.artist || '';
            chip.textContent = `● ${m.app || 'PC'} · ${m.playing ? 'tocando' : 'pausado'}`;
            total.textContent = m.durMs > 0 ? clock(m.durMs) : '';
            showPlay();
            setArt(j.artistImage || (m.artId ? `${API}/art?v=${m.artId}` : ''), !!j.artistImage);
            tint();
            if (j.key !== key) { key = j.key; if (j.lyrics) fillLines(j.lyrics); }
            draw();
          }
        } catch (_) {}
      }
      timer = setTimeout(poll, visible() ? 2000 : 6000);
    }
    const ticker = setInterval(() => { if (visible()) draw(); }, 200);
    poll();
    return {
      update() {},
      destroy() { alive = false; clearTimeout(timer); clearInterval(ticker); },
    };
  },
};
