const { test, expect: expect0 } = require('@playwright/test');
const expect = expect0.configure({ timeout: 10000 });

// Federano "Início": the whole start page in one widget (time, PC, now playing, today's meetings, page buttons, system, weather).
test.use({ viewport: { width: 1280, height: 800 } });

test('the start page shows the time, the PC, the song, the meetings, the system and the weather', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/panel/');
  await page.evaluate(() => {
    localStorage.clear(); localStorage.setItem('federano.ftheme', '01');
    localStorage.setItem('pb-demo-config', JSON.stringify({ night: { enabled: false }, shortcuts: [], display: { idleReturnSec: 0 }, pages: [
      { id: 'inicio', title: 'Início', enabled: true, widgets: [{ id: 'fh', type: 'fhome', x: 0, y: 0, w: 12, h: 6, options: {} }] },
      { id: 'reunioes', title: 'Reuniões', enabled: true, widgets: [{ id: 'mt', type: 'meetings', x: 0, y: 0, w: 12, h: 6, options: {} }] },
      { id: 'letra', title: 'Letra', enabled: true, widgets: [{ id: 'n', type: 'note', x: 0, y: 0, w: 6, h: 4, options: {} }] },
      { id: 'system', title: 'System', enabled: true, widgets: [{ id: 'c', type: 'clock', x: 0, y: 0, w: 6, h: 4, options: {} }] }] }));
  });
  await page.reload();
  const home = page.locator('.w-fhome');
  await expect(home.locator('.fh-time')).toHaveText(/^\d\d:\d\d$/);
  await expect(home.locator('.fh-pill').first()).toContainText('PC online');
  await expect(home.locator('.fh-pill', { hasText: 'CPU' }).locator('b')).not.toBeEmpty();
  await expect(home.locator('.fh-song b')).not.toHaveText('');
  await expect(home.locator('.fh-st')).toHaveCount(4);
  await expect(home.locator('.fh-st .fh-num').first()).not.toBeEmpty();
  await expect(home.locator('.fh-wxnow')).toHaveText(/°|—/);
  await expect(home.locator('.fh-pg')).toHaveCount(0);   // the side rail goes to the pages
  await expect(home.locator('.fh-mlist')).not.toBeEmpty();
  // the system cards draw their recent history (the demo adds a point a second)
  await expect.poll(() => home.locator('.fh-st canvas').first().evaluate((c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 4) if (d[i]) return true; return false; }), { timeout: 8000 }).toBe(true);
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/inicio.png' });
  await home.locator('.fh-np').click();   // the song: the screen of what is playing
  await expect(page.locator('#toast')).toContainText('widget Letra');   // this test layout has no lyrics page
  expect(errors).toEqual([]);
});
