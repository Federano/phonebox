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
  await expect(page.locator('.ly-artist')).toHaveText('Oliver Tree · Ugly Is Beautiful');
  await expect(page.locator('.ly-chip')).toHaveText('● Spotify · tocando');
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

test('controls drive the PC player and a tapped line jumps there', async ({ page }) => {
  await open(page, SONG);
  await expect(page.locator('.ly-line')).toHaveCount(4);
  await page.evaluate(() => {
    window.__posts = [];
    const f = window.fetch;
    window.fetch = (url, init) => {
      if (init && init.method === 'POST' && String(url).includes('/media/')) {
        window.__posts.push(String(url).replace(/^.*\/api/, ''));
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } }));
      }
      return f(url, init);
    };
  });
  await page.locator('.ly-play').click();
  await page.locator('.ly-back').click();
  await page.locator('.ly-fwd').click();
  await page.locator('.ly-next').click();
  await page.locator('.ly-prev').click();
  await page.locator('.ly-line', { hasText: "I'm a lover" }).click();
  const posts = await page.evaluate(() => window.__posts);
  expect(posts).toEqual(['/media/playpause', '/media/seekby?ms=-10000', '/media/seekby?ms=10000', '/media/next', '/media/prev', '/media/seek?ms=19800']);
});

test('a song on Spotify opens the lyrics page by itself', async ({ page }) => {
  await page.goto('/panel/');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('pb-demo-config', JSON.stringify({ night: { enabled: false }, shortcuts: [],
      display: { touchGraceSec: 0, minDwellSec: 0, switchCountdownSec: 0 },
      pages: [{ id: 'home', title: 'Home', enabled: true, widgets: [{ id: 'c', type: 'clock', x: 0, y: 0, w: 12, h: 6, options: {} }] },
        { id: 'letra', title: 'Letra', enabled: true, widgets: [{ id: 'ly', type: 'lyrics', x: 0, y: 0, w: 12, h: 6, options: {} }] }] }));
  });
  await page.reload();
  // the demo plays a song on Spotify: the panel moves to the lyrics page
  await expect(page.locator('#dots i').nth(1)).toHaveClass(/on/, { timeout: 15000 });
});

test('translation under each line, switched on and off', async ({ page }) => {
  const tr = ['Sem parar', 'Sem parar, sem parar', 'Pode acreditar', 'Sou de amar, não de brigar'];
  await open(page, { ...SONG, lyrics: { ...SONG.lyrics, trans: tr, lang: 'en' } });
  await expect(page.locator('.ly-tl')).toHaveCount(4);
  await expect(page.locator('.ly-line.on .ly-tl')).toHaveText('Pode acreditar');
  await expect(page.locator('.ly-tr')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('lyrics-tr.png') });
  await page.locator('.ly-tr').click();
  await expect(page.locator('.ly-line.on .ly-tl')).toBeHidden();
  await page.locator('.ly-tr').click();
  await expect(page.locator('.ly-line.on .ly-tl')).toBeVisible();
});

test('no translation for a song already in Portuguese: no switch', async ({ page }) => {
  await open(page, { ...SONG, lyrics: { ...SONG.lyrics, trans: null, lang: 'pt' } });
  await expect(page.locator('.ly-line')).toHaveCount(4);
  await expect(page.locator('.ly-tl')).toHaveCount(0);
  await expect(page.locator('.ly-tr')).toBeHidden();
});

test('the card lists the next songs and a tap plays one', async ({ page }) => {
  await open(page, { ...SONG, queue: [{ id: 'spotify:track:abc', name: 'Miracle Man', artist: 'Oliver Tree' }, { id: 'spotify:track:def', name: 'Hurt', artist: 'Oliver Tree' }] });
  await expect(page.locator('.ly-q')).toHaveCount(2);
  await expect(page.locator('.ly-q').first()).toContainText('Miracle Man');
  await page.screenshot({ path: test.info().outputPath('lyrics-card.png') });
  await page.evaluate(() => {
    window.__played = [];
    const f = window.fetch;
    window.fetch = (url, init) => {
      if (String(url).includes('/controls/spotify/action/')) { window.__played.push(String(url).replace(/^.*\/api/, '')); return Promise.resolve(new Response('{"ok":true}', { headers: { 'Content-Type': 'application/json' } })); }
      return f(url, init);
    };
  });
  await page.locator('.ly-q').nth(1).click();
  expect(await page.evaluate(() => window.__played)).toEqual(['/controls/spotify/action/play-queued?id=spotify%3Atrack%3Adef']);
});
