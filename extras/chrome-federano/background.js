// Federano: sends the tab's report to the Federano agent on this PC (127.0.0.1 only) and passes its answer back to the
// tab. Nothing is sent anywhere else.
const AGENT = 'http://127.0.0.1:8775/api/browser/youtube';

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (!msg || msg.type !== 'federano-video') return false;
  const q = new URLSearchParams({ playing: String(!!msg.playing) });
  for (const k of ['x', 'y', 'w', 'h']) if (Number.isFinite(msg[k])) q.set(k, String(Math.round(msg[k])));
  if (msg.v) { q.set('v', msg.v); q.set('t', String(msg.t)); q.set('title', String(msg.title || '').slice(0, 200)); }
  fetch(`${AGENT}?${q}`, { method: 'POST', cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : {}))
    .then((j) => reply({ pause: j.pause === true }))
    .catch(() => reply({ pause: false }));   // Federano not running: try again on the next report
  return true; // answer asynchronously
});
