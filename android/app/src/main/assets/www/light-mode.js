// This tablet's rendering preference; independent from its theme and from the PC configuration.
const KEY = 'federano.lightMode';
let enabled = false;
try { enabled = localStorage.getItem(KEY) === '1'; } catch (_) {}

export const isLightMode = () => enabled;
export function applyLightMode() {
  document.body.dataset.flight = enabled ? '1' : '0';
  window.dispatchEvent(new CustomEvent('federano-light-mode', { detail: { enabled } }));
}
export function setLightMode(next) {
  enabled = !!next;
  try { localStorage.setItem(KEY, enabled ? '1' : '0'); } catch (_) {}
  applyLightMode();
}

applyLightMode();
