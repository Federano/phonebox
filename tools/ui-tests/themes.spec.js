const { test, expect: expect0 } = require('@playwright/test');
// the lyrics page asks the agent every 4 s; a fake answer can miss the first ask, so allow a second one
const expect = expect0.configure({ timeout: 10000 });

// Federano themes: overview › Temas picks the look on this tablet. Tema 00 is the panel as it always was; Tema 01
// "Minimalista" is pure black with one red, and its own animations on the lyrics page.
test.use({ viewport: { width: 1280, height: 800 } });

const SONG = {
  playing: true, key: 'life goes on\u0001oliver tree', kind: 'track', artistImage: null,
  media: { app: 'Spotify', title: 'Life Goes On', artist: 'Oliver Tree', album: 'Ugly Is Beautiful', playing: true, posMs: 13000, durMs: 161000, artId: 0, canSeek: true, ageMs: 0 },
  lyrics: { found: true, instrumental: false, plain: '', lines: [{ t: 2000, text: 'On, and on, and on' }, { t: 8000, text: 'On, and on, and on, and on' }, { t: 12000, text: 'Babe, you best believe it' }, { t: 20000, text: "I'm a lover, not a fighter" }], trans: ['E assim vai', 'E assim vai, e vai', 'Amor, pode acreditar', 'Sou de amar, não de brigar'], lang: 'en' },
};

async function open(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/panel/');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('pb-demo-config', JSON.stringify({ night: { enabled: false }, shortcuts: [],
      pages: [{ id: 'letra', title: 'Letra', enabled: true, widgets: [{ id: 'ly', type: 'lyrics', x: 0, y: 0, w: 12, h: 6, options: {} }] },
        { id: 'home', title: 'Início', enabled: true, widgets: [{ id: 'c', type: 'clock', x: 0, y: 0, w: 12, h: 6, options: {} }] }] }));
  });
  await page.reload();
  await page.evaluate((answer) => {
    const real = window.fetch;
    window.fetch = (url, init) => String(url).includes('/lyrics/now')
      ? Promise.resolve(new Response(JSON.stringify(answer), { headers: { 'Content-Type': 'application/json' } })) : real(url, init);
  }, SONG);
  await expect(page.locator('.ly-title')).toHaveText('Life Goes On');
  return errors;
}
async function pick(page, name) {
  const dots = await page.locator('#dots').boundingBox();
  await page.mouse.click(dots.x + dots.width / 2, dots.y + dots.height / 2);
  await expect(page.locator('#overview')).toBeVisible();
  await page.locator('#ovThemes').click();
  await expect(page.locator('.th-card')).toHaveCount(2);
  await page.waitForTimeout(400);
  await page.screenshot({ path: test.info().outputPath('picker-' + name.replace(' ', '') + '.png') });
  await page.locator('.th-card', { hasText: name }).click();
  await expect(page.locator('#themes')).toHaveCount(0);
}

test('Tema 00 is the default; Tema 01 is picked in the overview, kept on the tablet and can be undone', async ({ page }) => {
  const errors = await open(page);
  await expect(page.locator('body')).toHaveAttribute('data-ftheme', '00');
  await page.screenshot({ path: test.info().outputPath('tema00.png') });

  await pick(page, 'Tema 01');
  await expect(page.locator('body')).toHaveAttribute('data-ftheme', '01');
  await expect(page.locator('.ly-line.on')).toContainText('Babe, you best believe it');
  // pure black, the photo only on the card, the line being sung white
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.querySelector('.ly-title').closest('.w.ly')).backgroundColor)).toBe('rgb(0, 0, 0)');
  await expect(page.locator('.ly-bgphoto')).toBeHidden();
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('.ly-line.on')).color)).toBe('rgb(255, 255, 255)');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: test.info().outputPath('tema01.png') });

  // kept after a restart of the panel
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-ftheme', '01');

  // and back to Tema 00
  await page.evaluate(() => { document.querySelector('#overview').hidden = true; });
  await pick(page, 'Tema 00');
  await expect(page.locator('body')).toHaveAttribute('data-ftheme', '00');
  expect(errors).toEqual([]);
});
