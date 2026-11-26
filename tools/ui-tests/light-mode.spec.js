const { test, expect } = require('@playwright/test');

// Original demonstration text. The fake player keeps advancing between replies, so cue checks do not depend on polling.
const SONG = {
  playing: true, key: 'light-mode-original', kind: 'track', artistImage: null,
  media: { app: 'Spotify', title: 'Um novo caminho', artist: 'Texto demonstrativo', album: 'Federano', playing: true, posMs: 0, durMs: 240000, artId: 0, canSeek: true, ageMs: 0 },
  lyrics: { found: true, instrumental: false, plain: '', lines: [
    { t: 0, text: 'Cada palavra encontra o seu lugar' },
    { t: 1600, text: 'O caminho continua com tranquilidade' },
    { t: 3600, text: 'Há espaço para construir um novo dia' },
    { t: 120000, text: 'Seguimos em frente sem perder o ritmo' },
  ] },
};
const PODCAST = {
  playing: true, key: 'light-mode-podcast', kind: 'episode', artistImage: null,
  media: { ...SONG.media, title: 'Uma conversa sobre novos caminhos', artist: 'Conversas do Federano', album: '', posMs: 60000, durMs: 3600000 },
  episode: { name: 'Uma conversa sobre novos caminhos', show: 'Conversas do Federano', publisher: 'Texto demonstrativo', description: 'Um episódio de exemplo para conferir os controles e a leitura no modo leve.', date: '2026-11-26', image: null, durationMs: 3600000 },
  lyrics: { found: false, instrumental: false, plain: '', lines: [] },
};

test.use({ viewport: { width: 1280, height: 800 } });

async function open(page, { light = false, theme = '01', answer = SONG, paused = false, bars = false } = {}) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(({ light, theme, answer, paused, bars }) => {
    if (!localStorage.getItem('test-light-mode-seeded')) {
      localStorage.clear();
      localStorage.setItem('test-light-mode-seeded', '1');
      localStorage.setItem('federano.lightMode', light ? '1' : '0');
      localStorage.setItem('federano.ftheme', theme);
      localStorage.setItem('pb-demo-config', JSON.stringify({ night: { enabled: false }, rules: [], shortcuts: [],
        display: { idleReturnSec: 0, touchGraceSec: 0, minDwellSec: 0, switchCountdownSec: 0 },
        pages: [{ id: 'letra', title: 'Letra', enabled: true, widgets: [
          { id: 'ly', type: 'lyrics', x: 0, y: 0, w: bars ? 9 : 12, h: 6, options: {} },
          ...(bars ? [{ id: 'sp', type: 'spectrum', x: 9, y: 0, w: 3, h: 6, options: {} }] : []),
        ] }] }));
    }
    window.__lightRequests = { spectrum: 0, lyrics: 0, posts: [] };
    window.__lightWorkers = { live: 0, maxLive: 0 };
    const NativeWorker = window.Worker;
    if (NativeWorker) window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args); this.__counted = true;
        window.__lightWorkers.live++;
        window.__lightWorkers.maxLive = Math.max(window.__lightWorkers.maxLive, window.__lightWorkers.live);
      }
      terminate() {
        if (this.__counted) { this.__counted = false; window.__lightWorkers.live--; }
        return super.terminate();
      }
    };
    const fixture = JSON.parse(JSON.stringify(answer));
    let position = fixture.media.posMs, playing = paused ? false : fixture.media.playing, at = performance.now();
    const pos = () => Math.max(0, Math.min(fixture.media.durMs, position + (playing ? performance.now() - at : 0)));
    const json = (data) => Promise.resolve(new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }));
    let inner = window.fetch;
    Object.defineProperty(window, 'fetch', {
      configurable: true,
      get: () => {
        const fallback = inner;
        return (input, init = {}) => {
          const url = typeof input === 'string' ? input : input.url;
          if (url.includes('/agent/api/') && localStorage.getItem('test-light-mode-offline') === '1') return Promise.reject(new TypeError('offline'));
          if (url.includes('/api/lyrics/now')) {
            window.__lightRequests.lyrics++;
            return json({ ...fixture, media: { ...fixture.media, playing, posMs: pos(), ageMs: 0 } });
          }
          if (url.includes('/api/spectrum')) {
            window.__lightRequests.spectrum++;
            return json({ shown: true, active: true, fps: 30, b: Array.from({ length: 48 }, (_, i) => 25 + (i * 7 + window.__lightRequests.spectrum) % 60) });
          }
          if (init.method === 'POST' && url.includes('/api/media/')) {
            const parsed = new URL(url, location.href), action = parsed.pathname.split('/').pop();
            window.__lightRequests.posts.push(parsed.pathname.replace(/^.*\/api/, '') + parsed.search);
            position = pos(); at = performance.now();
            if (action === 'playpause') playing = !playing;
            else if (action === 'seek') position = Number(parsed.searchParams.get('ms'));
            else if (action === 'seekby') position = Math.max(0, position + Number(parsed.searchParams.get('ms')));
            return json({ ok: true, media: { playing, posMs: position, ageMs: 0, durMs: fixture.media.durMs } });
          }
          if (url.includes('/controls/spotify/player')) return json({ connected: true, shuffle: false, repeat: 'off', liked: false });
          if (init.method === 'POST' && url.includes('/controls/spotify/action/')) {
            window.__lightRequests.posts.push(url.replace(/^.*\/api/, '')); return json({ ok: true });
          }
          return fallback(input, init);
        };
      },
      set: (next) => { inner = next; },
    });
  }, { light, theme, answer, paused, bars });
  await page.goto('/panel/');
  await page.waitForFunction(() => window.__pbUp);
  await expect(page.locator('.ly-title')).toHaveText(answer.media.title);
  await expect(page.locator('body')).toHaveAttribute('data-flight', light ? '1' : '0');
  return errors;
}

async function themes(page) {
  await page.evaluate(() => window.openOverview());
  await page.locator('#ovThemes').click();
  await expect(page.locator('#themes')).toBeVisible();
  await expect(page.locator('.th-card')).toHaveCount(2);
}
const setLight = (page, enabled) => page.evaluate(async (value) => (await import('/panel/light-mode.js')).setLightMode(value), enabled);
const frames = (page) => page.locator('.w.ly').evaluate((box) => Number(box.dataset.fxFrames || 0));
const asks = (page) => page.evaluate(() => window.__lightRequests.spectrum);

test('the switch persists offline and stays independent of Tema 00 and Tema 01', async ({ page }) => {
  const errors = await open(page, { theme: '00' });
  await themes(page);
  const toggle = page.getByRole('switch', { name: 'Modo leve', exact: true });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(toggle).toHaveText('Modo leve: ligado');
  await expect(page.locator('#themes')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('federano.lightMode'))).toBe('1');
  await page.locator('.th-card', { hasText: 'Tema 01' }).click();
  await expect(page.locator('#themes')).toHaveCount(0);
  await expect(page.locator('body')).toHaveAttribute('data-ftheme', '01');
  await expect(page.locator('body')).toHaveAttribute('data-flight', '1');
  await page.evaluate(() => localStorage.setItem('test-light-mode-offline', '1'));
  await page.reload(); await page.waitForFunction(() => window.__pbUp);
  await expect(page.locator('body')).toHaveAttribute('data-flight', '1');
  await expect(page.locator('body')).toHaveAttribute('data-ftheme', '01');
  await themes(page);
  await toggle.click();
  await expect(toggle).toHaveText('Modo leve: desligado');
  await expect(page.locator('#themes')).toBeVisible();
  await page.locator('.th-card', { hasText: 'Tema 00' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-ftheme', '00');
  await expect(page.locator('body')).toHaveAttribute('data-flight', '0');
  await page.reload(); await page.waitForFunction(() => window.__pbUp);
  await expect(page.locator('body')).toHaveAttribute('data-flight', '0');
  expect(errors).toEqual([]);
});

test('light mode follows timed cues and keeps media and Spotify controls working', async ({ page }) => {
  const errors = await open(page, { light: true, paused: true });
  await expect(page.locator('.ly-line.on')).toHaveText(SONG.lyrics.lines[0].text);
  await page.locator('.ly-play').click();
  await expect(page.locator('.ly-line.on')).toHaveText(SONG.lyrics.lines[1].text, { timeout: 3000 });
  await expect(page.locator('.ly-line.on')).toHaveText(SONG.lyrics.lines[2].text, { timeout: 3000 });
  await page.locator('.ly-play').click();
  await page.locator('.ly-back').click(); await page.locator('.ly-fwd').click();
  await page.locator('.ly-next').click(); await page.locator('.ly-prev').click();
  await page.locator('.ly-line[data-t="120000"]').click();
  await page.locator('.ly-shuf').click(); await page.locator('.ly-like').click(); await page.locator('.ly-rep').click();
  const posts = await page.evaluate(() => window.__lightRequests.posts);
  expect(posts).toEqual(expect.arrayContaining(['/media/playpause', '/media/seekby?ms=-10000', '/media/seekby?ms=10000', '/media/next', '/media/prev', '/media/seek?ms=119800', '/controls/spotify/action/shuffle', '/controls/spotify/action/like', '/controls/spotify/action/repeat']));
  expect(posts.filter((p) => p === '/media/playpause')).toHaveLength(2);
  expect(await asks(page)).toBe(0);
  expect(errors).toEqual([]);
});

test('the static background stops drawing and asking for audio, then resumes in normal mode', async ({ page }) => {
  const errors = await open(page);
  await expect.poll(() => frames(page)).toBeGreaterThan(0);
  await expect.poll(() => asks(page)).toBeGreaterThan(0);
  await setLight(page, true); await page.waitForTimeout(200);
  const frozen = await frames(page), stopped = await asks(page);
  await page.waitForTimeout(2400);
  expect(await frames(page)).toBe(frozen); expect(await asks(page)).toBe(stopped);
  await setLight(page, false);
  await expect.poll(() => frames(page)).toBeGreaterThan(frozen);
  await expect.poll(() => asks(page)).toBeGreaterThan(stopped);
  expect(errors).toEqual([]);
});

test('repeated toggles keep one effects worker and one action per click', async ({ page }) => {
  const errors = await open(page);
  for (let n = 0; n < 4; n++) {
    await setLight(page, true); await page.waitForTimeout(100);
    await setLight(page, false); await page.waitForTimeout(100);
  }
  await setLight(page, true); await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.__lightWorkers.maxLive)).toBeLessThanOrEqual(1);
  const frozen = await frames(page), stopped = await asks(page);
  await page.waitForTimeout(2200);
  expect(await frames(page)).toBe(frozen); expect(await asks(page)).toBe(stopped);
  await page.locator('.ly-play').click();
  expect(await page.evaluate(() => window.__lightRequests.posts.filter((p) => p === '/media/playpause').length)).toBe(1);
  expect(errors).toEqual([]);
});

test('podcast titles stay visible while cosmetic animations are disabled', async ({ page }) => {
  const errors = await open(page, { light: true, answer: PODCAST });
  await expect(page.locator('.ly-pname')).toHaveText(PODCAST.episode.name);
  const words = await page.locator('.ly-pname .ly-w').evaluateAll((nodes) => nodes.map((node) => {
    const style = getComputedStyle(node); return { opacity: Number(style.opacity), transform: style.transform, animation: style.animationName };
  }));
  expect(words.length).toBeGreaterThan(0);
  for (const word of words) expect(word).toEqual({ opacity: 1, transform: 'none', animation: 'none' });
  await page.locator('.ly-back').click(); await page.locator('.ly-fwd').click();
  expect(await page.evaluate(() => window.__lightRequests.posts)).toEqual(['/media/seekby?ms=-15000', '/media/seekby?ms=30000']);
  expect(await asks(page)).toBe(0);
  expect(errors).toEqual([]);
});

test('disabling light mode respects a system preference for reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = await open(page, { light: true });
  await setLight(page, false); await page.waitForTimeout(200);
  const frozen = await frames(page), stopped = await asks(page);
  await page.waitForTimeout(2400);
  expect(await frames(page)).toBe(frozen); expect(await asks(page)).toBe(stopped);
  expect(stopped).toBe(0);
  await page.locator('.ly-play').click();
  expect(await page.evaluate(() => window.__lightRequests.posts)).toContain('/media/playpause');
  expect(errors).toEqual([]);
});

test('a visible spectrum widget can still request the audio it needs', async ({ page }) => {
  const errors = await open(page, { light: true, bars: true });
  await expect.poll(() => asks(page)).toBeGreaterThan(0);
  await expect(page.locator('.w-spectrum .spec-msg')).toBeHidden();
  expect(errors).toEqual([]);
});

test('the fallback without Worker supports switching between static and animated effects', async ({ page }) => {
  await page.addInitScript(() => { window.Worker = undefined; });
  const errors = await open(page, { light: true });
  await page.waitForTimeout(2200);
  expect(await asks(page)).toBe(0);
  await setLight(page, false);
  await expect.poll(() => asks(page)).toBeGreaterThan(0);
  await expect.poll(() => page.locator('.ly-fx').evaluate((canvas) => {
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    return data.some((value, i) => i % 4 === 3 && value > 0);
  })).toBe(true);
  await setLight(page, true); await page.waitForTimeout(200);
  const stopped = await asks(page); await page.waitForTimeout(2200);
  expect(await asks(page)).toBe(stopped);
  expect(errors).toEqual([]);
});
