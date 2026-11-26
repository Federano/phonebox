import { API, I18n, PANEL_HEADERS, WIDGET_ICONS, applyEditorEdits, cfg, closeOverview, curPage, h, haptic, loadConfig, online, pages, toast, usePcPage } from './main.js';
import { editorCatalog, editorDraft, newWidgetId, primeEditor, queuePageEdit, setEditorOpen } from './edit-sync.js';

// ---------------------------------------------------------------- Federano: edit a page on the tablet
// Overview › Editar: the page being shown, as a 12 × 6 grid. Drag a widget to move it, pull its corner to resize it,
// × removes it, tap it for its options, + adds one. "Salvar" persists a local draft; edit-sync sends it to the agent
// when reachable, with a page revision and a retry ID. The agent backs up its settings first. PC-only widgets are set up on the PC
// only: here they can be moved, resized or removed (the agent enforces the same rules).

const COLS = 12, ROWS = 6;
const PT = {
  clock: 'Relógio', analog: 'Relógio analógico', worldclock: 'Relógios do mundo', calendar: 'Calendário', agenda: 'Agenda', progress: 'Progresso do tempo',
  countdown: 'Contagem regressiva', pomodoro: 'Pomodoro', timer: 'Timer rápido', stopwatch: 'Cronômetro', weather: 'Tempo', forecast: 'Previsão',
  sun: 'Sol e lua', air: 'Qualidade do ar', stat: 'Número (CPU, RAM…)', gauge: 'Medidor', chart: 'Gráfico', meters: 'Memória e discos', gpu: 'Placa de vídeo',
  topprocs: 'Processos que mais usam', processes: 'Processos', media: 'Tocando agora', volume: 'Volume', spectrum: 'Barras do som', shortcuts: 'Atalhos',
  button: 'Botão grande', trackpad: 'Touchpad', discord: 'Discord', obs: 'OBS Studio', lyrics: 'Letra da música', federano: 'Falar com o Federano',
  dictate: 'Ditado', quotas: 'Cotas de IA', sessions: 'Sessões de IA', note: 'Nota', checklist: 'Lista', counter: 'Contador', breathe: 'Respirar',
  quote: 'Frase', label: 'Título', battery: 'Bateria do tablet', batteries: 'Baterias dos aparelhos', inbox: 'Notificações', feeds: 'Notícias',
  exchange: 'Câmbio', crypto: 'Cripto', photos: 'Porta-retratos', wordclock: 'Relógio de palavras', nextup: 'Próximo compromisso', moon: 'Lua',
  playlists: 'Playlists', 'media-queue': 'Fila do Spotify', 'media-favorites': 'Favoritos do Spotify', radio: 'Rádio online', 'meeting-timer': 'Timer de reunião',
};
const pt = (text) => I18n ? I18n.tc(text, 'pt') : text;
const name = (d) => PT[d.type] || pt(d.name) || d.type;
// Translate display text for new widgets only; IDs, choice values and existing user text stay unchanged.
const defaultValue = (o) => {
  if (['text', 'textarea'].includes(o.type) && ['title', 'label', 'text', 'caption'].includes(o.key)) return pt(o.default);
  if (o.type === 'lines' && o.key === 'items' && Array.isArray(o.default)) return o.default.map(pt);
  return o.default;
};

let catalog = null, rules = null;
async function load() {
  const cached = editorCatalog(cfg.editorPcId) || await primeEditor(cfg.editorPcId, API, PANEL_HEADERS);
  if (!cached) throw new Error('Conecte este tablet ao PC uma vez para preparar a edição offline.');
  catalog = cached.catalog; rules = cached.rules;
  catalog.byType = Object.fromEntries(catalog.widgets.map((d) => [d.type, d]));
}
const pcOnly = (type) => !rules || rules.pcOnly.includes(type);
const editable = (type) => (rules && rules.editable[type]) || [];

export async function openEditor() {
  haptic();
  closeOverview();
  const page = pages[curPage];
  if (!page) return;
  if (document.querySelector('.ed')) return;
  setEditorOpen(true);
  try { await load(); } catch (e) { setEditorOpen(false); toast(e.message === 'offline' ? 'Conecte este tablet ao PC uma vez para preparar a edição offline.' : e.message, 'err'); return; }
  const pcId = cfg.editorPcId, sourceDraft = editorDraft(pcId, page.id);
  // a working copy of the page's widgets
  let items = (page.widgets || []).map((w) => ({ ...w, options: { ...(w.options || {}) }, changed: {} }));
  let sel = null;

  const grid = h('div', 'ed-grid');
  for (let i = 1; i < COLS; i++) { const l = h('i', 'ed-vl'); l.style.left = (i / COLS * 100) + '%'; grid.append(l); }
  for (let j = 1; j < ROWS; j++) { const l = h('i', 'ed-hl'); l.style.top = (j / ROWS * 100) + '%'; grid.append(l); }
  const side = h('div', 'ed-side');
  const bAdd = h('button', 'ed-btn', '+ Adicionar'), bCancel = h('button', 'ed-btn', 'Cancelar'), bSave = h('button', 'ed-btn ed-save', 'Salvar');
  const conflict = sourceDraft?.conflict;
  if (conflict?.kind === 'deleted') bSave.disabled = true;
  else if (conflict) bSave.textContent = 'Usar edição do tablet';
  const ov = h('div', 'ed', h('div', 'ed-head', h('b', null, 'Editar página'), h('span', null, `${page.icon || ''} ${page.title || ''}`.trim()), bAdd, bCancel, bSave),
    h('div', 'ed-body', h('div', 'ed-stage', grid), side));
  document.body.append(ov);

  const fits = (it, x, y, w, hh) => x >= 0 && y >= 0 && x + w <= COLS && y + hh <= ROWS &&
    !items.some((o) => o !== it && x < o.x + o.w && o.x < x + w && y < o.y + o.h && o.y < y + hh);
  const cell = () => { const r = grid.getBoundingClientRect(); return { r, cw: r.width / COLS, ch: r.height / ROWS }; };

  function render() {
    grid.querySelectorAll('.ed-w').forEach((e) => e.remove());
    for (const it of items) {
      const d = catalog.byType[it.type] || { type: it.type, name: it.type };
      const box = h('div', 'ed-w' + (it === sel ? ' on' : '') + (pcOnly(it.type) ? ' pc' : ''),
        h('span', 'ed-ic', WIDGET_ICONS[it.type] || d.icon || '▫️'), h('span', 'ed-nm', it.options.title || name(d)));
      Object.assign(box.style, { left: (it.x / COLS * 100) + '%', top: (it.y / ROWS * 100) + '%', width: (it.w / COLS * 100) + '%', height: (it.h / ROWS * 100) + '%' });
      const del = h('button', 'ed-del', '×'); del.setAttribute('aria-label', 'Remover');
      del.onpointerdown = (e) => e.stopPropagation();
      del.onclick = (e) => { e.stopPropagation(); haptic(); items = items.filter((o) => o !== it); if (sel === it) sel = null; render(); showSide(); };
      const rs = h('i', 'ed-rs');
      box.append(del, rs);
      drag(box, it, false); drag(rs, it, true);
      grid.append(box);
    }
  }

  // move (or resize, from the corner) with the finger, snapping to the grid; a spot that does not fit goes back
  function drag(el, it, resize) {
    el.addEventListener('pointerdown', (e) => {
      if (e.button) return;
      e.stopPropagation(); e.preventDefault();
      el.setPointerCapture(e.pointerId);
      const { cw, ch } = cell(), sx = e.clientX, sy = e.clientY, start = { x: it.x, y: it.y, w: it.w, h: it.h };
      const box = resize ? el.parentElement : el;
      let moved = false, nx = it.x, ny = it.y, nw = it.w, nh = it.h;
      const min = catalog.byType[it.type] || {};
      const move = (ev) => {
        const dx = Math.round((ev.clientX - sx) / cw), dy = Math.round((ev.clientY - sy) / ch);
        if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 6) moved = true;
        if (resize) { nw = Math.max(min.minW || 1, start.w + dx); nh = Math.max(min.minH || 1, start.h + dy); }
        else { nx = start.x + dx; ny = start.y + dy; }
        const ok = fits(it, nx, ny, nw, nh);
        box.classList.toggle('bad', !ok);
        Object.assign(box.style, { left: (nx / COLS * 100) + '%', top: (ny / ROWS * 100) + '%', width: (nw / COLS * 100) + '%', height: (nh / ROWS * 100) + '%' });
      };
      const up = () => {
        el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
        if (!moved) { sel = it; render(); showSide(); return; }
        if (fits(it, nx, ny, nw, nh)) { Object.assign(it, { x: nx, y: ny, w: nw, h: nh }); haptic(); } else toast('Não cabe aí.', 'err');
        sel = it; render(); showSide();
      };
      el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    });
  }

  // the options of the selected widget (only the simple ones)
  function showSide() {
    side.replaceChildren();
    if (conflict) {
      const message = conflict.kind === 'deleted' ? 'Esta página foi removida no PC. A cópia do tablet continua guardada.' : conflict.error || 'Esta página também mudou no PC. Escolha a versão do PC ou salve para aplicar a edição do tablet.';
      const discard = h('button', 'ed-btn ed-use-pc', 'Usar versão do PC');
      discard.onclick = () => { haptic(); usePcPage(page.id); close(); toast('Versão do PC restaurada.'); };
      side.append(h('p', 'ed-hint', message), discard);
    } else if (sourceDraft || online === false) side.append(h('p', 'ed-hint', 'Salvar guarda os ajustes neste tablet. Eles serão enviados quando o PC estiver acessível por USB ou rede.'));
    if (!sel) { side.append(h('p', 'ed-hint', 'Toque num widget para ver as opções. Arraste para mover, puxe o canto para mudar o tamanho, × remove.')); return; }
    const d = catalog.byType[sel.type] || { name: sel.type, options: [] };
    side.append(h('div', 'ed-st', h('span', null, WIDGET_ICONS[sel.type] || d.icon || ''), h('b', null, name(d))), h('p', 'ed-desc', pt(d.desc) || ''));
    if (pcOnly(sel.type)) { side.append(h('p', 'ed-hint', 'Este widget roda comandos ou usa endereços no PC, então as opções dele são só pelo PC. Aqui dá para mover, mudar o tamanho ou remover.')); return; }
    const keys = editable(sel.type);
    for (const o of (d.options || []).filter((x) => keys.includes(x.key))) {
      const cur = o.key in sel.options ? sel.options[o.key] : defaultValue(o);
      const set = (v) => { sel.options[o.key] = v; sel.changed[o.key] = v; if (o.key === 'title') render(); };
      const id = `ed-${sel.id || 'n'}-${o.key}`;
      let input;
      if (o.type === 'bool') { input = h('input'); input.type = 'checkbox'; input.checked = !!cur; input.onchange = () => set(input.checked); }
      else if (o.type === 'number') { input = h('input'); input.type = 'number'; if (o.min != null) input.min = o.min; if (o.max != null) input.max = o.max; input.value = cur ?? ''; input.onchange = () => { const n = Number(input.value); if (Number.isFinite(n)) set(n); }; }
      else if (o.type === 'select') { input = h('select', null, ...(o.choices || []).map((c) => { const [v, l] = Array.isArray(c) ? c : [c, c]; const op = h('option', null, pt(l)); op.value = v; return op; })); input.value = cur ?? ''; input.onchange = () => set(input.value); }
      else if (o.type === 'multi') {
        input = h('div', 'ed-multi', ...(o.choices || []).map((c) => { const [v, l] = Array.isArray(c) ? c : [c, c]; const cb = h('input'); cb.type = 'checkbox'; cb.checked = (cur || []).includes(v);
          cb.onchange = () => { const now = new Set(sel.options[o.key] || cur || []); cb.checked ? now.add(v) : now.delete(v); set([...now]); }; return h('label', null, cb, ' ', pt(l)); }));
      }
      else if (o.type === 'color') { input = h('input'); input.type = 'color'; input.value = /^#[0-9a-f]{6}$/i.test(cur || '') ? cur : '#ff2a4f'; input.onchange = () => set(input.value); }
      else if (o.type === 'textarea' || o.type === 'lines') { input = h('textarea'); input.rows = 3; input.value = cur ?? ''; input.onchange = () => set(input.value); }
      else { input = h('input'); input.type = 'text'; input.value = cur ?? ''; input.onchange = () => set(input.value); }
      input.id = id;
      const lab = h('label', 'ed-lab', pt(o.label) || o.key); lab.htmlFor = id;
      side.append(h('div', 'ed-f' + (o.type === 'bool' ? ' row' : ''), lab, input));
    }
    if (!keys.length) side.append(h('p', 'ed-hint', 'Este widget não tem opções.'));
  }

  // add a widget: the first free place for its usual size (or its smallest)
  bAdd.onclick = () => {
    haptic();
    const list = catalog.widgets.filter((d) => !pcOnly(d.type));
    const pick = h('div', 'ed-pick', h('div', 'ed-ph', h('b', null, 'Adicionar widget'), h('button', 'ed-btn', 'Fechar')),
      h('div', 'ed-pl', ...list.map((d) => { const b = h('button', 'ed-pi', h('span', 'ed-ic', WIDGET_ICONS[d.type] || d.icon || ''), h('b', null, name(d)), h('small', null, pt(d.desc) || ''));
        b.onclick = () => { add(d); pick.remove(); }; return b; })));
    pick.querySelector('.ed-ph button').onclick = () => pick.remove();
    ov.append(pick);
  };
  function add(d) {
    for (const [w, hh] of [[Math.min(d.w || 3, COLS), Math.min(d.h || 2, ROWS)], [d.minW || 1, d.minH || 1]])
      for (let y = 0; y <= ROWS - hh; y++) for (let x = 0; x <= COLS - w; x++)
        if (fits(null, x, y, w, hh)) {
          const it = { id: newWidgetId(), type: d.type, x, y, w, h: hh, options: {}, changed: {} };
          for (const o of d.options || []) if (editable(d.type).includes(o.key) && o.default !== undefined) it.changed[o.key] = it.options[o.key] = defaultValue(o);
          items.push(it); sel = it; render(); showSide(); haptic(); return;
        }
    toast('Não tem espaço livre nesta página. Remova ou diminua um widget.', 'err');
  }

  const close = () => { ov.remove(); setEditorOpen(false); };
  bCancel.onclick = () => { haptic(); close(); };
  bSave.onclick = async () => {
    haptic(); bSave.disabled = true;
    const widgets = items.map(({ changed, ...it }) => it);
    const body = { widgets: items.map((it) => ({ id: it.id, type: it.type, x: it.x, y: it.y, w: it.w, h: it.h,
      options: Object.fromEntries(Object.entries(it.options).filter(([key]) => editable(it.type).includes(key))) })) };
    try {
      queuePageEdit(pcId, page, widgets, body, sourceDraft);
      applyEditorEdits(); close();
      toast('Página salva no tablet. Sincronização automática quando o PC estiver acessível.');
      loadConfig();
    } catch (e) { toast(e.message, 'err'); bSave.disabled = false; }
  };
  grid.addEventListener('pointerdown', (e) => { if (e.target === grid) { sel = null; render(); showSide(); } });
  render(); showSide();
}
