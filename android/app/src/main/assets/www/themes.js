import { closeOverview, curPage, gotoPageRef, h, haptic, homeIndex, openNowPlaying, openOverview, pages, toast } from './main.js';

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

// ---------------------------------------------------------------- Tema 01: the side rail (Modelo A)
// A column of icons on the left edge: Início, Reuniões, Música, Temas and Ajustes (all pages). Only in Tema 01.
const ICO = {
  home: '<path d="M4 11.5 12 5l8 6.5V20h-5v-5H9v5H4z"/>',
  meet: '<rect x="4" y="5.5" width="16" height="14" rx="2"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
  music: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
  themes: '<path d="M12 4a8 8 0 1 0 0 16c1.2 0 1.6-.8 1.6-1.6 0-1.4-1.3-1.6-1.3-2.8 0-1 .8-1.6 1.8-1.6H16a4 4 0 0 0 4-4C20 6.6 16.4 4 12 4z"/><circle cx="8" cy="11" r="1"/><circle cx="11" cy="7.8" r="1"/><circle cx="15" cy="8.6" r="1"/>',
  more: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>',
};
const pageWith = (type) => pages.findIndex((p) => (p.widgets || []).some((w) => w.type === type));
const ITEMS = [
  ['home', 'Início', () => homeIndex(), () => gotoPageRef(pages[homeIndex()]?.id)],
  ['meet', 'Reuniões', () => pageWith('meetings'), () => gotoPageRef(pages[pageWith('meetings')]?.id)],
  ['music', 'Música', () => pageWith('lyrics'), () => openNowPlaying()],
  ['themes', 'Temas', () => -1, () => openThemes()],
  ['more', 'Ajustes', () => -1, () => openOverview()],
];
const rail = h('nav', 'f-rail'); rail.setAttribute('aria-label', 'Navegação');
const railBtn = (ico, label, go, svg = ICO[ico]) => {
  const b = h('button', 'f-rail-i'); b.dataset.k = ico; b.setAttribute('aria-label', label);
  b.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${svg}</svg><span></span>`;
  b.querySelector('span').textContent = label;
  b.onclick = () => { haptic(); go(); };
  return b;
};
const fixed = ITEMS.map(([ico, label, , go]) => railBtn(ico, label, go));
// quick shortcuts: pages the user pins to the rail (kept on this tablet), between Temas and Ajustes
const PIN = '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>';
const pinBox = h('div', 'f-rail-pins');
const addBtn = railBtn('add', 'Atalho', () => openPins(), '<path d="M12 5v14M5 12h14"/>');
let pins = [];
try { pins = JSON.parse(localStorage.getItem('federano.railPins') || '[]').filter((x) => typeof x === 'string'); } catch (_) {}
const savePins = () => { try { localStorage.setItem('federano.railPins', JSON.stringify(pins)); } catch (_) {} drawPins(); };
function drawPins() {
  pinBox.replaceChildren(...pins.map((id) => pages.find((p) => p.id === id)).filter(Boolean)
    .map((p) => { const b = railBtn('pin', p.title || p.id, () => gotoPageRef(p.id), PIN); b.dataset.page = p.id; return b; }));
}
function openPins() {
  const list = h('div', 'th-list f-pin-list');
  for (const p of pages) {
    const on = pins.includes(p.id);
    const row = h('button', 'f-pin' + (on ? ' on' : ''), h('b', null, p.title || p.id), h('span', null, on ? 'Na barra ✓' : 'Adicionar'));
    row.onclick = () => { haptic(); pins = on ? pins.filter((x) => x !== p.id) : [...pins, p.id]; savePins(); box.remove(); openPins(); };
    list.append(row);
  }
  const close = h('button', 'th-close', '×'); close.setAttribute('aria-label', 'Fechar');
  const box = h('div', 'th-sheet', h('div', 'th-head', h('b', null, 'Atalhos da barra'), h('span', null, 'Toque numa página para colocar ou tirar da barra lateral.'), close), list);
  box.id = 'railPins';
  close.onclick = () => { haptic(); box.remove(); };
  document.getElementById('railPins')?.remove();
  document.body.append(box);
}
rail.append(...fixed.slice(0, 4), pinBox, addBtn, fixed[4]);
setTimeout(drawPins, 1500);   // the pages arrive from the PC a moment after start
document.body.append(rail);
// a small tab on the rail's edge hides it (the pages take the whole width) and brings it back; kept on this tablet
const railTog = h('button', 'f-rail-tog');
const showRail = (hidden) => {
  document.body.classList.toggle('f-rail-off', hidden);
  railTog.setAttribute('aria-label', hidden ? 'Mostrar a barra lateral' : 'Esconder a barra lateral');
  railTog.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="${hidden ? 'M10 7l5 5-5 5' : 'M14 7l-5 5 5 5'}"/></svg>`;
  try { localStorage.setItem('federano.railHidden', hidden ? '1' : '0'); } catch (_) {}
};
let railHidden = false;
try { railHidden = localStorage.getItem('federano.railHidden') === '1'; } catch (_) {}
showRail(railHidden);
railTog.onclick = () => { haptic(); showRail(!document.body.classList.contains('f-rail-off')); };
document.body.append(railTog);
// shortcut: polls the current page twice a second to light its icon; an event from goPage would be exact
setInterval(() => {
  if (document.body.dataset.ftheme !== '01') return;
  ITEMS.forEach(([ico, , at], i) => {
    const b = fixed[i], n = at();
    b.hidden = ico === 'meet' && n < 0;
    b.classList.toggle('on', n >= 0 && n === curPage);
  });
  for (const b of pinBox.children) b.classList.toggle('on', pages[curPage]?.id === b.dataset.page);
  if (pinBox.children.length !== pins.filter((id) => pages.some((p) => p.id === id)).length) drawPins();
}, 500);

applyTheme();
