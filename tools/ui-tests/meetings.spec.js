const { test, expect: expect0 } = require('@playwright/test');
const expect = expect0.configure({ timeout: 15000 });

// Federano "Reuniões": today's meetings, the alert before one starts, and Meet's buttons during a call (demo agent).
test.use({ viewport: { width: 1280, height: 800 } });

test('lists today, alerts before the next meeting, joins it and drives the call', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/panel/');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('federano.ftheme', '01');
    localStorage.setItem('pb-demo-config', JSON.stringify({ night: { enabled: false }, shortcuts: [],
      pages: [{ id: 'home', title: 'Início', enabled: true, widgets: [{ id: 'c', type: 'clock', x: 0, y: 0, w: 12, h: 6, options: {} }] },
        { id: 'reunioes', title: 'Reuniões', enabled: true, widgets: [{ id: 'm', type: 'meetings', x: 0, y: 0, w: 12, h: 6, options: { alertMin: 5 } }] }] }));
  });
  await page.reload();
  // the alert comes by itself (the next meeting starts in 4 minutes) and takes the panel to the meetings page
  await expect(page.locator('.mt-alert')).toBeVisible();
  await expect(page.locator('.mt-atitle')).toHaveText('Revisão do projeto Federano');
  await page.screenshot({ path: test.info().outputPath('alert.png') });
  await expect(page.locator('.mt-ev')).toHaveCount(3);
  await expect(page.locator('.mt-ev.past')).toHaveCount(1);
  await page.locator('.mt-abtn.go').click();
  await expect(page.locator('.mt-alert')).toHaveCount(0);
  // the call is open: its buttons work
  await expect(page.locator('.w.mt.mt-incall')).toHaveCount(1);
  await expect(page.locator('.mt-cb', { hasText: 'Câmera' })).toHaveClass(/off/);
  await page.locator('.mt-cb', { hasText: 'Microfone' }).click();
  await expect(page.locator('.mt-cb', { hasText: 'Microfone' })).toHaveClass(/off/);
  await page.screenshot({ path: test.info().outputPath('page.png') });
  expect(errors).toEqual([]);
});
