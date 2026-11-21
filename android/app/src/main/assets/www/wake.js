import { API, PANEL_HEADERS, bridge, cfg, gotoSkillPage, toast } from './main.js';
import { openMirror } from './mirror.js';

// ---------------------------------------------------------------- Federano: wake word
// Settings › Federano › "Microfone do tablet sempre ouvindo": the tablet listens in short rounds with the app's speech
// recognizer (on the tablet only, by default: Android 12's on-device recognizer) and runs what comes after "Federano"
// ("Federano, próxima música") through the agent's skills, like the microphone button. "Federano" alone waits a few
// seconds for the command. Nothing is kept. Off unless turned on; it pauses at night, with the screen off, and while
// another microphone (the dictation widget, the mirror's button) is in use.

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
let sid = 0, timer = 0, backoffUntil = 0, armedUntil = 0, othersUntil = 0, warned = '';

const on = () => !!(cfg.federano && cfg.federano.wakeWord) && !!(bridge && bridge.listen && bridge.canListen);
function schedule(ms) { clearTimeout(timer); timer = setTimeout(round, ms); }
function round() {
  if (sid) return;
  const now = Date.now();
  if (!on() || document.hidden || document.body.classList.contains('night') || now < backoffUntil || now < othersUntil) { schedule(3000); return; }
  try { if (!bridge.canListen()) { schedule(60_000); return; } } catch (_) { schedule(60_000); return; }
  sid = bridge.listen('pt-BR', cfg.federano.wakeOffline !== false) || 0;
  if (!sid) schedule(5000);
}
const warnOnce = (key, text) => { if (warned !== key) { warned = key; toast(text, 'err'); } };

const prev = window.onAndroidSpeech;
window.onAndroidSpeech = (kind, text, id) => {
  if (!sid || id !== sid) {
    // another microphone is listening: stay quiet until it is done (starting a round would cancel it)
    if (kind === 'ready' || kind === 'partial') othersUntil = Date.now() + 8000;
    else if (kind === 'final' || kind === 'error') othersUntil = Date.now() + 1500;
    if (prev) prev(kind, text, id);
    return;
  }
  if (kind === 'final') { sid = 0; heard(text); schedule(250); return; }
  if (kind !== 'error') return;
  sid = 0;
  switch (text) {
    case 'cancelled': schedule(4000); break;   // another microphone took over
    case 'offline-unsupported': case 'offline-unavailable':
      warnOnce(text, 'Este tablet não reconhece voz sem internet: desligue "Reconhecer a voz só no tablet" nas configurações do PC.');
      backoffUntil = Date.now() + 10 * 60_000; schedule(3000); break;
    case 'permission': case 'permission-blocked':
      warnOnce(text, 'O Federano precisa do microfone: permita nas configurações do app no tablet.');
      backoffUntil = Date.now() + 10 * 60_000; schedule(3000); break;
    case 'unavailable': backoffUntil = Date.now() + 10 * 60_000; schedule(3000); break;
    case '8': schedule(2000); break;            // recognizer busy
    case '6': case '7': schedule(250); break;   // nobody spoke / nothing understood: listen again
    default: schedule(3000);
  }
};

function heard(text) {
  const words = String(text || '').trim().split(/\s+/);
  const at = words.findIndex((w) => norm(w).replace(/[^a-z]/g, '') === 'federano');
  if (at >= 0) {
    const rest = words.slice(at + 1).join(' ').replace(/^[\s,.!?:;]+/, '').trim();
    if (!rest) { armedUntil = Date.now() + 8000; toast('Estou ouvindo…'); return; }
    armedUntil = 0; run(rest);
  } else if (Date.now() < armedUntil) { armedUntil = 0; run(text.trim()); }
}

async function run(cmd) {
  if (!cmd) return;
  toast(`“${cmd}” …`);
  try {
    const r = await fetch(`${API}/skills/run?text=${encodeURIComponent(cmd)}`, { method: 'POST', cache: 'no-store', headers: PANEL_HEADERS });
    const j = await r.json();
    if (j.reply) toast(j.reply, j.ok === false ? 'err' : '');
    if (j.open && bridge && bridge.openVideo) bridge.openVideo(j.open);
    if (j.mirror) openMirror(j.reply || '');
    if (j.page) gotoSkillPage(j.page);
  } catch (_) { toast('Não consegui falar com o PC.', 'err'); }
}

document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(1000); });
schedule(4000);

// for the tests: what a round heard
export const __wake = { heard, state: () => ({ sid, armedUntil }) };
