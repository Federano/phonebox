const { test, expect: expect0 } = require('@playwright/test');
const expect = expect0.configure({ timeout: 15000 });

// Federano "Reuniões": today's meetings, the alert before one starts, and Meet's buttons during a call (demo agent).
test.use({ viewport: { width: 1280, height: 800 } });

test('lists today, alerts before the next meeting, joins it and drives the call', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/panel/');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('federano.ftheme', '01'); localStorage.setItem('federano.meetLook2', 'lista');
    localStorage.setItem('pb-demo-config', JSON.stringify({ night: { enabled: false }, shortcuts: [],
      pages: [{ id: 'home', title: 'Início', enabled: true, widgets: [{ id: 'c', type: 'clock', x: 0, y: 0, w: 12, h: 6, options: {} }] },
        { id: 'reunioes', title: 'Reuniões', enabled: true, widgets: [{ id: 'm', type: 'meetings', x: 0, y: 0, w: 12, h: 6, options: { alertMin: 5 } }] }] }));
  });
  await page.reload();
  // the alert comes by itself (the next meeting starts in 4 minutes) and takes the panel to the meetings page
  await expect(page.locator('.mt-alert')).toBeVisible();
  await expect(page.locator('.mt-atitle')).toHaveText('Revisão do projeto Federano');
  await page.screenshot({ path: test.info().outputPath('alert.png') });
  await expect(page.locator('.mt-ev')).toHaveCount(3);
  await expect(page.locator('.mt-ev.past')).toHaveCount(1);
  await page.locator('.mt-abtn.go').click();
  await expect(page.locator('.mt-alert')).toHaveCount(0);
  // "Entrar" opens the Meet on the PC and asks whether it comes to the tablet too
  await expect(page.locator('.mt-ask.in')).toContainText('Levar a tela da Meet para o tablet?');
  await page.locator('.mt-ask button', { hasText: 'Não, só no PC' }).click();
  await expect(page.locator('.mt-ask')).toHaveCount(0);
  // the call is open: its buttons work
  await expect(page.locator('.w.mt.mt-incall')).toHaveCount(1);
  await expect(page.locator('.mt-cb', { hasText: 'Câmera' })).toHaveClass(/off/);
  await page.locator('.mt-cb', { hasText: 'Microfone' }).click();
  await expect(page.locator('.mt-cb', { hasText: 'Microfone' })).toHaveClass(/off/);
  await page.screenshot({ path: test.info().outputPath('page.png') });
  expect(errors).toEqual([]);
});

test('at the start time a loud alarm rings (with the tablet sound off), and closing the alert stops it', async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => {
    window.__alarm = [];
    window.Android = { meetAlarm: (key, text) => window.__alarm.push(['ring', text]), meetAlarmStop: () => window.__alarm.push(['stop']), buzz: () => {} };
  });
  await page.goto('/panel/');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('pb-demo-config', JSON.stringify({ night: { enabled: false }, shortcuts: [],
      pages: [{ id: 'reunioes', title: 'Reuniões', enabled: true, widgets: [{ id: 'm', type: 'meetings', x: 0, y: 0, w: 12, h: 6, options: { alertMin: 5 } }] }] }));
  });
  await page.reload();
  // the quiet alert first (4 minutes before): no alarm
  await page.clock.fastForward(8000);
  await expect(page.locator('.mt-alert')).toBeVisible();
  expect(await page.evaluate(() => window.__alarm.filter((a) => a[0] === 'ring').length)).toBe(0);
  await page.locator('.mt-ax').click();
  // the start time: the loud one
  await page.clock.fastForward(4 * 60000);
  await expect(page.locator('.mt-when')).toHaveText('Começando agora');
  expect(await page.evaluate(() => window.__alarm.find((a) => a[0] === 'ring'))).toEqual(['ring', 'Hora de entrar na reunião. Revisão do projeto Federano']);
  await page.locator('.mt-ax').click();
  expect(await page.evaluate(() => window.__alarm.at(-1))).toEqual(['stop']);
});

test('five looks, "Dia" first, switched by the corner button and kept on the tablet', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/panel/');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('federano.ftheme', '01');
    localStorage.setItem('pb-demo-config', JSON.stringify({ night: { enabled: false }, shortcuts: [],
      pages: [{ id: 'reunioes', title: 'Reuniões', enabled: true, widgets: [{ id: 'm', type: 'meetings', x: 0, y: 0, w: 12, h: 6, options: { alertMin: 0 } }] }] }));
  });
  await page.reload();
  await expect(page.locator('.mt-ev')).toHaveCount(3);
  await expect(page.locator('.mt-lookbtn').first()).toContainText('Dia');
  await expect(page.locator('.mt-d-in .blk').first()).toBeVisible();
  await expect(page.locator('.mt-d-in .nowl')).toHaveCount(1);
  for (const [name, sel] of [['Lista', '.mt-ev'], ['Linha do tempo', '.mt-a-tl .blk'], ['Foco na próxima', '.mt-a-cd.huge'], ['Relógio do dia', '.mt-a-dial'], ['Dia', '.mt-d-in .blk']]) {
    await page.locator('.mt-lookbtn').first().click();
    await expect(page.locator('.mt-lookbtn').first()).toContainText(name);
    await expect(page.locator(sel).first()).toBeVisible();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: test.info().outputPath(`look-${name.replace(/ /g, '-')}.png`) });
  }
  // the choice stays after a restart
  await page.locator('.mt-lookbtn').first().click();
  await page.reload();
  await expect(page.locator('.mt-lookbtn').first()).toContainText('Lista');
  expect(errors).toEqual([]);
});
