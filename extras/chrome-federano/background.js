// Federano extension, background worker: passes the pages' reports and video frames to the Federano agent on this PC
// (127.0.0.1 only) and its answers back. Nothing is sent anywhere else.
//
// Mirroring a tab's video has two ways:
//  1. Tab capture (best): Chrome captures the tab itself, which keeps it rendering at full speed even in the background
//     or behind other windows. Chrome allows it after you click the Federano icon (or Alt+Shift+F) on that tab.
//  2. Page capture (fallback): the page draws its own video. Fine while the tab is in front; Chrome slows a hidden tab
//     down to about one frame a second.
const AGENT = 'http://127.0.0.1:8775/api';

const rects = new Map();      // tab id -> video rectangle as fractions of the page

// The tab under tab capture. Chrome stops this worker when idle and starts it again on the next event, which empties
// its variables, so the captured tab is kept in session storage (while the offscreen page that captures it exists).
async function getCaptured() {
  try {
    if (!(await chrome.offscreen.hasDocument())) return null;
    const { captured } = await chrome.storage.session.get('captured');
    return Number.isInteger(captured) ? captured : null;
  } catch (_) { return null; }
}
const setCaptured = (tab) => chrome.storage.session.set({ captured: tab }).catch(() => {});

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg) return false;
  if (msg.type === 'federano-offscreen-stopped') {
    setCaptured(null);
    chrome.offscreen.closeDocument().catch(() => {});
    return false;
  }
  if (msg.type === 'federano-mirror-start' && sender.tab) {
    // the tablet accepted this tab: try tab capture (works if the icon was clicked on this tab), else page capture
    startTabCapture(sender.tab.id).then((ok) => reply({ tabCapture: ok }));
    return true;
  }
  if (msg.type !== 'federano-video') return false;
  const tab = sender.tab && Number.isInteger(sender.tab.id) ? sender.tab.id : null;
  if (tab !== null && msg.rect) {
    rects.set(tab, msg.rect);
    // the offscreen page keeps only the rectangle of the tab it captures
    chrome.runtime.sendMessage({ target: 'federano-offscreen', type: 'rect', tab, rect: msg.rect }).catch(() => {});
  }
  const q = new URLSearchParams({ playing: String(!!msg.playing) });
  if (tab !== null) q.set('tab', String(tab));
  if (msg.v) { q.set('v', msg.v); q.set('t', String(msg.t)); q.set('title', String(msg.title || '').slice(0, 200)); }
  Promise.all([fetch(`${AGENT}/browser/youtube?${q}`, { method: 'POST', cache: 'no-store' }).then((r) => (r.ok ? r.json() : {})), getCaptured()])
    .then(([j, captured]) => reply({ pause: j.pause === true, mirror: j.mirror === true, tabCapture: captured === tab }))
    .catch(() => reply({ pause: false, mirror: false, tabCapture: false }));   // Federano not running: try again later
  return true; // answer asynchronously
});

// Clicking the Federano icon (or Alt+Shift+F) on a tab: mirror that tab's video now, with tab capture.
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !Number.isInteger(tab.id)) return;
  try {
    const r = await fetch(`${AGENT}/mirror/start?tab=${tab.id}`, { method: 'POST', cache: 'no-store' });
    const j = r.ok ? await r.json() : {};
    if (j.ok === false) { badge('!', '#ef4444'); return; }
  } catch (_) { badge('!', '#ef4444'); return; }
  if (await startTabCapture(tab.id)) badge('ON', '#14b8a6');
});

async function startTabCapture(tabId) {
  if ((await getCaptured()) === tabId) return true;
  let streamId;
  try { streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }); }
  catch (_) { return false; }   // not allowed yet: the Federano icon was not clicked on this tab
  try {
    if (!(await chrome.offscreen.hasDocument())) {
      await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['USER_MEDIA'], justification: 'Espelhar no tablet o vídeo desta aba' });
    }
  } catch (_) { return false; }
  await setCaptured(tabId);
  chrome.runtime.sendMessage({ target: 'federano-offscreen', type: 'start', streamId, tab: tabId, rect: rects.get(tabId) || null }).catch(() => {});
  return true;
}

function badge(text, color) {
  chrome.action.setBadgeText({ text }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ color }).catch(() => {});
  setTimeout(() => chrome.action.setBadgeText({ text: '' }).catch(() => {}), 4000);
}

// frames drawn by the page itself (fallback): one in flight at a time; the page sends the next one when told "ready"
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'federano-frames' || !port.sender || !port.sender.tab) return;
  const tab = port.sender.tab.id;
  port.onMessage.addListener(async (m) => {
    if (!m || typeof m.frame !== 'string') return;
    if ((await getCaptured()) === tab) { try { port.postMessage({ tabCapture: true }); } catch (_) {} return; }   // tab capture took over
    let mirror = true;
    try {
      const bin = atob(m.frame);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const r = await fetch(`${AGENT}/mirror/push?tab=${tab}&ts=${Number(m.ts) || 0}`, { method: 'POST', body: bytes, headers: { 'Content-Type': 'image/jpeg' }, cache: 'no-store' });
      mirror = r.ok ? (await r.json()).mirror === true : false;
    } catch (_) { mirror = false; }
    try { port.postMessage(mirror ? { ready: true } : { mirror: false }); } catch (_) {}
  });
});
