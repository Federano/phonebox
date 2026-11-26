const { test, expect: baseExpect } = require('@playwright/test');
const expect = baseExpect.configure({ timeout: 10000 });

test.use({ viewport: { width: 1280, height: 800 } });
const art = (color) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="300" height="400" fill="${color}"/><circle cx="150" cy="150" r="75" fill="white"/></svg>`);
const ART_A = art('#bb2047'), ART_B = art('#274c9e');
const SONG = {
  playing: true, key: 'cinema-a', kind: 'track', artistImage: ART_A,
  media: { app: 'Spotify', title: 'Cinema A', artist: 'Artista A', playing: true, posMs: 13000, durMs: 161000, artId: 0, canSeek: true, ageMs: 0 },
  lyrics: { found: true, lines: [{ t: 0, text: 'A letra continua livre' }, { t: 20000, text: 'Acima da animação' }] },
};

async function open(page, theme = '00', answer = SONG) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(({ answer, theme }) => {
    localStorage.clear();
    localStorage.setItem('federano.ftheme', theme);
    localStorage.setItem('pb-demo-config', JSON.stringify({ night: { enabled: false }, shortcuts: [],
      display: { touchGraceSec: 0, minDwellSec: 0, switchCountdownSec: 0 },
      pages: [{ id: 'letra', title: 'Letra', widgets: [{ id: 'ly', type: 'lyrics', x: 0, y: 0, w: 12, h: 6, options: {} }] },
        { id: 'home', title: 'Início', widgets: [{ id: 'c', type: 'clock', x: 0, y: 0, w: 12, h: 6, options: {} }] }] }));
    window.__cinemaAnswer = answer;
    let inner = window.fetch;
    Object.defineProperty(window, 'fetch', { configurable: true,
      get: () => { const fallback = inner; return (url, init) => String(url).includes('/lyrics/now')
        ? Promise.resolve(new Response(JSON.stringify(window.__cinemaAnswer), { headers: { 'Content-Type': 'application/json' } }))
        : fallback(url, init); },
      set: (next) => { inner = next; },
    });
  }, { answer, theme });
  await page.goto('/panel/');
  await expect(page.locator('.ly-title')).toHaveText(answer.media.title);
  return errors;
}

for (const theme of ['00', '01']) {
  test(`cinema uses three matching images inside its frame in theme ${theme}`, async ({ page }) => {
    const errors = await open(page, theme);
    const picture = page.locator('.ly-pic');
    await expect(picture).toHaveClass(/ly-cinema-playing/);
    await expect(picture.locator('img')).toHaveCount(3);
    const result = await picture.evaluate((pic) => {
      const frame = pic.getBoundingClientRect();
      const words = document.querySelector('.ly-main').getBoundingClientRect();
      const imgs = [...pic.querySelectorAll('img')];
      return { sources: imgs.map((img) => img.src), loaded: imgs.every((img) => img.complete && img.naturalWidth > 0),
        clip: getComputedStyle(pic).overflow, withinCard: frame.left >= words.right,
        animations: imgs.map((img) => getComputedStyle(img).animationName),
        contained: imgs.every((img) => { const r = img.getBoundingClientRect(); return r.left >= frame.left - 1 && r.right <= frame.right + 1 && r.top >= frame.top - 1 && r.bottom <= frame.bottom + 1; }) };
    });
    expect(result.sources).toEqual([ART_A, ART_A, ART_A]);
    expect(result.loaded).toBe(true);
    expect(result.clip).toBe('hidden');
    expect(result.withinCard).toBe(true);
    expect(result.contained).toBe(true);
    expect(result.animations).toContain('ly-cinema-front');
    expect(result.animations).not.toContain('m01-kb');
    expect(errors).toEqual([]);
    await picture.screenshot({ path: test.info().outputPath(`cinema-${theme}.png`) });
  });
}

test('cinema pauses with the app, full lyrics and playback, and resumes when visible', async ({ page }) => {
  await open(page);
  const picture = page.locator('.ly-pic');
  await expect(picture).toHaveClass(/ly-cinema-playing/);
  await page.evaluate(() => window.onAppPause(true));
  await expect(picture).not.toHaveClass(/ly-cinema-playing/);
  expect(await picture.locator('.ly-photo').evaluate((img) => getComputedStyle(img).animationPlayState)).toBe('paused');
  await page.evaluate(() => window.onAppPause(false));
  await expect(picture).toHaveClass(/ly-cinema-playing/);
  await page.locator('.ly-fsbtn').click();
  await expect(picture).not.toHaveClass(/ly-cinema-playing/);
  await page.locator('.ly-fsbtn').click();
  await expect(picture).toHaveClass(/ly-cinema-playing/);
  await page.evaluate(() => { window.__cinemaAnswer.media.playing = false; });
  await expect(page.locator('.ly-chip')).toContainText('pausado');
  await expect(picture).not.toHaveClass(/ly-cinema-playing/);
});

test('a new photo replaces every layer; pending and failed photos cannot leave the preceding artist', async ({ page }) => {
  await open(page);
  const picture = page.locator('.ly-pic');
  await expect(picture).toHaveClass(/ly-cinema/);
  await page.evaluate((src) => {
    window.__cinemaAnswer = { ...window.__cinemaAnswer, key: 'cinema-b', artistImage: src,
      media: { ...window.__cinemaAnswer.media, title: 'Cinema B' } };
  }, ART_B);
  await expect(page.locator('.ly-title')).toHaveText('Cinema B');
  await expect.poll(() => picture.locator('img').evaluateAll((imgs) => imgs.map((img) => img.getAttribute('src')))).toEqual([ART_B, ART_B, ART_B]);
  await page.evaluate(() => {
    window.__cinemaAnswer = { ...window.__cinemaAnswer, key: 'cinema-c', artistPending: true,
      media: { ...window.__cinemaAnswer.media, title: 'Cinema C', artId: 0 } };
  });
  await expect(page.locator('.ly-title')).toHaveText('Cinema C');
  await expect(picture).not.toHaveClass(/ly-cinema/);
  await expect.poll(() => picture.locator('img').evaluateAll((imgs) => imgs.every((img) => !img.hasAttribute('src')))).toBe(true);
  await page.evaluate(() => { window.__cinemaAnswer.artistPending = false; window.__cinemaAnswer.artistImage = 'data:image/png;base64,bm90LWFuLWltYWdl'; });
  await expect(page.locator('.w.ly')).toHaveClass(/ly-noart/);
  await expect(picture).not.toHaveClass(/ly-cinema/);
  await expect.poll(() => picture.locator('.ly-art-layer').evaluateAll((imgs) => imgs.every((img) => !img.hasAttribute('src')))).toBe(true);
});

test('podcast preserves its photo and reduced motion leaves the cinema still', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, '01');
  const picture = page.locator('.ly-pic');
  await expect(picture).toHaveClass(/ly-cinema/);
  await expect(picture).not.toHaveClass(/ly-cinema-playing/);
  expect(await picture.locator('.ly-photo').evaluate((img) => getComputedStyle(img).animationName)).toBe('none');
  await page.evaluate((src) => {
    window.__cinemaAnswer = { ...window.__cinemaAnswer, key: 'episode', kind: 'episode',
      episode: { show: 'Programa de exemplo', name: 'Episódio de exemplo', image: src, description: 'Uma conversa para ouvir.', durationMs: 161000 },
      media: { ...window.__cinemaAnswer.media, title: 'Episódio de exemplo' } };
  }, ART_B);
  await expect(page.locator('.w.ly')).toHaveClass(/ly-podcast/);
  await expect(picture.locator('.ly-photo')).toHaveAttribute('src', ART_B);
  await expect(picture).toHaveClass(/ly-cinema/);   // the podcast keeps the theme's photo effect (Fernando, 26/11)
  await expect(picture.locator('.ly-art-layer').first()).toHaveAttribute('src', ART_B);
});

test('album art fallback supplies all layers and leaving the lyrics page pauses them', async ({ page }) => {
  await page.route('**/agent/api/art?**', (route) => route.fulfill({ contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" fill="#274c9e"/></svg>' }));
  await open(page, '00', { ...SONG, artistImage: null, media: { ...SONG.media, artId: 81 } });
  const picture = page.locator('.ly-pic');
  await expect(picture).toHaveClass(/ly-cinema-playing/);
  await expect.poll(() => picture.locator('img').evaluateAll((imgs) => imgs.every((img) => img.complete && img.naturalWidth > 0 && img.src === imgs[imgs.length - 1].src && img.src.startsWith('data:image/svg')))).toBe(true);   // the demo swaps every /api/art picture for its own drawing
  await page.evaluate(async () => (await import('/panel/main.js')).gotoSkillPage('home'));
  await expect(picture).not.toHaveClass(/ly-cinema-playing/);
  await page.evaluate(async () => (await import('/panel/main.js')).gotoSkillPage('letra'));
  await expect(picture).toHaveClass(/ly-cinema-playing/);
});
