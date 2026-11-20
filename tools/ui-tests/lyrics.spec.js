const { test, expect } = require('@playwright/test');

// Federano "Letra": the artist's photo and the timed lyrics of the song playing on the PC. The agent's answer is faked.
test.use({ viewport: { width: 1280, height: 800 } });

async function open(page, answer) {
  await page.goto('/panel/');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('pb-demo-config', JSON.stringify({ night: { enabled: false }, shortcuts: [],
      pages: [{ id: 'letra', title: 'Letra', enabled: true, widgets: [{ id: 'ly', type: 'lyrics', x: 0, y: 0, w: 12, h: 6, options: {} }] }] }));
  });
  await page.reload();
  await page.evaluate((answer) => {
    window.__calls = [];
    const real = window.fetch;
    window.fetch = (url, init) => {
      if (String(url).includes('/lyrics/now')) {
        window.__calls.push(String(url).replace(/^.*\/api/, ''));
        const a = typeof answer === 'function' ? answer() : answer;
        return Promise.resolve(new Response(JSON.stringify(a), { headers: { 'Content-Type': 'application/json' } }));
      }
      return real(url, init);
    };
  }, answer);
  await expect(page.locator('.w.ly')).toBeVisible();
}

const SONG = {
  playing: true, key: 'life goes on\u0001oliver tree', artistImage: null,
  media: { app: 'Spotify', title: 'Life Goes On', artist: 'Oliver Tree', album: 'Ugly Is Beautiful', playing: true, posMs: 13000, durMs: 161000, artId: 0, canSeek: true, ageMs: 0 },
  lyrics: { found: true, instrumental: false, plain: '', lines: [{ t: 2000, text: 'On, and on, and on' }, { t: 8000, text: 'On, and on, and on, and on' }, { t: 12000, text: 'Babe, you best believe it' }, { t: 20000, text: "I'm a lover, not a fighter" }] },
};

test('lights up the line being sung and shows the song', async ({ page }) => {
  await open(page, SONG);
  await expect(page.locator('.ly-title')).toHaveText('Life Goes On');
  await expect(page.locator('.ly-artist')).toHaveText('Oliver Tree · Spotify');
  await expect(page.locator('.ly-line')).toHaveCount(4);
  await expect(page.locator('.ly-line.on')).toHaveText('Babe, you best believe it');
  await expect(page.locator('.ly-line.past')).toHaveCount(2);
  await page.screenshot({ path: test.info().outputPath('lyrics.png') });
});

test('asks for the lyrics only once per song', async ({ page }) => {
  await open(page, SONG);
  await page.waitForTimeout(4500);
  const calls = await page.evaluate(() => window.__calls);
  expect(calls.length).toBeGreaterThan(1);
  expect(calls[0]).toContain('have=');
  expect(calls[calls.length - 1]).toContain('have=life%20goes%20on');
});

test('no lyrics: says so, the photo stays', async ({ page }) => {
  await open(page, { ...SONG, lyrics: { found: false, instrumental: false, plain: '', lines: [] } });
  await expect(page.locator('.w.ly.ly-none')).toHaveCount(1);
  await expect(page.locator('.ly-note')).toHaveText('Letra não encontrada para esta música.');
});

test('nothing playing', async ({ page }) => {
  await open(page, { playing: false });
  await expect(page.locator('.ly-title')).toHaveText('Nada tocando no PC');
});
