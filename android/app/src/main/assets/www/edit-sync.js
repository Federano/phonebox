// Durable tablet edits. Only public page data is cached here; the agent still validates every write.
const KEY = 'federano.editor.offline.v1';
const clone = (value) => JSON.parse(JSON.stringify(value));
let editing = false, running = null;
const catalogs = new Map();

function read() {
  const raw = localStorage.getItem(KEY);
  if (!raw) return { catalogs: [], drafts: [] };
  try {
    const data = JSON.parse(raw);
    if (!Array.isArray(data.catalogs) || !Array.isArray(data.drafts)) throw new Error();
    return data;
  } catch (_) { throw new Error('Não foi possível ler as edições salvas no tablet. Elas foram preservadas.'); }
}
function write(data) {
  try { localStorage.setItem(KEY, JSON.stringify(data)); }
  catch (_) { throw new Error('Não foi possível salvar no tablet. Verifique o espaço disponível e tente novamente.'); }
}
export const newEditId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (n) => n.toString(16).padStart(2, '0')).join('');
export const newWidgetId = () => 't' + newEditId();
export const setEditorOpen = (open) => { editing = open; };
export function editorDraft(pcId, pageId) { return read().drafts.find((d) => d.pcId === pcId && d.page.id === pageId) || null; }
export function editorCatalog(pcId) { return read().catalogs.find((c) => c.pcId === pcId) || null; }

export async function editorJson(url, options = {}) {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('offline')); }, 5000); });
  try {
    return await Promise.race([fetch(url, { ...options, signal: controller.signal, cache: 'no-store' }).then(async (r) => ({ status: r.status, ok: r.ok, data: await r.json() })), deadline]);
  } finally { clearTimeout(timer); }
}

// Prime this on the first successful connection, before the user ever needs the editor offline.
export async function primeEditor(pcId, api, headers) {
  if (!pcId) return null;
  const cached = editorCatalog(pcId);
  if (cached && Date.now() - cached.at < 5 * 60_000) return cached;
  if (catalogs.has(pcId)) return catalogs.get(pcId);
  const work = (async () => {
    try {
      const [c, r] = await Promise.all([editorJson(`${api}/catalog`, { headers }), editorJson(`${api}/panel/editable`, { headers })]);
      if (!c.ok || !r.ok || r.data.pcId !== pcId || !Array.isArray(c.data.widgets) || !Array.isArray(r.data.pcOnly) || !r.data.editable) throw new Error('offline');
      const entry = { pcId, at: Date.now(), catalog: c.data, rules: r.data };
      const data = read();
      data.catalogs = data.catalogs.filter((x) => x.pcId !== pcId); data.catalogs.push(entry);
      write(data);
      return entry;
    } catch (e) { if (cached) return cached; throw e; }
    finally { catalogs.delete(pcId); }
  })();
  catalogs.set(pcId, work);
  return work;
}

export function queuePageEdit(pcId, page, widgets, body, source = null) {
  if (!pcId || !page.editRevision) throw new Error('Conecte este tablet ao PC uma vez para preparar a edição offline.');
  const data = read(), old = data.drafts.find((d) => d.pcId === pcId && d.page.id === page.id) || source;
  const draft = {
    pcId, page: { ...clone(page), widgets: clone(widgets) }, body: clone(body),
    baseRevision: old?.conflict?.revision || old?.baseRevision || page.editRevision,
    editId: newEditId(), previousIds: [...new Set([...(old?.previousIds || []), ...(old ? [old.editId] : [])])],
    savedAt: Date.now(), conflict: null,
  };
  data.drafts = data.drafts.filter((d) => d.pcId !== pcId || d.page.id !== page.id); data.drafts.push(draft);
  write(data); // Persist before changing the screen or trying the network.
  return draft;
}

export function overlayPageEdits(config) {
  try {
    const drafts = read().drafts.filter((d) => d.pcId === config.editorPcId);
    const pages = (config.pages || []).map((p) => {
      const d = drafts.find((x) => x.page.id === p.id);
      return d ? { ...p, widgets: clone(d.page.widgets) } : p;
    });
    // Keep a deleted page's local copy available until its owner explicitly discards it.
    for (const d of drafts) if (!pages.some((p) => p.id === d.page.id)) pages.push(clone(d.page));
    return { ...config, pages };
  } catch (_) { return config; }
}

export function discardPageEdit(pcId, pageId) {
  const data = read(), draft = data.drafts.find((d) => d.pcId === pcId && d.page.id === pageId);
  data.drafts = data.drafts.filter((d) => d.pcId !== pcId || d.page.id !== pageId); write(data);
  return draft;
}

function updateDraft(sent, update) {
  const data = read(), index = data.drafts.findIndex((d) => d.pcId === sent.pcId && d.page.id === sent.page.id);
  if (index < 0) return;
  const next = update(data.drafts[index]);
  if (next) data.drafts[index] = next; else data.drafts.splice(index, 1);
  write(data);
}

export async function syncPageEdits(config, send) {
  if (editing || !config.editorPcId) return { changed: false, notices: [] };
  if (running) { await running; return { changed: true, notices: [] }; }
  running = (async () => {
    let changed = false, saved = 0;
    const notices = [];
    for (const draft of read().drafts.filter((d) => d.pcId === config.editorPcId)) {
      if (editing) break;
      const remote = (config.pages || []).find((p) => p.id === draft.page.id);
      if (remote?.tabletEditId === draft.editId) {
        updateDraft(draft, (now) => now.editId === draft.editId ? null : { ...now, baseRevision: remote.tabletEditRevision });
        saved++;
        continue; // The prior reply was lost, but the PC has already saved this exact edit.
      }
      let base = draft.baseRevision;
      if (draft.previousIds.includes(remote?.tabletEditId) && remote.editRevision === remote.tabletEditRevision) base = remote.editRevision;
      if (!remote || remote.editRevision !== base) {
        const conflict = { kind: remote ? 'changed' : 'deleted', revision: remote?.editRevision || null, remote: remote || null };
        if (draft.conflict?.revision !== conflict.revision || draft.conflict?.kind !== conflict.kind) notices.push(`A página “${draft.page.title}” mudou no PC. Sua edição está guardada no tablet; abra o editor para escolher qual usar.`);
        updateDraft(draft, (now) => now.editId === draft.editId ? { ...now, conflict } : now);
        continue;
      }
      if (draft.conflict?.kind === 'invalid') continue;
      try {
        const r = await send(draft.page.id, { ...draft.body, pcId: draft.pcId, baseRevision: base, editId: draft.editId });
        if (r.ok && r.data.ok) {
          changed = true;
          updateDraft(draft, (now) => now.editId === draft.editId ? null : { ...now, baseRevision: r.data.revision });
          saved++;
        } else if (r.status === 409 || r.status === 400 || r.status === 403) {
          const conflict = { kind: r.status === 409 ? 'changed' : 'invalid', revision: r.data.revision || null, remote: remote || null, error: r.data.error };
          updateDraft(draft, (now) => now.editId === draft.editId ? { ...now, conflict } : now);
          notices.push(r.data.error || 'O PC não aceitou esta edição. Ela continua salva no tablet.');
          if (r.status === 409) changed = true; // Refresh the revision before offering an explicit conflict resolution.
        } else break; // Offline or a temporary server error: keep the durable draft for the next connection.
      } catch (_) { break; }
    }
    return { changed, notices, saved, pending: read().drafts.some((d) => d.pcId === config.editorPcId) };
  })();
  try { return await running; } finally { running = null; }
}
