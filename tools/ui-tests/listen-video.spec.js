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
      if (u.includes('/lyrics/now')) return json(u.includes('any=true') && !window.__gap
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
  await page.locator('.ly-play').click();
  await expect(page.locator('.ly-chip')).toHaveText('● Vídeo · pausado');
  await expect(page.locator('.ly-ctl2')).toBeHidden();
  expect(await page.evaluate(() => window.__asks)).toEqual(['/mirror/offer/answer?id=v1&yes=false']);
  const offers = await page.evaluate(() => window.__offers);
  await page.waitForTimeout(4500);
  await expect(page.locator('.offer')).toHaveCount(0);   // still asked, never shown again while listening
  // the gap between two clips (nothing playing for a moment) keeps "Só ouvir" on: the next clip is not offered
  await page.evaluate(() => { window.__gap = true; });
  await page.waitForTimeout(4000);
  await page.evaluate(() => { window.__gap = false; });
  expect(await page.evaluate(() => localStorage.getItem('federano.listenVideo'))).toBe('1');
  await page.waitForTimeout(2500);
  await expect(page.locator('.offer')).toHaveCount(0);
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

test('the podcast and "Só ouvir" text scrolls up and down without holding sideways page swipes', async ({ page }) => {
  await page.goto('/panel/');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('pb-demo-config', JSON.stringify({ night: { enabled: false }, shortcuts: [], pages: [{ id: 'letra', title: 'Letra', enabled: true, widgets: [{ id: 'ly', type: 'lyrics', x: 0, y: 0, w: 12, h: 6, options: {} }] }] }));
  });
  await page.reload();
  await page.evaluate(() => document.querySelector('.w.ly').classList.add('ly-podcast'));
  const css = await page.locator('.w.ly .ly-words').evaluate((n) => { const s = getComputedStyle(n); return [s.overflowX, s.overflowY, s.overscrollBehaviorX, s.overscrollBehaviorY, s.touchAction].join(' '); });
  expect(css).toBe('hidden auto auto contain auto');
});

test('"Só ouvir" shows the song\'s lyrics like Spotify, the YouTube picture, and switches to details or to the video', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/panel/');
  await page.evaluate(() => {
    localStorage.clear(); localStorage.setItem('federano.listenVideo', '1');
    localStorage.setItem('pb-demo-config', JSON.stringify({ night: { enabled: false }, shortcuts: [], pages: [{ id: 'letra', title: 'Letra', enabled: true, widgets: [{ id: 'ly', type: 'lyrics', x: 0, y: 0, w: 12, h: 6, options: {} }] }] }));
  });
  await page.reload();
  await page.evaluate(() => {
    window.__posts = [];
    const pic = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#336"/></svg>');
    const real = window.fetch;
    window.fetch = (url, init) => {
      const u = String(url);
      const json = (d) => Promise.resolve(new Response(JSON.stringify(d), { headers: { 'Content-Type': 'application/json' } }));
      if (u.includes('/mirror/start')) { window.__posts.push('start'); return json({ ok: false, error: 'teste' }); }
      if (u.includes('/lyrics/now')) return json({ playing: true, key: 'video|Chrome|Rashid - Se o Mundo Acabar', kind: 'video', image: pic, song: 'Se o Mundo Acabar', singer: 'Rashid',
        media: { app: 'Chrome', title: 'Rashid - Se o Mundo Acabar', artist: 'Rashid', album: '', playing: true, posMs: 5000, durMs: 200000, artId: 0, canSeek: true, ageMs: 0 },
        lyrics: u.includes('have=video') ? null : { found: true, instrumental: false, plain: '', lines: [{ t: 0, text: 'Primeira linha' }, { t: 4000, text: 'Segunda linha' }, { t: 60000, text: 'Depois' }] },
        pending: false, posOffsetMs: 0 });
      return real(url, init);
    };
  });
  const ly = page.locator('.w.ly');
  await expect(ly.locator('.ly-line', { hasText: 'Segunda linha' })).toHaveCount(1, { timeout: 12000 });
  await expect(ly).toHaveClass(/ly-video/);
  await expect(ly).not.toHaveClass(/ly-podcast/);
  await expect(ly.locator('.ly-photo')).toHaveAttribute('src', /^data:image\/svg/);
  await ly.getByRole('button', { name: 'Detalhes' }).click();
  await expect(ly).toHaveClass(/ly-podcast/);
  await expect(ly.locator('.ly-pname')).toHaveText('Rashid - Se o Mundo Acabar');
  await ly.getByRole('button', { name: 'Letra', exact: true }).click();
  await expect(ly).not.toHaveClass(/ly-podcast/);
  await expect(ly.locator('.ly-line', { hasText: 'Primeira linha' })).toHaveCount(1);
  await ly.getByRole('button', { name: 'Ver vídeo' }).click();
  await expect.poll(() => page.evaluate(() => window.__posts)).toEqual(['start']);
  await expect(page.locator('#toast')).toContainText('teste');
  expect(errors).toEqual([]);
});

async function videoFixture(page, options = {}) {
  await page.goto('/panel/');
  await page.evaluate((options) => {
    localStorage.clear(); localStorage.setItem('federano.listenVideo', '1');
    const pages = [{ id: 'letra', title: 'Letra', enabled: true, widgets: [{ id: 'ly', type: 'lyrics', x: 0, y: 0, w: 12, h: 6, options: {} }] }];
    if (options.presence) pages.unshift({ id: 'home', title: 'Início', enabled: true, widgets: [{ id: 'clock', type: 'clock', x: 0, y: 0, w: 12, h: 6, options: {} }] });
    localStorage.setItem('pb-demo-config', JSON.stringify({ night: { enabled: false }, shortcuts: [],
      display: { touchGraceSec: 0, minDwellSec: 0, switchCountdownSec: 0, idleReturnSec: options.presence ? 3 : 0, idleDimMin: options.presence ? 1 : 0, homePage: 'home' }, pages }));
  }, options);
  await page.reload();
  await page.evaluate((options) => {
    window.__videoCalls = []; window.__videoAvailable = !options.missing;
    window.__videoReply = {
      playing: true, key: 'video|Chrome|Supercombo - Música de teste', kind: 'video',
      clockSource: options.clockSource || 'system', pending: false, posOffsetMs: 0,
      media: { app: 'Chrome', title: 'Supercombo - Música de teste', artist: 'Supercombo', album: '',
        playing: !options.paused, posMs: 5000, durMs: 235000, artId: 0, canSeek: true, ageMs: options.ageMs || 0 },
    };
    const real = window.fetch;
    window.fetch = (url, init) => {
      if (options.presence && String(url).includes('/api/state')) return real(url, init).then(async (response) =>
        new Response(JSON.stringify({ ...await response.json(), media: window.__videoReply.media }), { headers: { 'Content-Type': 'application/json' } }));
      if (!String(url).includes('/lyrics/now')) return real(url, init);
      window.__videoCalls.push(String(url));
      const lyrics = window.__videoAvailable
        ? { found: true, instrumental: false, plain: '', lines: [{ t: 0, text: 'Linha fictícia atual' }, { t: 60000, text: 'Linha fictícia posterior' }] }
        : { found: false, instrumental: false, plain: '', lines: [] };
      return Promise.resolve(new Response(JSON.stringify({ ...window.__videoReply, lyrics }), { headers: { 'Content-Type': 'application/json' } }));
    };
    window.dispatchEvent(new Event('federano-listen'));
  }, options);
  return page.locator('.w.ly');
}

test('a failed video lookup asks again and enables lyrics when the agent recovers', async ({ page }) => {
  const ly = await videoFixture(page, { missing: true });
  await expect(ly.getByRole('button', { name: 'Sem letra' })).toBeDisabled();
  await page.evaluate(() => { window.__videoAvailable = true; });
  await expect(ly.locator('.ly-line.on')).toHaveText('Linha fictícia atual');
  await expect(ly.getByRole('button', { name: 'Detalhes' })).toBeEnabled();
  const calls = await page.evaluate(() => window.__videoCalls);
  expect(calls.length).toBeGreaterThan(1);
  expect(new URL(calls.at(-1), 'https://test.local').searchParams.get('have')).toBe('');
});

test('the shared Windows media clock cannot overwrite the YouTube extension position', async ({ page }) => {
  const ly = await videoFixture(page, { clockSource: 'youtube' });
  await expect(ly.locator('.ly-line.on')).toHaveText('Linha fictícia atual');
  await page.evaluate(async () => {
    const { setMediaState } = await import('/panel/main.js');
    setMediaState({ ...window.__videoReply.media, posMs: 90000, ageMs: 0 });
  });
  await page.waitForTimeout(700);
  await expect(ly.locator('.ly-line.on')).toHaveText('Linha fictícia atual');
  await expect(ly.locator('.ly-times')).not.toContainText('1:30');
});

test('a paused video does not add the age of its last sample to the lyrics position', async ({ page }) => {
  const ly = await videoFixture(page, { paused: true, ageMs: 90000 });
  await expect(ly.locator('.ly-line.on')).toHaveText('Linha fictícia atual');
  await expect(ly.locator('.ly-times')).toContainText('0:05');
});

test('reading YouTube lyrics prevents absence return and dimming, survives a clip gap, and releases after playback stops', async ({ page }) => {
  const ly = await videoFixture(page, { presence: true });
  await expect(ly.locator('.ly-line.on')).toHaveText('Linha fictícia atual');
  await page.evaluate(async () => {
    const main = await import('/panel/main.js');
    const realNow = Date.now.bind(Date); window.__absenceOffset = 0;
    Date.now = () => realNow() + window.__absenceOffset;
    // A preceding Spotify session must not mask the test with its own one-minute grace.
    main.setMediaState({ ...window.__videoReply.media, app: 'Spotify' });
    main.goPage(1, true);
    window.__absenceOffset = 65000;
    main.setMediaState(window.__videoReply.media);
  });
  await page.waitForTimeout(4500);
  await expect.poll(() => page.evaluate(async () => (await import('/panel/main.js')).curPage)).toBe(1);
  await expect(page.locator('body')).not.toHaveClass(/dimmed/);
  await page.evaluate(async () => {
    window.__absenceOffset += 10000; window.__videoReply.media.playing = false;
    (await import('/panel/main.js')).setMediaState(window.__videoReply.media);
  });
  await page.waitForTimeout(1300);
  await expect.poll(() => page.evaluate(async () => (await import('/panel/main.js')).curPage)).toBe(1);
  await page.evaluate(async () => {
    window.__absenceOffset += 61000;
    (await import('/panel/main.js')).setMediaState(window.__videoReply.media);
  });
  await expect.poll(() => page.evaluate(async () => (await import('/panel/main.js')).curPage)).toBe(0);
});

test('"Só ouvir" lists the YouTube playlist like Spotify\'s queue and plays the picked video', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/panel/');
  await page.evaluate(() => {
    localStorage.clear(); localStorage.setItem('federano.listenVideo', '1'); localStorage.setItem('federano.videoView', 'info');
    localStorage.setItem('pb-demo-config', JSON.stringify({ night: { enabled: false }, shortcuts: [], pages: [{ id: 'letra', title: 'Letra', enabled: true, widgets: [{ id: 'ly', type: 'lyrics', x: 0, y: 0, w: 12, h: 6, options: {} }] }] }));
  });
  await page.reload();
  await page.evaluate(() => {
    window.__plays = [];
    const real = window.fetch;
    window.fetch = (url, init) => {
      const u = String(url);
      const json = (d) => Promise.resolve(new Response(JSON.stringify(d), { headers: { 'Content-Type': 'application/json' } }));
      if (u.includes('/browser/playlist/play')) { window.__plays.push(u.replace(/^.*\/api/, '')); return json({ ok: true }); }
      if (u.includes('/lyrics/now')) return json({ playing: true, key: 'video|Chrome|Fabio Brazza - Naquele Bar (Prod. Paiva)', kind: 'video', image: null,
        media: { app: 'Chrome', title: 'Fabio Brazza - Naquele Bar (Prod. Paiva)', artist: 'Fabio Brazza', album: '', playing: true, posMs: 5000, durMs: 231000, artId: 0, canSeek: true, ageMs: 0 },
        lyrics: { found: false, instrumental: false, plain: '', lines: [] }, pending: false, posOffsetMs: 0,
        queue: [{ id: 'aaaaaaaaaaa', name: 'Mc Sid & Aline Mc - Feio é Elogio', artist: 'Bendita Gravadora', yt: true }, { id: 'bbbbbbbbbbb', name: 'Twenty One Pilots - Seven Nation Army', artist: 'Matthew Baker 2', yt: true }] });
      return real(url, init);
    };
  });
  const ly = page.locator('.w.ly');
  await expect(ly.locator('.ly-q')).toHaveCount(2, { timeout: 12000 });
  await expect(ly.locator('.ly-qh')).toBeVisible();
  await ly.locator('.ly-q', { hasText: 'Seven Nation Army' }).click();
  await expect.poll(() => page.evaluate(() => window.__plays)).toEqual(['/browser/playlist/play?v=bbbbbbbbbbb']);
  if (process.env.SHOTS) { await page.waitForTimeout(800); await page.screenshot({ path: process.env.SHOTS + '/lista-youtube.png' }); }
  expect(errors).toEqual([]);
});
