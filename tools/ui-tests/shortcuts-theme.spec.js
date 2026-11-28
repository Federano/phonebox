const { test, expect } = require('@playwright/test');
test.use({ viewport: { width: 1280, height: 800 } });

const shortcuts = [
  { id: 'terminal', label: 'Terminal', icon: '⌨️', color: '#4b5563' },
  { id: 'explorer', label: 'Files', icon: '📁', color: '#e5b84b' },
  { id: 'vscode', label: 'VS Code', icon: '📝', color: '#2f80ed' },
  { id: 'spotify', label: 'Spotify', icon: '🎧', color: '#1db954', iconRev: 1 },
  { id: 'mute', label: 'Mute', icon: '🔇', color: '#f59e0b', toggle: true },
];

async function open(page, items = shortcuts, extra = []) {
  await page.addInitScript(({ items, extra }) => {
    localStorage.clear();
    localStorage.setItem('federano.ftheme', '01');
    const config = { shortcuts: items, night: { enabled: false }, pages: [{ id: 'deck', title: 'Shortcuts', widgets: [
      { id: 'shortcuts', type: 'shortcuts', x: 0, y: 0, w: 12, h: extra.length ? 4 : 6, options: { columns: 4 } }, ...extra,
    ] }] };
    localStorage.setItem('cfg', JSON.stringify(config));
    localStorage.setItem('pb-demo-config', JSON.stringify(config));
    window.__shortcutCalls = [];
    let inner = window.fetch;
    Object.defineProperty(window, 'fetch', { configurable: true,
      get: () => { const original = inner; return (url, init) => {
        if (String(url).includes('/api/run/')) { window.__shortcutCalls.push({ url: String(url), method: init?.method }); return Promise.resolve(new Response('{}', { headers: { 'Content-Type': 'application/json' } })); }
        return original(url, init);
      }; }, set: (next) => { inner = next; },
    });
  }, { items, extra });
  await page.goto('/panel/');
  await page.waitForFunction(() => window.__pbUp);
  await expect(page.locator('.w-shortcuts .key')).toHaveCount(items.length);
}

test('approved themes keep uniform surfaces, recognizable icons and the original actions', async ({ page }) => {
  await open(page);
  const keys = page.locator('.w-shortcuts .key');
  await expect(page.locator('.w-shortcuts .k-app-icon')).toHaveCount(4);
  const appearance = await keys.evaluateAll((buttons) => buttons.map((button) => ({
    background: getComputedStyle(button).backgroundColor, gradient: getComputedStyle(button).backgroundImage,
  })));
  expect(new Set(appearance.map((item) => item.background)).size).toBe(1);
  expect(appearance.every((item) => item.gradient === 'none')).toBe(true);
  await expect(page.locator('[data-id="spotify"] .k-icon img')).toHaveCount(0);
  await page.locator('[data-id="spotify"]').click();
  expect(await page.evaluate(() => window.__shortcutCalls)).toEqual([{ url: '/agent/api/run/spotify', method: 'POST' }]);
  await page.evaluate(async () => (await import('/panel/themes.js')).setTheme('00'));
  const colors = await page.locator('.w-shortcuts .k-icon').evaluateAll((icons) => icons.map((icon) => getComputedStyle(icon).color));
  expect(new Set(colors).size).toBeGreaterThan(2);
  await expect(keys.locator('.k-label')).toHaveText(shortcuts.map((item) => item.label));
});

test('uploads, custom glyphs and standalone big buttons preserve their presentation', async ({ page }) => {
  await page.route('**/agent/api/shortcuts/icon?**', (route) => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="red"/></svg>' }));
  await open(page, [
    { id: 'spotify', label: 'Spotify', icon: '🎧', color: '#1db954', iconRev: 2, iconUpload: true },
    { id: 'vscode', label: 'VS Code', icon: 'MINHA ARTE', color: '#2f80ed' },
  ], [{ id: 'big', type: 'button', x: 0, y: 4, w: 4, h: 2, options: { id: 'vscode' } }]);
  // The demo supplies its own pictures; keep the assertion about upload priority independent of its artwork.
  await expect(page.locator('.w-shortcuts [data-id="spotify"] .k-icon img')).toHaveCount(1);
  await expect(page.locator('.w-shortcuts [data-id="spotify"] .k-app-icon')).toHaveCount(0);
  await expect(page.locator('.w-shortcuts [data-id="vscode"] .k-icon')).toHaveText('MINHA ARTE');
  await expect(page.locator('.w-button .k-icon')).toHaveText('MINHA ARTE');
});

test('all 25 presets are available without guessing commands or overriding custom icons', async ({ page }) => {
  await open(page);
  const result = await page.evaluate(async () => {
    const { SHORTCUT_APPS, shortcutAppIcon, shortcutIconSvg } = await import('/panel/shortcut-icons.js');
    return { count: SHORTCUT_APPS.length, unique: new Set(SHORTCUT_APPS.map((app) => app.id)).size,
      presets: SHORTCUT_APPS.every((app) => shortcutIconSvg(shortcutAppIcon({ label: app.label, icon: `app:${app.id}` })).includes('<svg')),
      unknown: shortcutAppIcon({ label: 'Meu aplicativo', icon: 'app:missing' }),
      custom: shortcutAppIcon({ label: 'Spotify', icon: 'ARTE MINHA' }),
      uploaded: shortcutAppIcon({ label: 'Spotify', icon: '🎧', iconUpload: true }),
      noCommandInference: shortcutAppIcon({ label: 'Meu aplicativo', icon: '', cmd: 'spotify.exe' }) };
  });
  expect(result).toEqual({ count: 25, unique: 25, presets: true, unknown: null, custom: null, uploaded: null, noCommandInference: null });
});
