// Federano extension, background worker: passes the pages' reports and video frames to the Federano agent on this PC
// (127.0.0.1 only) and its answers back. Nothing is sent anywhere else.
const AGENT = 'http://127.0.0.1:8775/api';

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || msg.type !== 'federano-video') return false;
  const q = new URLSearchParams({ playing: String(!!msg.playing) });
  if (sender.tab && Number.isInteger(sender.tab.id)) q.set('tab', String(sender.tab.id));
  if (msg.v) { q.set('v', msg.v); q.set('t', String(msg.t)); q.set('title', String(msg.title || '').slice(0, 200)); }
  fetch(`${AGENT}/browser/youtube?${q}`, { method: 'POST', cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : {}))
    .then((j) => reply({ pause: j.pause === true, mirror: j.mirror === true }))
    .catch(() => reply({ pause: false, mirror: false }));   // Federano not running: try again on the next report
  return true; // answer asynchronously
});

// frames of the mirrored tab's video: one in flight at a time; the page sends the next one when told "ready"
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'federano-frames' || !port.sender || !port.sender.tab) return;
  const tab = port.sender.tab.id;
  port.onMessage.addListener(async (m) => {
    if (!m || typeof m.frame !== 'string') return;
    let mirror = true;
    try {
      const bin = atob(m.frame);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const r = await fetch(`${AGENT}/mirror/push?tab=${tab}`, { method: 'POST', body: bytes, headers: { 'Content-Type': 'image/jpeg' }, cache: 'no-store' });
      mirror = r.ok ? (await r.json()).mirror === true : false;
    } catch (_) { mirror = false; }
    try { port.postMessage(mirror ? { ready: true } : { mirror: false }); } catch (_) {}
  });
});
