// Federano: sends the YouTube tab's report to the Federano agent on this PC (127.0.0.1 only) and passes its answer
// back to the tab. Nothing else is sent anywhere.
const AGENT = 'http://127.0.0.1:8775/api/browser/youtube';

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (!msg || msg.type !== 'federano-youtube') return false;
  const q = new URLSearchParams({ v: msg.v, t: String(msg.t), playing: String(!!msg.playing), title: String(msg.title || '').slice(0, 200) });
  fetch(`${AGENT}?${q}`, { method: 'POST', cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : {}))
    .then((j) => reply({ pause: j.pause === true }))
    .catch(() => reply({ pause: false }));   // Federano not running: try again on the next report
  return true; // answer asynchronously
});
