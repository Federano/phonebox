// Federano "Night City" theme: the moving parts (nightcity.css has the look). Started and stopped by main.js when the
// theme changes (Settings › Display › Theme). Rain and the skyline are canvases behind the pages; a glitch cut runs across
// the screen when the page changes and that page's panels power on one by one. Nothing runs while the theme is off.

let on = false, raf = 0, els = [], drops = [], lastDraw = 0;

function fonts() {
  if (document.getElementById('ncFonts')) return;
  const l = document.createElement('link');
  l.id = 'ncFonts'; l.rel = 'stylesheet';
  l.href = 'https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;600;700&family=Share+Tech+Mono&display=swap';
  document.head.append(l);   // offline: the CSS falls back to Roboto Condensed / Roboto Mono
}

function skyline(c) {
  const g = c.getContext('2d'), W = c.width, H = c.height;
  let s = 31; const r = () => (s = (s * 9301 + 49297) % 233280) / 233280;
  g.clearRect(0, 0, W, H);
  let x = 0;
  while (x < W) {
    const w = 6 + Math.floor(r() * 16), h = 12 + Math.floor(r() * (H - 16));
    g.fillStyle = '#0f141c'; g.fillRect(x, H - h, w, h);
    for (let yy = H - h + 3; yy < H - 2; yy += 4) for (let xx = x + 2; xx < x + w - 1; xx += 3)
      if (r() < .14) { g.fillStyle = r() < .6 ? '#fcee0a' : '#00f0ff'; g.fillRect(xx, yy, 1, 1); }
    if (r() > .8) { g.fillStyle = r() > .5 ? '#ff2a4d' : '#00f0ff'; g.fillRect(x + 1, H - h + 4, w - 2, 1); }
    x += w + 1;
  }
}

function rain(t) {
  raf = requestAnimationFrame(rain);
  if (t - lastDraw < 33) return;   // ~30 fps is plenty for rain
  lastDraw = t;
  const c = els[1]; if (!c || document.hidden || document.body.classList.contains('night') || document.body.classList.contains('dimmed')) return;
  const g = c.getContext('2d'), W = c.width, H = c.height;
  if (!drops.length) drops = Array.from({ length: 90 }, () => ({ x: Math.random() * W, y: Math.random() * H, v: 4 + Math.random() * 5, l: 7 + Math.random() * 12 }));
  g.clearRect(0, 0, W, H);
  g.lineWidth = 1;
  for (const p of drops) {
    g.strokeStyle = p.v > 7 ? 'rgba(0,240,255,.22)' : 'rgba(255,255,255,.1)';
    g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x - 1.5, p.y + p.l); g.stroke();
    p.y += p.v; p.x -= .4;
    if (p.y > H) { p.y = -p.l; p.x = Math.random() * (W + 20); }
  }
}

function make(tag, cls) { const e = document.createElement(tag); e.className = 'nc-fx ' + cls; return e; }

/** The panels of page i power on one by one; a glitch cut runs across the screen. */
export function ncPage(i) {
  if (!on) return;
  const cut = els[4];
  if (cut) { cut.classList.remove('on'); void cut.offsetWidth; cut.classList.add('on'); }
  const page = document.querySelectorAll('#pager .page')[i];
  if (!page) return;
  page.querySelectorAll('.w').forEach((w, k) => w.style.setProperty('--nc-i', String(k % 8)));
  page.classList.remove('nc-boot'); void page.offsetWidth; page.classList.add('nc-boot');
  clearTimeout(page._ncT); page._ncT = setTimeout(() => page.classList.remove('nc-boot'), 1800);
}

export function nightCity(enable) {
  if (enable === on) return;
  on = enable;
  if (!on) { cancelAnimationFrame(raf); els.forEach((e) => e.remove()); els = []; drops = []; return; }
  fonts();
  const sky = make('canvas', 'nc-sky'); sky.width = 500; sky.height = 75;
  const rn = make('canvas', 'nc-rain'); rn.width = Math.round(innerWidth / 2); rn.height = Math.round(innerHeight / 2);
  const scan = make('div', 'nc-scan'), sweep = make('div', 'nc-sweep'), cut = make('div', 'nc-cut');
  els = [sky, rn, scan, sweep, cut];
  document.body.prepend(sky, rn);
  document.body.append(scan, sweep, cut);
  skyline(sky);
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) raf = requestAnimationFrame(rain);
}
addEventListener('resize', () => { const c = els[1]; if (c) { c.width = Math.round(innerWidth / 2); c.height = Math.round(innerHeight / 2); drops = []; } });
