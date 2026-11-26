import { closeOverview, h, haptic, toast } from './main.js';

// ---------------------------------------------------------------- Federano: themes
// "Temas" (overview › Temas): the panel's look, chosen on this tablet. Tema 00 is the look the panel always had; Tema 01
// "Minimalista" is pure black, thin type and a single red, with its own animations on the lyrics and podcast pages. The
// choice is kept on the tablet (localStorage) and set as body[data-ftheme]; widgets read it from there.

export const THEMES = [
  { id: '00', name: 'Tema 00', sub: 'Atual', desc: 'O visual de sempre: fundo escuro, cores da capa da música e linhas coloridas atrás da letra.' },
  { id: '01', name: 'Tema 01', sub: 'Minimalista', desc: 'Preto puro, letras finas e um vermelho só. A letra cantada brilha na batida e os botões ganham animações.' },
];
const KEY = 'federano.ftheme';

export function currentTheme() {
  let id = '00';
  try { id = localStorage.getItem(KEY) || '00'; } catch (_) {}
  return THEMES.some((t) => t.id === id) ? id : '00';
}

export function applyTheme(id = currentTheme()) {
  document.body.dataset.ftheme = id;
  window.dispatchEvent(new CustomEvent('federano-theme', { detail: id }));
}

export function setTheme(id) {
  try { localStorage.setItem(KEY, id); } catch (_) {}
  applyTheme(id);
}

// a small still picture of each theme (CSS only), drawn inside its card
const mini = (id) => id === '01'
  ? `<div class="th-mini th-m01"><i class="a"></i><i class="b"></i><i class="c"></i><span class="wave"></span><div class="cd"><i class="ph"></i><i class="t"></i><i class="r"></i></div></div>`
  : `<div class="th-mini th-m00"><i class="a"></i><i class="b"></i><i class="c"></i><span class="lines"></span><div class="cd"><i class="ph"></i><i class="t"></i><i class="r"></i></div></div>`;

let sheet = null;
export function openThemes() {
  haptic();
  closeOverview();   // the picker takes the whole screen
  if (sheet) sheet.remove();
  const cur = currentTheme();
  const close = h('button', 'th-close', '×'); close.setAttribute('aria-label', 'Fechar');
  const list = h('div', 'th-list');
  for (const t of THEMES) {
    const card = h('button', 'th-card' + (t.id === cur ? ' on' : ''));
    card.innerHTML = mini(t.id);
    card.append(h('div', 'th-name', h('b', null, t.name), h('span', null, t.sub), t.id === cur ? h('em', null, 'Em uso') : ''), h('p', 'th-desc', t.desc));
    card.onclick = () => { setTheme(t.id); closeOverview(); toast(`${t.name} · ${t.sub} aplicado`); sheet.remove(); sheet = null; };
    list.append(card);
  }
  sheet = h('div', 'th-sheet', h('div', 'th-head', h('b', null, 'Temas'), h('span', null, 'Escolha o visual do painel. Dá para voltar quando quiser.'), close), list);
  sheet.id = 'themes';
  close.onclick = () => { haptic(); sheet.remove(); sheet = null; };
  document.body.append(sheet);
}

applyTheme();
