import { API, PANEL_HEADERS, bridge, curPage, h, haptic, icon, pages, toast } from '../main.js';
import { W } from '../registry.js';

// ---------------------------------------------------------------- Federano
// "Falar com o Federano": tap the microphone (the phone's speech recognizer, as in the dictation widget) or type, and
// the text goes to the agent's skills (POST /api/skills/run). The skill's answer is shown here. No AI: a skill runs
// when one of its trigger phrases is in what was said.

const sessions = new Map();
const prevSpeech = window.onAndroidSpeech;
window.onAndroidSpeech = (kind, text, id) => {
  const handler = sessions.get(id);
  if (handler) handler(kind, text); else if (prevSpeech) prevSpeech(kind, text, id);
};

W.federano = {
  needs: ['tick'],
  create(box, { o, page }) {
    box.classList.add('fd');
    const title = h('div', 'fd-title', o.title || 'Federano');
    const reply = h('div', 'fd-reply', o.hint || 'Toque no microfone ou digite. Ex.: "o que está tocando?"');
    const said = h('div', 'fd-said');
    const mic = h('button', 'fd-mic', icon('mic'));
    mic.setAttribute('aria-label', 'Falar');
    const input = h('input', 'fd-input');
    input.type = 'text'; input.placeholder = 'Digite para o Federano…'; input.maxLength = 500;
    const go = h('button', 'fd-go', '➤');
    const row = h('div', 'fd-row', mic, input, go);
    const quick = h('div', 'fd-quick');
    for (const [label, text] of [['📺 Levar vídeo para o tablet', 'joga pro tablet'], ['🎵 O que está tocando?', 'o que está tocando']]) {
      const b = h('button', 'fd-chip', label);
      b.onclick = () => { haptic(); ask(text); };
      quick.append(b);
    }
    box.append(title, reply, said, quick, row);

    let alive = true, session = 0, watch = 0;
    const can = !!(bridge && bridge.listen && bridge.canListen);
    const visible = () => !document.body.classList.contains('night') && pages[curPage] === page && !box.closest('.stack-item:not(.active)');
    const done = () => { sessions.delete(session); session = 0; mic.classList.remove('on'); clearInterval(watch); watch = 0; };
    const guard = () => { if (session && !visible()) { bridge.cancelListening(session); done(); } };

    async function ask(text) {
      text = String(text || '').trim();
      if (!text) return;
      said.textContent = '“' + text + '”';
      reply.textContent = '…';
      box.classList.add('busy');
      try {
        const r = await fetch(`${API}/skills/run?text=${encodeURIComponent(text)}`, { method: 'POST', cache: 'no-store', headers: PANEL_HEADERS });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const j = await r.json();
        if (alive) { reply.textContent = j.reply || '—'; box.classList.toggle('miss', !j.skill); }
        if (j.open) {
          if (bridge && bridge.openVideo) bridge.openVideo(j.open);
          else if (alive) reply.textContent += ' (Atualize o app Federano para abrir o vídeo.)';
        }
      } catch (e) {
        if (alive) { reply.textContent = 'Não consegui falar com o PC.'; toast(e?.message || 'offline', 'err'); }
      } finally { box.classList.remove('busy'); }
    }

    function onSpeech(kind, text) {
      if (!alive) return;
      if (kind === 'ready') { said.textContent = ''; reply.textContent = 'Ouvindo…'; }
      else if (kind === 'partial') said.textContent = text;
      else if (kind === 'final') { done(); if (text.trim()) ask(text); else reply.textContent = 'Não ouvi nada. Toque de novo.'; }
      else if (kind === 'error') { done(); reply.textContent = text === 'cancelled' ? '' : 'Não entendi. Toque de novo.'; }
    }

    mic.onclick = () => {
      haptic();
      if (!can || !bridge.canListen()) { reply.textContent = 'Este aparelho não tem reconhecimento de voz. Digite abaixo.'; input.focus(); return; }
      if (session) { bridge.stopListening(session); return; }
      session = bridge.listen(String(o.language || 'pt-BR').trim(), false) || 0;
      if (!session) return;
      sessions.set(session, onSpeech);
      watch = setInterval(guard, 500);
      mic.classList.add('on');
      reply.textContent = 'Ouvindo…';
    };
    const send = () => { haptic(); const v = input.value; input.value = ''; input.blur(); ask(v); };
    go.onclick = send;
    input.onkeydown = (e) => { if (e.key === 'Enter') send(); };

    return {
      update() { guard(); },
      destroy() { alive = false; if (session) bridge.cancelListening(session); done(); },
    };
  },
};
