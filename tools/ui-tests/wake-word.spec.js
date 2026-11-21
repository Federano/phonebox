const { test, expect } = require('@playwright/test');

// Federano wake word: with "Microfone do tablet sempre ouvindo" on, the tablet listens in rounds (the Android bridge is
// faked) and runs what follows "Federano" through the agent's skills; off, it never opens the microphone.
async function setup(page, wakeWord) {
  await page.addInitScript(() => {
    window.__listen = [];
    let next = 0;
    window.Android = {
      canListen: () => true,
      listen: (key, lang, offline) => { const id = ++next; window.__listen.push({ id, lang, offline }); return id; },
      stopListening: () => {},
      cancelListening: () => {},
    };
  });
  await page.goto('/panel/');
  await page.evaluate((wakeWord) => {
    localStorage.clear();
    localStorage.setItem('pb-demo-config', JSON.stringify({ night: { enabled: false }, shortcuts: [], federano: { wakeWord },
      pages: [{ id: 'home', title: 'Home', enabled: true, widgets: [{ id: 'c', type: 'clock', x: 0, y: 0, w: 12, h: 6, options: {} }] }] }));
  }, wakeWord);
  await page.reload();
  await page.evaluate(() => {
    window.__runs = [];
    const demo = window.fetch;
    window.fetch = (url, init) => {
      if (String(url).includes('/skills/run')) {
        window.__runs.push(decodeURIComponent(String(url).replace(/^.*text=/, '')));
        return Promise.resolve(new Response(JSON.stringify({ ok: true, reply: 'Próximo: "Hurt".' }), { headers: { 'Content-Type': 'application/json' } }));
      }
      return demo(url, init);
    };
  });
}

test('on: "Federano, próxima música" runs the command; other talk does nothing', async ({ page }) => {
  await setup(page, true);
  await expect.poll(() => page.evaluate(() => window.__listen.length), { timeout: 10000 }).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__listen[0])).toMatchObject({ lang: 'pt-BR', offline: true });
  // someone talking without the wake word
  await page.evaluate(() => { const l = window.__listen.at(-1); window.onAndroidSpeech('final', 'vamos jantar agora', l.id); });
  await expect.poll(() => page.evaluate(() => window.__listen.length), { timeout: 5000 }).toBeGreaterThan(1);
  await page.evaluate(() => { const l = window.__listen.at(-1); window.onAndroidSpeech('final', 'Federano, próxima música', l.id); });
  await expect.poll(() => page.evaluate(() => window.__runs)).toEqual(['próxima música']);
  await expect(page.locator('#toast')).toContainText('Hurt');
  // "Federano" alone, then the command in the next round
  await expect.poll(() => page.evaluate(() => window.__listen.length), { timeout: 5000 }).toBeGreaterThan(2);
  await page.evaluate(() => { const l = window.__listen.at(-1); window.onAndroidSpeech('final', 'Federano', l.id); });
  await expect.poll(() => page.evaluate(() => window.__listen.length), { timeout: 5000 }).toBeGreaterThan(3);
  await page.evaluate(() => { const l = window.__listen.at(-1); window.onAndroidSpeech('final', 'pausa', l.id); });
  await expect.poll(() => page.evaluate(() => window.__runs)).toEqual(['próxima música', 'pausa']);
});

test('off: the microphone is never opened', async ({ page }) => {
  await setup(page, false);
  await page.waitForTimeout(6000);
  expect(await page.evaluate(() => window.__listen.length)).toBe(0);
});
