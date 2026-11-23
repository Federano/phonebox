import { API, PANEL_HEADERS, bridge, buzz, curPage, gotoSkillPage, h, haptic, pages, toast } from '../main.js';
import { W } from '../registry.js';
import { openMirror } from '../mirror.js';

// ---------------------------------------------------------------- Federano "Reuniões"
// Today's meetings from the calendars set up on the PC (the Google Calendar secret iCal address), the next one with a
// countdown, a "time to join" alert a few minutes before (the panel switches to this page and buzzes), and, during a
// Google Meet call open in Chrome on the PC, Meet's own buttons (microphone, camera, hand, captions, leave) and "Ver o
// Meet no tablet" (the same mirroring as videos). Data: GET /api/meet; buttons: POST /api/meet/press|open|mirror.

const post = (path) => fetch(`${API}${path}`, { method: 'POST', cache: 'no-store', headers: PANEL_HEADERS }).then((r) => r.json()).catch(() => ({ ok: false, error: 'Sem conexão com o PC.' }));
const hm = (ms) => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const mins = (ms) => Math.max(0, Math.round(ms / 60000));
const durTxt = (a, b) => { const m = mins(b - a); return m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ' ' + (m % 60) + ' min' : ''}` : `${m} min`; };
const SVG = {
  mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  micOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M3 3l18 18"/></svg>',
  cam: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><rect x="3" y="7" width="13" height="10" rx="2"/><path d="m16 11 5-3v8l-5-3"/></svg>',
  camOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><rect x="3" y="7" width="13" height="10" rx="2"/><path d="m16 11 5-3v8l-5-3M3 3l18 18"/></svg>',
  hand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M8 13V5a1.5 1.5 0 0 1 3 0v6M11 10V4a1.5 1.5 0 0 1 3 0v6M14 10V5a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6h-1a5 5 0 0 1-4-2l-3-4a1.5 1.5 0 0 1 2.2-2L8 13"/></svg>',
  cc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 10.5a2.5 2.5 0 1 0 0 3M17 10.5a2.5 2.5 0 1 0 0 3"/></svg>',
  leave: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 14c5-5 13-5 18 0l-2 3-4-1v-3a10 10 0 0 0-6 0v3l-4 1z"/></svg>',
  screen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
};

// ---- shared data (one poll for the widget and the alert)
let data = null, lastLoad = 0, loading = null;
async function load(force) {
  if (!force && Date.now() - lastLoad < 15000 && data) return data;
  if (loading) return loading;
  const cal = String(opts().calendar || '').trim();
  loading = fetch(`${API}/meet${cal ? '?cal=' + encodeURIComponent(cal) : ''}`, { cache: 'no-store', headers: PANEL_HEADERS }).then((r) => r.json()).then((j) => { data = j; lastLoad = Date.now(); return j; })
    .catch(() => data).finally(() => { loading = null; });
  return loading;
}
const meetPage = () => pages.find((p) => (p.widgets || []).some((w) => w.type === 'meetings'));
const opts = () => (meetPage()?.widgets || []).find((w) => w.type === 'meetings')?.options || {};

async function join(ev, withTablet) {
  haptic();
  const acct = String(opts().account || '').trim();
  const r = await post(`/meet/open?url=${encodeURIComponent(ev.meet)}${acct ? '&account=' + encodeURIComponent(acct) : ''}`);
  if (!r.ok) { toast(r.error || 'Não consegui abrir o Meet.', 'err'); return; }
  toast('Abrindo o Meet no PC…');
  if (withTablet) {
    // wait for the call to start in Chrome, then show it here
    for (let i = 0; i < 30; i++) {
      await new Promise((res) => setTimeout(res, 2000));
      const j = await load(true);
      if (j?.call?.inCall) { showOnTablet(); return; }
    }
    toast('Entre na chamada no PC; depois toque em "Ver o Meet no tablet".');
  }
}
async function showOnTablet() {
  haptic();
  const r = await post('/meet/mirror');
  if (!r.ok) { toast(r.error || 'Não consegui mostrar o Meet.', 'err'); return; }
  openMirror('Google Meet');
}

// ---- the "time to join" alert, wherever the panel is
const alerted = new Set();
let alertBox = null;
function showAlert(ev, loud) {
  const page = meetPage();
  if (page && opts().autoPage !== false && pages[curPage] !== page) gotoSkillPage(page.id);
  buzz('0,200,120,200,120,400');
  // at the start time: the loud alarm (alarm stream at full volume, even with the tablet's sound off), then a voice
  if (loud && bridge && bridge.meetAlarm) bridge.meetAlarm(`Hora de entrar na reunião. ${ev.title}`);
  const quiet = () => { if (loud && bridge && bridge.meetAlarmStop) bridge.meetAlarmStop(); };
  alertBox?.remove();
  const left = () => mins(ev.start - Date.now());
  const ring = h('div', 'mt-ring', String(left()));
  const when = h('div', 'mt-when', left() > 0 ? `Começa em ${left()} min` : 'Começando agora');
  const close = () => { quiet(); clearInterval(tick); alertBox?.remove(); alertBox = null; };
  const go = h('button', 'mt-abtn go', 'Entrar agora'), goTab = h('button', 'mt-abtn', 'Entrar e ver no tablet'), later = h('button', 'mt-abtn', 'Lembrar em 2 min');
  go.onclick = () => { close(); join(ev, false); };
  goTab.onclick = () => { close(); join(ev, true); };
  later.onclick = () => { haptic(); close(); setTimeout(() => showAlert(ev, loud), 120000); };
  const x = h('button', 'mt-ax', '×'); x.setAttribute('aria-label', 'Fechar'); x.onclick = () => { haptic(); close(); };
  alertBox = h('div', 'mt-alert', h('div', 'mt-abox', x,
    h('div', 'mt-ahead', ring, h('div', null, when, h('div', 'mt-atitle', ev.title), h('div', 'mt-asub', `${hm(ev.start)} – ${hm(ev.end)}${ev.people ? ` · ${ev.people} pessoas` : ''}`))),
    h('div', 'mt-arow', go, goTab, later)));
  document.body.append(alertBox);
  const tick = setInterval(() => { ring.textContent = String(left()); when.textContent = left() > 0 ? `Começa em ${left()} min` : 'Começando agora'; if (Date.now() > ev.end) close(); }, 15000);
}
async function checkAlerts() {
  if (!meetPage() || document.body.classList.contains('night')) return;
  const j = await load();
  if (!j || j.call?.inCall) return;
  const lead = Number.isFinite(+opts().alertMin) ? +opts().alertMin : 5, now = Date.now();
  for (const ev of j.today || []) {
    if (!ev.meet) continue;
    // two alerts: a few minutes before (quiet: vibration), and at the start time (loud alarm and voice)
    const key = `${ev.start}|${ev.title}`, keyGo = key + '|go';
    if (!alerted.has(keyGo) && now >= ev.start - 20000 && now < ev.start + 5 * 60000) { alerted.add(keyGo); alerted.add(key); showAlert(ev, true); break; }
    if (!alerted.has(key) && lead > 0 && now >= ev.start - lead * 60000 && now < ev.start - 20000) { alerted.add(key); showAlert(ev, false); break; }
  }
}
setInterval(checkAlerts, 10000);
setTimeout(checkAlerts, 5000);

W.meetings = {
  needs: ['tick'],
  create(box, { o, page }) {
    box.classList.add('mt');
    const day = h('div', 'mt-day'), list = h('div', 'mt-list'), note = h('div', 'mt-note');
    const nextLbl = h('div', 'mt-lbl', 'Próxima reunião'), big = h('div', 'mt-big'), ttl = h('div', 'mt-ttl'), sub = h('div', 'mt-sub');
    const joinBtn = h('button', 'mt-join solid', 'Entrar');
    const btn = (k, label, cls = '') => { const b = h('button', 'mt-cb ' + cls); b.innerHTML = SVG[k]; b.append(h('span', null, label)); return b; };
    const bMic = btn('mic', 'Microfone'), bCam = btn('cam', 'Câmera'), bHand = btn('hand', 'Mão'), bCc = btn('cc', 'Legendas'), bLeave = btn('leave', 'Sair', 'leave');
    const bTab = btn('screen', 'Ver o Meet no tablet', 'wide');
    const ctl = h('div', 'mt-ctl', bMic, bCam, bHand, bCc, bLeave, bTab);
    const live = h('div', 'mt-live', h('span', 'mt-dot'), 'Em chamada no Meet');
    box.append(h('div', 'mt-ag', h('div', 'mt-lbl', 'Hoje'), day, list, note), h('div', 'mt-side', nextLbl, big, ttl, sub, joinBtn, live, ctl));
    // four looks: Lista (the list and the next meeting), Linha do tempo, Foco na próxima, Relógio do dia. The small button
    // in the corner switches them; the choice is kept on this tablet (or set in the page's options).
    const LOOKS = ['lista', 'linha', 'foco', 'relogio'], NAMES = { lista: 'Lista', linha: 'Linha do tempo', foco: 'Foco na próxima', relogio: 'Relógio do dia' };
    let look = 'lista';
    try { look = localStorage.getItem('federano.meetLook') || o?.look || 'lista'; } catch (_) { look = o?.look || 'lista'; }
    if (!LOOKS.includes(look)) look = 'lista';
    const alt = h('div', 'mt-alt'); const lookBtn = h('button', 'mt-lookbtn'); lookBtn.setAttribute('aria-label', 'Trocar o visual');
    box.append(alt, lookBtn);
    const setLook = (l) => { look = l; box.dataset.look = l; lookBtn.textContent = NAMES[l] + ' ▸'; try { localStorage.setItem('federano.meetLook', l); } catch (_) {} altKey = ''; render(); };
    lookBtn.onclick = () => { haptic(); setLook(LOOKS[(LOOKS.indexOf(look) + 1) % LOOKS.length]); };
    let altKey = '';
    alt.addEventListener('click', (e) => {
      const el = e.target.closest('[data-act]'); if (!el) return;
      const [act, arg] = el.dataset.act.split(':');
      if (act === 'join') { const ev = (data?.today || [])[+arg]; if (ev) join(ev, el.dataset.tab === '1'); }
      else if (act === 'press') press(arg);
      else if (act === 'tablet') showOnTablet();
    });
    let cur = null;

    const press = async (cmd) => { haptic(); const r = await post(`/meet/press/${cmd}`); if (!r.ok) toast(r.error || 'O Meet não respondeu.', 'err'); setTimeout(() => load(true).then(render), 1300); };
    bMic.onclick = () => press('mic'); bCam.onclick = () => press('cam'); bHand.onclick = () => press('hand'); bCc.onclick = () => press('captions');
    bLeave.onclick = () => press('leave');
    bTab.onclick = showOnTablet;
    joinBtn.onclick = () => cur && join(cur, false);

    const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const clockTxt = (left) => { const m = Math.floor(left / 60000), s = Math.floor(left / 1000) % 60; return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`; };
    const CTL = (call) => `<div class="mt-a-ctl${call ? '' : ' idle'}">
      <button data-act="press:mic" class="mt-a-cb${call && call.mic === false ? ' off' : ''}">${SVG[call && call.mic === false ? 'micOff' : 'mic']}</button>
      <button data-act="press:cam" class="mt-a-cb${call && call.cam === false ? ' off' : ''}">${SVG[call && call.cam === false ? 'camOff' : 'cam']}</button>
      <button data-act="press:hand" class="mt-a-cb${call && call.hand ? ' on' : ''}">${SVG.hand}</button>
      <button data-act="tablet" class="mt-a-cb">${SVG.screen}</button>
      <button data-act="press:leave" class="mt-a-cb leave">${SVG.leave}</button></div>`;
    // the parts that do not change every second are rebuilt only when the data changes; the countdown is set each second
    // the timeline and the dial show 12 hours: from 3 hours before the next meeting (or now), on the hour
    const win = (cur, now) => { const d = new Date((cur ? Math.min(cur.start, Math.max(now, cur.start - 3 * 3600000)) : now) - 3 * 3600000); d.setMinutes(0, 0, 0); return d.getTime(); };
    const H12 = 12 * 3600000;
    function renderAlt(j, evs, cur, call, now) {
      if (look === 'lista') { alt.hidden = true; return; }
      alt.hidden = false;
      const ci = cur ? evs.indexOf(cur) : -1, inMeeting = cur && cur.start <= now;
      const left = cur ? (inMeeting ? cur.end - now : cur.start - now) : 0;
      const key = JSON.stringify([look, evs.map((e) => [e.start, e.title, e.meet]), ci, call, !!inMeeting, data?.calendars]);
      if (key !== altKey) {
        altKey = key;
        const joinBtns = cur && cur.meet && !call ? `<button class="mt-a-join solid" data-act="join:${ci}">Entrar</button><button class="mt-a-join" data-act="join:${ci}" data-tab="1">Entrar e ver no tablet</button>` : '';
        const empty = !evs.length ? `<div class="mt-a-empty">${data && !data.calendars ? 'Cole o endereço secreto iCal da agenda “Trabalho” nas configurações do Federano no PC.' : 'Nenhuma reunião hoje.'}</div>` : '';
        const head = cur ? `<div class="mt-lbl mt-red">${inMeeting ? 'Agora' : 'Próxima reunião'}</div><div class="mt-a-title">${esc(cur.title)}</div><div class="mt-sub">${hm(cur.start)} – ${hm(cur.end)}${cur.meet ? ' · Google Meet' : cur.location ? ' · ' + esc(cur.location) : ''}${cur.people ? ` · ${cur.people} pessoas` : ''}</div>` : '<div class="mt-a-title">Nada mais hoje</div>';
        if (look === 'linha') {
          const w0 = win(cur, now), x = (t) => Math.max(0, Math.min(100, (t - w0) / H12 * 100));
          const hours = Array.from({ length: 6 }, (_, k) => w0 + k * 2 * 3600000);
          alt.innerHTML = `<div class="mt-lbl">Hoje · trabalho</div>
            <div class="mt-a-tl"><i class="axis"></i>${hours.map((t) => `<span class="hr" style="left:${x(t)}%">${new Date(t).getHours()}h</span>`).join('')}
              ${evs.filter((e) => e.end > w0 && e.start < w0 + H12).map((e) => [e, evs.indexOf(e)]).map(([e, k]) => `<div class="blk${e.end <= now ? ' past' : ''}${k === ci ? ' next' : ''}" style="left:${x(e.start)}%;width:${Math.max(4, x(e.end) - x(e.start))}%">${esc(e.title)}</div>`).join('')}
              <i class="nowl"></i></div>${empty}
            <div class="mt-a-card"><div>${head}<div class="mt-a-row">${joinBtns}</div></div><div class="mt-a-right"><div class="mt-a-cd"></div>${CTL(call)}</div></div>`;
        } else if (look === 'foco') {
          alt.innerHTML = `<div class="mt-a-focus">${empty || `${head.replace('mt-a-title', 'mt-a-title big')}<div class="mt-a-cd huge"></div><div class="mt-lbl">${inMeeting ? 'restantes' : 'para começar'}</div><div class="mt-a-row center">${joinBtns}</div>${call ? CTL(call) : ''}`}</div>
            <div class="mt-a-strip">${evs.filter((e) => e !== cur).slice(0, 3).map((e) => `<div class="${e.end <= now ? 'past' : ''}"><span>${hm(e.start)}${e.end <= now ? ' · feita' : ''}</span><b>${esc(e.title)}</b></div>`).join('')}</div>`;
        } else {
          alt.innerHTML = `<div class="mt-a-dialw"><canvas class="mt-a-dial" width="800" height="800"></canvas><div class="mt-a-dialc"><div class="mt-lbl mt-red">${cur ? (inMeeting ? 'restam' : 'em') : ''}</div><div class="mt-a-cd"></div><div class="mt-a-dt">${cur ? esc(cur.title) : 'Nada mais hoje'}</div></div></div>
            <div class="mt-a-list">${evs.map((e, k) => `<div class="li${e.end <= now ? ' past' : ''}${k === ci ? ' next' : ''}"><span>${hm(e.start)} – ${hm(e.end)}</span><b>${esc(e.title)}</b></div>`).join('')}${empty}<div class="mt-a-row">${joinBtns}</div>${call ? CTL(call) : ''}</div>`;
        }
      }
      alt.querySelectorAll('.mt-a-cd').forEach((el) => { el.textContent = cur ? clockTxt(left) : '—'; });
      const nl = alt.querySelector('.nowl'); if (nl) nl.style.left = Math.max(0, Math.min(100, (now - win(cur, now)) / H12 * 100)) + '%';
      const cv = alt.querySelector('.mt-a-dial'); if (cv) drawDial(cv, evs, ci, now, win(cur, now));
    }
    function drawDial(cv, evs, ci, now, w0) {
      const g = cv.getContext('2d'), R = 330, cx = 400, cy = 400, css = getComputedStyle(box);
      const red = css.getPropertyValue('--accent').trim() || '#ff2a4f', muted = css.getPropertyValue('--muted').trim() || '#8a8a90';
      const ang = (t) => -Math.PI / 2 + (t - w0) / H12 * Math.PI * 2;
      g.clearRect(0, 0, 800, 800);
      g.lineWidth = 34; g.strokeStyle = 'rgba(255,255,255,.07)'; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
      g.font = '22px ui-monospace, monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = muted;
      for (let k = 0; k < 12; k += 2) { const t = w0 + k * 3600000, a = ang(t); g.fillText(new Date(t).getHours() + 'h', cx + Math.cos(a) * (R - 62), cy + Math.sin(a) * (R - 62)); }
      evs.forEach((e, k) => { if (e.end <= w0 || e.start >= w0 + H12) return; g.strokeStyle = k === ci ? red : e.end <= now ? 'rgba(255,255,255,.18)' : muted; g.lineWidth = 34;
        g.beginPath(); g.arc(cx, cy, R, ang(Math.max(w0, e.start)), ang(Math.min(w0 + H12, e.end))); g.stroke(); });
      const a = ang(Math.min(w0 + H12, Math.max(w0, now))); g.strokeStyle = red; g.lineWidth = 4; g.beginPath(); g.moveTo(cx + Math.cos(a) * (R - 100), cy + Math.sin(a) * (R - 100)); g.lineTo(cx + Math.cos(a) * (R + 26), cy + Math.sin(a) * (R + 26)); g.stroke();
    }
    function render() {
      const j = data;
      if (!j) return;
      const now = Date.now(), evs = j.today || [];
      day.innerHTML = '';
      day.append(h('b', null, String(evs.length)), evs.length === 1 ? ' reunião' : ' reuniões');
      list.replaceChildren(...evs.map((ev) => {
        const past = ev.end <= now, on = ev.start <= now && now < ev.end;
        const right = ev.meet ? (() => { const b = h('button', 'mt-join' + (on || (!past && ev.start - now < 15 * 60000) ? ' solid' : ''), 'Entrar'); b.onclick = () => join(ev, false); return b; })()
          : h('span', 'mt-lbl', past ? 'feita' : 'sem link');
        return h('div', 'mt-ev' + (past ? ' past' : '') + (on ? ' on' : ''), h('span', 'mt-t', hm(ev.start)),
          h('div', null, h('b', null, ev.title), h('small', null, [durTxt(ev.start, ev.end), ev.meet ? 'Meet' : ev.location, ev.people ? `${ev.people} pessoas` : ''].filter(Boolean).join(' · '))), right);
      }));
      note.textContent = !j.calendars && !evs.length ? 'Para ver suas reuniões, cole o endereço secreto iCal do Google Agenda nas configurações do Federano no PC (Geral › Calendários).'
        : !evs.length ? 'Nenhuma reunião hoje.' : '';
      cur = evs.find((ev) => ev.end > now) || null;
      const call = j.call && j.call.inCall ? j.call : null;
      box.classList.toggle('mt-incall', !!call);
      if (cur) {
        const inMeeting = cur.start <= now;
        nextLbl.textContent = inMeeting ? 'Agora' : 'Próxima reunião';
        const left = inMeeting ? cur.end - now : cur.start - now, m = Math.floor(left / 60000), s = Math.floor(left / 1000) % 60;
        big.innerHTML = '';
        big.append(m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`, h('small', null, inMeeting ? ' restantes' : ' min'));
        ttl.textContent = cur.title; sub.textContent = `${hm(cur.start)} – ${hm(cur.end)}${cur.meet ? ' · Google Meet' : cur.location ? ' · ' + cur.location : ''}`;
        joinBtn.hidden = !cur.meet || !!call;
      } else { nextLbl.textContent = 'Próxima reunião'; big.textContent = '—'; ttl.textContent = 'Nada mais hoje'; sub.textContent = ''; joinBtn.hidden = true; }
      bMic.innerHTML = SVG[call && call.mic === false ? 'micOff' : 'mic']; bMic.append(h('span', null, 'Microfone')); bMic.classList.toggle('off', !!call && call.mic === false);
      bCam.innerHTML = SVG[call && call.cam === false ? 'camOff' : 'cam']; bCam.append(h('span', null, 'Câmera')); bCam.classList.toggle('off', !!call && call.cam === false);
      bHand.classList.toggle('on', !!call && call.hand === true);
      renderAlt(j, evs, cur, call, now);
    }
    let alive = true;
    const visible = () => pages[curPage] === page;
    const loop = async () => { if (!alive) return; if (visible()) { await load(!!(data && data.call)); render(); } setTimeout(loop, data && data.call ? 2000 : 10000); };
    box.dataset.look = look; lookBtn.textContent = NAMES[look] + ' ▸';
    load(true).then(render); loop();
    return { update() { render(); }, destroy() { alive = false; } };
  },
};
