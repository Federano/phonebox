// Federano extension, on Google Meet (meet.google.com) only: tells the Federano agent on this PC, once a second, whether
// this tab is in a call and whether the microphone, camera and raised hand are on; and presses Meet's own buttons
// when the tablet asks (microphone, camera, hand, captions, leave). Nothing else from the call is read or sent:
// no names, no video, no chat.
(() => {
  // Meet labels its buttons with their keyboard shortcut in every language: that finds them without depending on words
  const byShortcut = (keys) => [...document.querySelectorAll('[role="button"][aria-label], button[aria-label]')]
    .find((b) => b.getAttribute('aria-label').toLowerCase().replace(/\s+/g, '').includes(keys));
  const leaveButton = () => document.querySelector('[jsname="CQylAd"]')
    || [...document.querySelectorAll('button[aria-label]')].find((b) => /leave call|sair da chamada|sair da reunião/i.test(b.getAttribute('aria-label')));
  // on = not muted; Meet marks the microphone and camera buttons with data-is-muted
  const isOn = (b) => !b ? null : b.hasAttribute('data-is-muted') ? b.getAttribute('data-is-muted') !== 'true'
    : b.hasAttribute('aria-pressed') ? b.getAttribute('aria-pressed') === 'true' : null;
  const mic = () => byShortcut('(ctrl+d)'), cam = () => byShortcut('(ctrl+e)'), hand = () => byShortcut('(ctrl+alt+h)'), captions = () => byShortcut('(c)');
  const code = () => (location.pathname.match(/^\/([a-z]{3}-[a-z]{4}-[a-z]{3})/) || [])[1] || '';

  function press(cmd) {
    const b = cmd === 'mic' ? mic() : cmd === 'cam' ? cam() : cmd === 'hand' ? hand() : cmd === 'captions' ? captions() : cmd === 'leave' ? leaveButton() : null;
    if (b) b.click();
  }

  function report() {
    const inCall = !!leaveButton();
    const msg = { type: 'federano-meet', call: inCall, code: code() };
    if (inCall) { msg.mic = isOn(mic()); msg.cam = isOn(cam()); const hb = hand(); msg.hand = hb ? hb.getAttribute('aria-pressed') === 'true' : null; }
    try {
      chrome.runtime.sendMessage(msg, (answer) => {
        if (chrome.runtime.lastError || !answer) return;
        if (answer.cmd) press(answer.cmd);
      });
    } catch (_) { clearInterval(timer); /* extension reloaded */ }
  }
  const timer = setInterval(report, 1000);
})();
