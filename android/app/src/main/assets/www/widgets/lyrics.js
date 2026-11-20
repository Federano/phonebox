import { API, PANEL_HEADERS, averageColor, curPage, h, pages } from '../main.js';
import { W } from '../registry.js';

// ---------------------------------------------------------------- Federano "Letra"
// The song playing on the PC: the artist's photo on one side (Spotify) and the lyrics on the other, the line being sung
// lit up and kept in view, like Spotify's lyrics screen. Data: GET /api/lyrics/now (lyrics from LRCLIB, sent once per
// song). Without timed lyrics the text is shown still; without lyrics the photo takes the whole widget.

const clock = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const LEAD = 350;   // show a line a little before it is sung

W.lyrics = {
  needs: [],
  create(box, { page }) {
    box.classList.add('ly');
    const img = h('img', 'ly-img'); img.alt = '';
    const shade = h('div', 'ly-shade');
    const title = h('div', 'ly-title', '');
    const artist = h('div', 'ly-artist', '');
    const fill = h('i');
    const bar = h('div', 'ly-bar', fill);
    const now = h('span', null, '0:00'), total = h('span', null, '');
    const times = h('div', 'ly-times', now, total);
    const side = h('div', 'ly-side', img, shade, h('div', 'ly-info', title, artist, bar, times));
    const list = h('div', 'ly-lines');
    const note = h('div', 'ly-note', '');
    const words = h('div', 'ly-words', list, note);
    box.append(side, words);

    let alive = true, key = '', lines = [], active = -2, m = null, at = 0, artId = -1, timer = 0;
    const visible = () => pages[curPage] === page && !document.body.classList.contains('night');
    const pos = () => !m ? 0 : Math.min(m.durMs || Infinity, m.posMs + (m.ageMs || 0) + (m.playing ? performance.now() - at : 0));

    function setArt(src, isArtist) {
      if (img.dataset.src === src) return;
      img.dataset.src = src || '';
      box.classList.toggle('ly-noart', !src);
      box.classList.toggle('ly-artist-photo', !!isArtist);
      if (src) img.src = src; else img.removeAttribute('src');
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
      if (!data || !data.found || data.instrumental || (!data.lines?.length && !data.plain)) {
        box.classList.add('ly-none');
        note.textContent = data?.instrumental ? 'Instrumental' : 'Letra não encontrada para esta música.';
        return;
      }
      if (data.lines?.length) {
        lines = data.lines.map((l) => ({ t: l.t, el: h('div', 'ly-line' + (l.text ? '' : ' ly-gap'), l.text || '♪') }));
        list.append(...lines.map((l) => l.el));
      } else {
        box.classList.add('ly-plain');
        list.append(...data.plain.split('\n').map((t) => h('div', 'ly-line', t || ' ')));
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
      const el = lines[Math.max(0, i)].el;
      list.scrollTo({ top: Math.max(0, el.offsetTop - list.clientHeight * .38), behavior: 'smooth' });
    }
    async function poll() {
      if (!alive) return;
      if (visible() || !key) {
        try {
          const r = await fetch(`${API}/lyrics/now?have=${encodeURIComponent(key)}`, { cache: 'no-store', headers: PANEL_HEADERS });
          const j = await r.json();
          if (!j.playing) {
            m = null; key = ''; box.classList.add('ly-idle'); title.textContent = 'Nada tocando no PC'; artist.textContent = ''; setArt('', false);
            list.replaceChildren(); lines = []; note.textContent = '';
          } else {
            box.classList.remove('ly-idle');
            m = j.media; at = performance.now();
            title.textContent = m.title; artist.textContent = [m.artist, m.app].filter(Boolean).join(' · ');
            total.textContent = m.durMs > 0 ? clock(m.durMs) : '';
            box.classList.toggle('ly-paused', !m.playing);
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
