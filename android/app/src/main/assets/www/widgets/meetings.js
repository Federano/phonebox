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
  create(box, { page }) {
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
    let cur = null;

    const press = async (cmd) => { haptic(); const r = await post(`/meet/press/${cmd}`); if (!r.ok) toast(r.error || 'O Meet não respondeu.', 'err'); setTimeout(() => load(true).then(render), 1300); };
    bMic.onclick = () => press('mic'); bCam.onclick = () => press('cam'); bHand.onclick = () => press('hand'); bCc.onclick = () => press('captions');
    bLeave.onclick = () => press('leave');
    bTab.onclick = showOnTablet;
    joinBtn.onclick = () => cur && join(cur, false);

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
    }
    let alive = true;
    const visible = () => pages[curPage] === page;
    const loop = async () => { if (!alive) return; if (visible()) { await load(!!(data && data.call)); render(); } setTimeout(loop, data && data.call ? 2000 : 10000); };
    load(true).then(render); loop();
    return { update() { render(); }, destroy() { alive = false; } };
  },
};
