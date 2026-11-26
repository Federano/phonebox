const { test, expect: expect0 } = require('@playwright/test');
const expect = expect0.configure({ timeout: 12000 });

// Federano: the video pop-up's third answer, "Só ouvir": the lyrics page shows the PC's video as sound only.
test.use({ viewport: { width: 1280, height: 800 } });

test('"Só ouvir" opens the lyrics page with the video as sound only, and asks no more while it lasts', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/panel/');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('pb-demo-config', JSON.stringify({ night: { enabled: false }, shortcuts: [], pages: [
      { id: 'home', title: 'Início', enabled: true, widgets: [{ id: 'c', type: 'clock', x: 0, y: 0, w: 6, h: 4, options: {} }] },
      { id: 'letra', title: 'Letra', enabled: true, widgets: [{ id: 'ly', type: 'lyrics', x: 0, y: 0, w: 12, h: 6, options: {} }] }] }));
  });
  await page.reload();
  await page.evaluate(() => {
    window.__offers = 0; window.__asks = [];
    const real = window.fetch;
    window.fetch = (url, init) => {
      const u = String(url);
      const json = (d) => Promise.resolve(new Response(JSON.stringify(d), { headers: { 'Content-Type': 'application/json' } }));
      if (u.includes('/mirror/offer/answer')) { window.__asks.push(u.replace(/^.*\/api/, '')); return json({ ok: true, mirror: false }); }
      if (u.includes('/mirror/offer')) { window.__offers++; return json({ offer: { id: 'v1', title: 'Lo-fi para estudar', app: 'Chrome', seconds: 30, artId: 0 } }); }
      if (u.includes('/lyrics/now')) return json(u.includes('any=true')
        ? { playing: true, key: 'video|Chrome|Lo-fi para estudar', kind: 'video', media: { app: 'Chrome', title: 'Lo-fi para estudar', artist: 'Canal Calmo', album: '', playing: true, posMs: 1000, durMs: 3600000, artId: 0, canSeek: true, ageMs: 0 },
            lyrics: { lines: [], plain: '', instrumental: false, found: false }, pending: false, posOffsetMs: 0 }
        : { playing: false, other: 'Chrome' });
      return real(url, init);
    };
  });
  await page.locator('.offer.in .offer-ear').click();
  await expect(page.locator('.w.ly.ly-video.ly-podcast')).toHaveCount(1);
  await expect(page.locator('.ly-pname')).toHaveText('Lo-fi para estudar');
  await expect(page.locator('.ly-pshow')).toHaveText('Canal Calmo');
  await expect(page.locator('.ly-chip')).toHaveText('● Vídeo · tocando');
  await expect(page.locator('.ly-ctl2')).toBeHidden();
  expect(await page.evaluate(() => window.__asks)).toEqual(['/mirror/offer/answer?id=v1&yes=false']);
  const offers = await page.evaluate(() => window.__offers);
  await page.waitForTimeout(4500);
  await expect(page.locator('.offer')).toHaveCount(0);   // still asked, never shown again while listening
  expect(await page.evaluate(() => window.__offers)).toBeGreaterThan(offers);
  expect(errors).toEqual([]);
});

test('tapping the song in the media widget opens the screen of what is playing now', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/panel/');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('pb-demo-config', JSON.stringify({ night: { enabled: false }, shortcuts: [], display: { idleReturnSec: 0 }, pages: [
      { id: 'home', title: 'Início', enabled: true, widgets: [{ id: 'm', type: 'media', x: 0, y: 0, w: 6, h: 6, options: {} }] },
      { id: 'letra', title: 'Letra', enabled: true, widgets: [{ id: 'ly', type: 'lyrics', x: 0, y: 0, w: 12, h: 6, options: {} }] }] }));
  });
  await page.reload();
  await expect(page.locator('.w-media .m-title')).not.toBeEmpty();
  const app = await page.evaluate(async () => (await import('/panel/main.js')).media?.app);
  await page.locator('.w-media .m-text').click();
  await expect.poll(() => page.evaluate(async () => (await import('/panel/main.js')).curPage)).toBe(1);
  expect(await page.evaluate(() => localStorage.getItem('federano.listenVideo'))).toBe(app && app !== 'Spotify' ? '1' : null);
  expect(errors).toEqual([]);
});
