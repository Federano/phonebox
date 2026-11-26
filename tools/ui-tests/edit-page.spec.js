const { test, expect: expect0 } = require('@playwright/test');
const expect = expect0.configure({ timeout: 10000 });

// Federano: editing a page on the tablet (overview › Editar página): move, resize, options, add, remove, save.
test.use({ viewport: { width: 1280, height: 800 } });

async function open(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/panel/');
  await page.waitForFunction(() => window.__pbUp);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('pb-demo-config', JSON.stringify({ night: { enabled: false }, shortcuts: [],
      pages: [{ id: 'home', title: 'Início', enabled: true, widgets: [
        { id: 'c', type: 'clock', x: 0, y: 0, w: 6, h: 4, options: { date: true } },
        { id: 'n', type: 'note', x: 6, y: 0, w: 3, h: 2, options: { text: 'oi' } },
        { id: 'k', type: 'command', x: 9, y: 0, w: 3, h: 2, options: { title: 'Hora' } }] },
      { id: 'p2', title: 'Outra', enabled: true, widgets: [] }] }));
  });
  await page.reload();
  await expect(page.locator('.w').first()).toBeVisible();
  const dots = await page.locator('#dots').boundingBox();
  await page.mouse.click(dots.x + dots.width / 2, dots.y + dots.height / 2);
  await page.locator('#ovEdit').click();
  await expect(page.locator('.ed-w')).toHaveCount(3);
  return errors;
}
const saved = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('pb-demo-config')).pages[0].widgets);

test('move, change an option, add, remove and save; a PC-only widget keeps its options', async ({ page }) => {
  const errors = await open(page);
  // move the note two cells down
  const note = page.locator('.ed-w', { hasText: /Nota|Note/ });
  const g = await page.locator('.ed-grid').boundingBox(), cw = g.width / 12, ch = g.height / 6;
  const b = await note.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 5, b.y + b.height / 2 + ch * 1.1, { steps: 4 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 + ch * 2, { steps: 4 }); await page.mouse.up();
  // a move onto another widget is refused
  const c = await page.locator('.ed-w', { hasText: /Relógio|Clock/ }).boundingBox();
  await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2); await page.mouse.down();
  await page.mouse.move(c.x + c.width / 2 + cw * 4, c.y + c.height / 2, { steps: 6 }); await page.mouse.up();
  await expect(page.locator('#toast')).toContainText('Não cabe');
  // the clock's options: turn the date off
  await page.locator('.ed-w', { hasText: /Relógio|Clock/ }).click();
  await page.locator('.ed-side input[id$="-date"]').uncheck();
  // the command widget is PC-only: no options here
  await page.locator('.ed-w', { hasText: 'Hora' }).click();
  await expect(page.locator('.ed-side')).toContainText('só pelo PC');
  // remove it, then add an analog clock
  await page.locator('.ed-w.on .ed-del').click();
  await page.locator('.ed-btn', { hasText: '+ Adicionar' }).click();
  await expect(page.locator('.ed-pi', { hasText: 'Command' })).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('add.png') });
  await page.locator('.ed-pi', { hasText: 'Relógio analógico' }).click();
  await expect(page.locator('.ed-w')).toHaveCount(3);
  await page.screenshot({ path: test.info().outputPath('editor.png') });
  await page.locator('.ed-save').click();
  await expect(page.locator('#toast')).toContainText('Página salva');
  await expect.poll(async () => (await saved(page)).map((w) => w.type).sort()).toEqual(['analog', 'clock', 'note']);
  const ws = await saved(page);
  expect(ws.map((w) => w.type).sort()).toEqual(['analog', 'clock', 'note']);
  expect(ws.find((w) => w.type === 'note')).toMatchObject({ x: 6, y: 2 });
  expect(ws.find((w) => w.type === 'clock').options.date).toBe(false);
  expect(errors).toEqual([]);
});

test('cancel leaves the page as it was', async ({ page }) => {
  await open(page);
  await page.locator('.ed-w', { hasText: 'Hora' }).click();
  await page.locator('.ed-w.on .ed-del').click();
  await page.locator('.ed-btn', { hasText: 'Cancelar' }).click();
  await expect(page.locator('.ed')).toHaveCount(0);
  expect((await saved(page)).length).toBe(3);
});
