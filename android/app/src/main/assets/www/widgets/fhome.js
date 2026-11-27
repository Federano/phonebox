import { API, D, LOCALE, METRICS, cfg, chart, fmtTime, h, haptic, hist, media, metricText, online, openNowPlaying, wxDeg, wxText } from '../main.js';
import { W } from '../registry.js';
import { joinMeeting, meetingsToday } from './meetings.js';

// ---------------------------------------------------------------- Federano "Home" (Início)
// One widget for the whole start page, in Tema 01's look: the time, the PC's state, what is playing, today's meetings,
// and, at the bottom, CPU, RAM, GPU and network with their recent history plus the weather.
const two = (n) => String(n).padStart(2, '0');
const SYS = ['cpu', 'ram', 'gpu', 'net'];

W.fhome = {
  bare: true, needs: ['tick', 'state', 'weather', 'fast'],
  create(box) {
    const date = h('div', 'fh-lbl'), time = h('div', 'fh-time');
    const pc = h('span', 'fh-pill'), cpuP = h('span', 'fh-pill'), ramP = h('span', 'fh-pill');
    const head = h('div', 'fh-head', h('div', null, date, time), h('div', 'fh-pills', pc, cpuP, ramP));
    // now playing (tap: the screen of what is playing)
    const art = h('img', 'fh-art'); art.alt = '';
    art.onerror = () => art.removeAttribute('src');
    const song = h('b'), who = h('span'), fill = h('i'), pos = h('span'), dur = h('span');
    const np = h('button', 'fh-card fh-np', h('div', 'fh-lbl', 'Tocando agora'), h('div', 'fh-npr', h('div', 'fh-artw', art), h('div', 'fh-song', song, who)),
      h('div', 'fh-prog', fill), h('div', 'fh-times', pos, dur));
    np.onclick = () => { haptic(); openNowPlaying(); };
    // today's meetings
    const mlist = h('div', 'fh-mlist');
    const meet = h('div', 'fh-card fh-meet', h('div', 'fh-lbl', 'Reuniões de hoje'), mlist);
    // the PC and the weather
    const cards = SYS.map((k) => {
      const m = METRICS[k], val = h('div', 'fh-num'), cv = h('canvas');
      return { k, m, val, cv, el: h('div', 'fh-card fh-st', h('div', 'fh-lbl', k === 'net' ? 'Rede' : m.label), val, cv) };
    });
    const wxCity = h('div', 'fh-lbl'), wxNow = h('div', 'fh-wxnow'), wxSub = h('div', 'fh-sub'), wxDays = h('div', 'fh-days');
    const wx = h('div', 'fh-card fh-wx', wxCity, wxNow, wxSub, wxDays);
    // (no page buttons here: the side rail already goes to every page)
    box.append(head, h('div', 'fh-row', np, meet), h('div', 'fh-sys', ...cards.map((c) => c.el), wx));

    let meetAt = 0, artId = -1;
    async function drawMeet() {
      if (Date.now() - meetAt < 30000) return;
      meetAt = Date.now();
      try {
        const j = await meetingsToday();
        const now = Date.now(), evs = (j?.today || []).filter((e) => e.end > now).slice(0, 3);
        mlist.replaceChildren(...(evs.length ? evs.map((ev) => {
          const t = new Date(ev.start), soon = ev.start - now < 15 * 60000;
          const row = h('div', 'fh-mt', h('span', 'fh-h' + (soon ? ' soon' : ''), `${two(t.getHours())}:${two(t.getMinutes())}`), h('span', 'fh-ttl', ev.title || 'Reunião'));
          if (ev.meet) { const b = h('button', 'fh-btn', 'Entrar'); b.onclick = () => { haptic(); joinMeeting(ev); }; row.append(b); }
          return row;
        }) : [h('div', 'fh-empty', j?.error || 'Nenhuma reunião hoje.')]));
      } catch (_) { mlist.replaceChildren(h('div', 'fh-empty', 'Não deu para ler a agenda agora.')); }
    }
    function drawMedia() {
      const m = media;
      if (!m || !m.title) { song.textContent = 'Nada tocando'; who.textContent = ''; fill.style.width = '0%'; pos.textContent = ''; dur.textContent = ''; box.classList.remove('fh-playing'); return; }
      song.textContent = m.title; who.textContent = [m.artist, m.app].filter(Boolean).join(' · ');
      if (m.artId && m.artId !== artId) { artId = m.artId; art.src = `${API}/art?v=${m.artId}`; }
      const p = Math.min(m.durMs || 0, (m.posMs || 0) + (m.playing && m.at ? performance.now() - m.at : 0));
      fill.style.width = m.durMs > 0 ? (p / m.durMs * 100).toFixed(1) + '%' : '0%';
      pos.textContent = m.durMs > 0 ? fmtTime(p) : ''; dur.textContent = m.durMs > 0 ? fmtTime(m.durMs) : '';
      box.classList.toggle('fh-playing', !!m.playing);
    }
    return {
      update(kind) {
        if (kind === 'tick') {
          const d = new Date();
          date.textContent = d.toLocaleDateString(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' });
          time.replaceChildren(two(d.getHours()), h('span', 'fh-colon', ':'), two(d.getMinutes()));
          pc.replaceChildren(h('i', 'fh-dot' + (online === false ? ' off' : '')), online === false ? 'PC desligado' : 'PC online');
          drawMeet(); drawMedia();
        }
        if (kind === 'state' && D.state) {
          const s = D.state;
          cpuP.replaceChildren('CPU ', h('b', null, metricText(METRICS.cpu, s).join('')));
          const rp = METRICS.ram.pct?.(s);
          ramP.replaceChildren('RAM ', h('b', null, rp != null ? Math.round(rp) + '%' : metricText(METRICS.ram, s).join(' ')));
          for (const c of cards) {
            const [v, u] = metricText(c.m, s);
            c.val.replaceChildren(v, h('small', null, u));
            chart(c.cv, [{ data: hist[c.m.hist || c.k] || hist.cpu, color: '#ff2a4f', max: c.m.max(s) }]);
          }
          drawMedia();
        }
        if (kind === 'fast') drawMedia();
        if (kind === 'weather') {
          const w = D.weather;
          wxCity.textContent = cfg.weather?.city || 'Clima';
          if (!w?.current) { wxNow.textContent = '—'; wxSub.textContent = ''; wxDays.replaceChildren(); return; }
          wxNow.textContent = wxDeg(w.current.temperature_2m) + '°';
          const dd = w.daily;
          wxSub.textContent = [wxText(w.current.weather_code), dd?.temperature_2m_max?.[0] != null ? `máx ${wxDeg(dd.temperature_2m_max[0])}° · mín ${wxDeg(dd.temperature_2m_min[0])}°` : ''].filter(Boolean).join(' · ');
          wxDays.replaceChildren(...[1, 2, 3].filter((i) => dd?.temperature_2m_max?.[i] != null).map((i) =>
            h('span', null, new Date(dd.time[i] + 'T12:00').toLocaleDateString(LOCALE, { weekday: 'short' }).replace('.', ''), h('b', null, wxDeg(dd.temperature_2m_max[i]) + '°'))));
        }
      },
    };
  },
};
