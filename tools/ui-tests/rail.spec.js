const { test, expect: expect0 } = require('@playwright/test');
const expect = expect0.configure({ timeout: 10000 });

// Federano, Tema 01 (Modelo A): the side rail jumps between Início, Reuniões and Música, and opens Temas and Ajustes.
test.use({ viewport: { width: 1280, height: 800 } });

test('the rail shows only in Tema 01 and goes to each page', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/panel/');
  await page.evaluate(() => {
    localStorage.clear(); localStorage.setItem('federano.ftheme', '01');
    localStorage.setItem('pb-demo-config', JSON.stringify({ night: { enabled: false }, shortcuts: [], display: { idleReturnSec: 0 }, pages: [
      { id: 'home', title: 'Início', enabled: true, widgets: [{ id: 'c', type: 'clock', x: 0, y: 0, w: 6, h: 4, options: {} }] },
      { id: 'meet', title: 'Reuniões', enabled: true, widgets: [{ id: 'mt', type: 'meetings', x: 0, y: 0, w: 12, h: 6, options: {} }] },
      { id: 'letra', title: 'Letra', enabled: true, widgets: [{ id: 'ly', type: 'lyrics', x: 0, y: 0, w: 12, h: 6, options: {} }] }] }));
  });
  await page.reload();
  const rail = page.locator('.f-rail');
  await expect(rail).toBeVisible();
  const cur = () => page.evaluate(async () => (await import('/panel/main.js')).curPage);
  await rail.getByRole('button', { name: 'Música' }).click();
  await expect.poll(cur).toBe(2);
  await expect(rail.getByRole('button', { name: 'Música' })).toHaveClass(/on/);
  await rail.getByRole('button', { name: 'Reuniões' }).click();
  await expect.poll(cur).toBe(1);
  await rail.getByRole('button', { name: 'Início' }).click();
  await expect.poll(cur).toBe(0);
  await rail.getByRole('button', { name: 'Temas' }).click();
  await expect(page.locator('#themes')).toBeVisible();
  if (process.env.SHOTS) { await page.locator('#themes .th-close').click(); await page.waitForTimeout(800); await page.screenshot({ path: process.env.SHOTS + '/rail.png' }); }
  else await page.locator('#themes .th-close').click();
  // quick shortcuts: pin a page to the rail, jump with it, remembered after a reload, then unpin it
  await rail.getByRole('button', { name: 'Atalho' }).click();
  await page.locator('#railPins .f-pin', { hasText: 'Letra' }).click();
  await expect(page.locator('#railPins .f-pin', { hasText: 'Letra' })).toContainText('Na barra');
  await page.locator('#railPins .th-close').click();
  await rail.getByRole('button', { name: 'Início' }).click();
  await rail.locator('.f-rail-pins button', { hasText: 'Letra' }).click();
  await expect.poll(cur).toBe(2);
  await expect(rail.locator('.f-rail-pins button', { hasText: 'Letra' })).toHaveClass(/on/);
  if (process.env.SHOTS) { await page.waitForTimeout(600); await page.screenshot({ path: process.env.SHOTS + '/rail-atalho.png' }); }
  await page.reload();
  await expect(rail.locator('.f-rail-pins button', { hasText: 'Letra' })).toHaveCount(1);
  await rail.getByRole('button', { name: 'Atalho' }).click();
  await page.locator('#railPins .f-pin', { hasText: 'Letra' }).click();
  await page.locator('#railPins .th-close').click();
  await expect(rail.locator('.f-rail-pins button')).toHaveCount(0);
  await rail.getByRole('button', { name: 'Ajustes' }).click();
  await expect(page.locator('#overview')).toBeVisible();
  if (process.env.SHOTS) { await page.evaluate(async () => (await import('/panel/main.js')).closeOverview()); await rail.getByRole('button', { name: 'Reuniões' }).click(); await page.waitForTimeout(1200); await page.screenshot({ path: process.env.SHOTS + '/rail-reunioes.png' }); }
  await page.evaluate(async () => (await import('/panel/main.js')).closeOverview());
  // the small tab hides the rail (the pages take the whole width), stays hidden after a reload, and brings it back
  const tog = page.locator('.f-rail-tog');
  await tog.click();
  await expect(rail).not.toBeInViewport();
  if (process.env.SHOTS) { await page.waitForTimeout(500); await page.screenshot({ path: process.env.SHOTS + '/rail-escondida.png' }); }
  await page.reload();
  await expect(page.locator('.f-rail-tog')).toHaveAttribute('aria-label', 'Mostrar a barra lateral');
  await expect(rail).not.toBeInViewport();
  await page.locator('.f-rail-tog').click();
  await expect(rail).toBeInViewport();
  await page.evaluate(async () => (await import('/panel/themes.js')).setTheme('00'));
  await expect(page.locator('.f-rail-tog')).toBeHidden();
  await expect(rail).toBeHidden();
  expect(errors).toEqual([]);
});
