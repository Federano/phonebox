const { test, expect } = require('@playwright/test');

// Federano: the controls over the mirrored video. The agent's answers are faked in the page; the test checks which
// requests each control sends (the same media API the media widget uses) and the voice command path.
test.use({ viewport: { width: 1280, height: 800 } });

async function openMirror(page) {
  await page.addInitScript(() => {
    let next = 0;
    window.__heard = 'pausa';
    window.Android = {
      canListen: () => true,
      listen: () => {
        const id = ++next;
        setTimeout(() => window.onAndroidSpeech('ready', '', id), 10);
        setTimeout(() => window.onAndroidSpeech('partial', window.__heard, id), 30);
        setTimeout(() => window.onAndroidSpeech('final', window.__heard, id), 60);
        return id;
      },
      stopListening: () => {},
      cancelListening: () => {},
    };
  });
  await page.goto('/panel/');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('pb-demo-config', JSON.stringify({ night: { enabled: false }, shortcuts: [],
      pages: [{ id: 'test', title: 'Test', enabled: true, widgets: [{ id: 'fd', type: 'federano', x: 0, y: 0, w: 12, h: 6, options: {} }] }] }));
  });
  await page.reload();
  await expect(page.locator('.w.fd')).toBeVisible();
  await page.evaluate(() => {
    window.__posts = [];
    const json = (o) => new Response(JSON.stringify(o), { headers: { 'Content-Type': 'application/json' } });
    const media = { app: 'Chrome', title: 'Vídeo de teste', artist: 'Canal', album: '', playing: true, posMs: 60000, durMs: 600000, artId: 0, canSeek: true, ageMs: 0 };
    const demo = window.fetch;
    window.fetch = async (url, init) => {
      const u = String(url).replace(/^.*\/api/, '');
      const post = init && init.method === 'POST';
      if (post) window.__posts.push(u);
      if (u.startsWith('/skills/run')) {
        const text = decodeURIComponent(u.split('text=')[1] || '');
        return json(text === 'espelha' ? { ok: true, skill: 'espelhar', reply: 'Vídeo de teste', mirror: true } : { ok: true, skill: 'pausar', reply: 'Pausado.' });
      }
      if (u.startsWith('/mirror/frame')) { await new Promise((r) => setTimeout(r, 200)); return json({ wait: true }); }
      if (u.startsWith('/mirror/controls')) return json({ media, audio: { volume: 40, muted: false, canControl: true } });
      if (u.startsWith('/mirror/')) return json({ ok: true });
      if (u.startsWith('/media/playpause')) { media.playing = !media.playing; return json({ ok: true, media }); }
      if (u.startsWith('/media/')) return json({ ok: true, media });
      if (u.startsWith('/volume')) return json({ volume: Number((u.match(/level=(\d+)/) || [0, 40])[1]), muted: u.includes('mute'), canControl: true });
      return demo(url, init);
    };
  });
  await page.locator('.fd-chip').first().click();
  await expect(page.locator('.mirror')).toBeVisible();
}

test('mirror controls drive the PC player', async ({ page }) => {
  await openMirror(page);
  const ctl = page.locator('.mirror-ctl');
  await expect(page.locator('.mirror')).toHaveClass(/chrome/);
  await expect(page.locator('.mc-time').last()).toHaveText('10:00');
  await expect(page.locator('.mc-time').first()).toHaveText(/^1:0\d$/);
  await expect(page.locator('.mc-voln')).toHaveText('40%');
  await page.screenshot({ path: test.info().outputPath('mirror-controls.png') });

  await ctl.locator('.mc-back').click();
  await ctl.locator('.mc-fwd').click();
  await ctl.locator('.mc-next').click();
  await ctl.locator('.mc-play').click();
  await expect(ctl.locator('.mc-play path')).toHaveCount(1);   // shows "play" after pausing
  await page.locator('.mc-seek').evaluate((s) => { s.value = '500'; s.dispatchEvent(new Event('input')); s.dispatchEvent(new Event('change')); });
  await page.locator('.mc-vol').evaluate((s) => { s.value = '70'; s.dispatchEvent(new Event('input')); s.dispatchEvent(new Event('change')); });
  await ctl.locator('.mc-mute').click();
  const posts = await page.evaluate(() => window.__posts);
  for (const p of ['/media/seekby?ms=-10000', '/media/seekby?ms=10000', '/media/next', '/media/playpause', '/media/seek?ms=300000', '/volume?level=70', '/volume?op=mute'])
    expect(posts).toContain(p);

  // voice: "pausa" goes to the skills and the answer shows over the video
  await ctl.locator('.mc-mic').click();
  await expect(page.locator('.mc-said')).toHaveText('Pausado.');
  expect(await page.evaluate(() => window.__posts)).toContain('/skills/run?text=pausa');

  // a tap on the picture hides the controls, another brings them back
  await page.mouse.click(200, 200);
  await expect(page.locator('.mirror')).not.toHaveClass(/chrome/);
  await page.mouse.click(200, 200);
  await expect(page.locator('.mirror')).toHaveClass(/chrome/);
});

test('hidden controls do not take taps', async ({ page }) => {
  await openMirror(page);
  await page.mouse.click(200, 200);
  await expect(page.locator('.mirror')).not.toHaveClass(/chrome/);
  const box = await page.locator('.mc-next').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);   // shows the controls, does not skip
  await expect(page.locator('.mirror')).toHaveClass(/chrome/);
  expect(await page.evaluate(() => window.__posts)).not.toContain('/media/next');
});
