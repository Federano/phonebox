const { test, expect: expect0 } = require('@playwright/test');
// the page asks the agent every 4 s; a test's fake answer can miss the first ask, so allow a second one
const expect = expect0.configure({ timeout: 10000 });

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
  await expect(page.locator('.ly-vig')).toHaveCount(1);
  // the line being sung slides to the middle of the lyrics area
  await expect.poll(() => page.evaluate(() => { const l = document.querySelector('.ly-lines').getBoundingClientRect(), o = document.querySelector('.ly-line.on').getBoundingClientRect(); return Math.abs((o.top + o.height / 2) - (l.top + l.height / 2)); })).toBeLessThan(12);
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
  await expect(page.locator('.ly-title')).toHaveText('Nada tocando no Spotify');
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
  // the demo plays a song on Spotify: the panel moves to the lyrics page, straight away and without the countdown card
  await expect(page.locator('#dots i').nth(1)).toHaveClass(/on/, { timeout: 15000 });
  await expect(page.locator('#navCard')).not.toHaveClass(/(^| )on( |$)/);
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

test('a new song shows at once and its lyrics follow; the queue stays during a skip', async ({ page }) => {
  await page.goto('/panel/');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('pb-demo-config', JSON.stringify({ night: { enabled: false }, shortcuts: [],
      pages: [{ id: 'letra', title: 'Letra', enabled: true, widgets: [{ id: 'ly', type: 'lyrics', x: 0, y: 0, w: 12, h: 6, options: {} }] }] }));
  });
  await page.reload();
  await page.evaluate(() => {
    const q = [{ id: 'spotify:track:abc', name: 'Miracle Man', artist: 'Oliver Tree' }, { id: 'spotify:track:def', name: 'Hurt', artist: 'Oliver Tree' }];
    const media = { app: 'Spotify', title: 'Miracle Man', artist: 'Oliver Tree', album: '', playing: true, posMs: 2000, durMs: 150000, artId: 0, canSeek: true, ageMs: 0 };
    window.__step = 0;
    const real = window.fetch;
    window.fetch = (url, init) => {
      if (String(url).includes('/lyrics/now')) {
        window.__step++;
        // first answers: the new song, no lyrics yet and an empty queue (as Spotify does right after a skip)
        const a = window.__step < 8
          ? { playing: true, key: 'miracle man\u0001oliver tree', media, artistImage: null, queue: window.__step === 1 ? q : [], lyrics: null, pending: true }
          : { playing: true, key: 'miracle man\u0001oliver tree', media, artistImage: null, queue: [], lyrics: { found: true, instrumental: false, plain: '', lines: [{ t: 1000, text: 'Line one' }] }, pending: false };
        return Promise.resolve(new Response(JSON.stringify(a), { headers: { 'Content-Type': 'application/json' } }));
      }
      return real(url, init);
    };
  });
  await expect(page.locator('.ly-title')).toHaveText('Miracle Man');
  await expect(page.locator('.ly-note')).toHaveText('Carregando a letra…');
  await expect(page.locator('.ly-line')).toHaveText('Line one');
  // the empty queues did not wipe the list: the song now playing left it, the next one stayed
  await expect(page.locator('.ly-q')).toHaveCount(1);
  await expect(page.locator('.ly-q')).toContainText('Hurt');
});

test('while Spotify plays the panel does not go home by itself', async ({ page }) => {
  await page.goto('/panel/');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('pb-demo-config', JSON.stringify({ night: { enabled: false }, shortcuts: [],
      display: { touchGraceSec: 0, minDwellSec: 0, switchCountdownSec: 0, idleReturnSec: 3, homePage: 'home' },
      pages: [{ id: 'home', title: 'Home', enabled: true, widgets: [{ id: 'c', type: 'clock', x: 0, y: 0, w: 12, h: 6, options: {} }] },
        { id: 'letra', title: 'Letra', enabled: true, widgets: [{ id: 'ly', type: 'lyrics', x: 0, y: 0, w: 12, h: 6, options: {} }] }] }));
  });
  await page.reload();
  // the demo plays on Spotify: the panel goes to the lyrics and stays there well past the 3 s idle return
  await expect(page.locator('#dots i').nth(1)).toHaveClass(/on/, { timeout: 15000 });
  await page.waitForTimeout(8000);
  await expect(page.locator('#dots i').nth(1)).toHaveClass(/on/);
});

test('scrolling the lyrics by hand is not pulled back to the line being sung', async ({ page }) => {
  const many = Array.from({ length: 40 }, (_, i) => ({ t: 1000 + i * 3000, text: 'Line number ' + (i + 1) }));
  await open(page, { ...SONG, media: { ...SONG.media, posMs: 4000 }, lyrics: { found: true, instrumental: false, plain: '', lines: many } });
  await expect(page.locator('.ly-line')).toHaveCount(40);
  await page.waitForTimeout(800);
  const list = page.locator('.ly-lines');
  await list.hover();
  await page.mouse.wheel(0, 1500);
  await page.waitForTimeout(2500);   // the song moves on a line meanwhile
  const top = await list.evaluate((el) => el.scrollTop);
  expect(top).toBeGreaterThan(900);   // still where the hand left it, not back at line 2
});

test('a discreet button shows only the lyrics, full screen, and brings the card back', async ({ page }) => {
  await open(page, SONG);
  await expect(page.locator('.ly-card')).toBeVisible();
  await page.locator('.ly-fsbtn').click();
  await expect(page.locator('.w.ly')).toHaveClass(/ly-fs/);
  await expect(page.locator('.ly-card')).toBeHidden();
  await expect(page.locator('.ly-line.on')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('lyrics-full.png') });
  await page.locator('.ly-fsbtn').click();
  await expect(page.locator('.ly-card')).toBeVisible();
});

test('a podcast episode gets its own screen: show, episode, date, description, 15/30 s skips, voice wave, no errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e) + (process.env.DBG ? e.stack : '')));
  await open(page, {
    playing: true, key: 'ep 214\u0001café com ideias', kind: 'episode',
    media: { app: 'Spotify', title: 'Ep. 214 — Por que a gente procrastina', artist: 'Café com Ideias', album: '', playing: true, posMs: 60000, durMs: 5880000, artId: 0, canSeek: true, ageMs: 0 },
    episode: { name: 'Ep. 214 — Por que a gente procrastina', show: 'Café com Ideias', publisher: 'Rádio Aberta', description: 'Neste episódio a gente conversa sobre procrastinação.', date: '2026-11-15', image: null, durationMs: 5880000 },
    lyrics: { lines: [], plain: '', instrumental: false, found: false }, pending: false, posOffsetMs: 0,
  });
  await expect(page.locator('.w.ly.ly-podcast')).toHaveCount(1);
  await expect(page.locator('.ly-chip')).toHaveText('● Podcast · tocando');
  await expect(page.locator('.ly-pshow')).toHaveText('Café com Ideias');
  await expect(page.locator('.ly-pname')).toHaveText('Ep. 214 — Por que a gente procrastina');
  await expect(page.locator('.ly-pmeta')).toHaveText('15 nov 2026 · 1 h 38 min · Rádio Aberta');
  await expect(page.locator('.ly-times span').nth(1)).toHaveText('1:38:00');
  await expect(page.locator('.ly-pdesc')).toContainText('procrastinação');
  await expect(page.locator('.ly-back')).toHaveAttribute('aria-label', 'Voltar 15 segundos');
  await expect(page.locator('.ly-fwd')).toHaveAttribute('aria-label', 'Avançar 30 segundos');
  await expect(page.locator('.ly-note')).toBeHidden();
  await expect(page.locator('.ly-queue')).toBeHidden();
  await page.waitForTimeout(800);
  // the voice wave is drawn on the background canvas, by its own worker thread
  await expect.poll(() => page.evaluate(() => +(document.querySelector('.w.ly').dataset.fxFrames || 0))).toBeGreaterThan(30);
  await page.screenshot({ path: test.info().outputPath('podcast.png') });
  expect(errors).toEqual([]);
});
