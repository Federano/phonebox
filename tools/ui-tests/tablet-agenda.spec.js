const { test, expect } = require('@playwright/test');

test.use({ viewport: { width: 1280, height: 800 }, timezoneId: 'America/Sao_Paulo' });

async function setup(page, selected = true) {
  await page.addInitScript(({ selected }) => {
    const config = { night: { enabled: false }, rules: [], shortcuts: [], pages: [
      { id: 'meet', title: 'Reuniões', widgets: [{ id: 'mt', type: 'meetings', x: 0, y: 0, w: 12, h: 6, options: { calendar: 'Trabalho', alertMin: 0 } }] },
      { id: 'agenda', title: 'Agenda', widgets: [{ id: 'ag', type: 'agenda', x: 0, y: 0, w: 12, h: 6, options: { days: 14 } }] },
    ] };
    localStorage.setItem('cfg', JSON.stringify(config));
    localStorage.setItem('pb-demo-config', JSON.stringify(config));
    let inner = window.fetch;
    Object.defineProperty(window, 'fetch', { configurable: true,
      get: () => { const fetch = inner; return (url, init) => window.__pcOffline && String(url).includes('/agent/') ? Promise.reject(new TypeError('PC desligado')) : fetch(url, init); },
      set: (value) => { inner = value; },
    });
    window.__phoneboxKey = 'test-key';
    window.__calendarCalls = [];
    window.__calendarState = JSON.parse(sessionStorage.getItem('test-tablet-account') || 'null') || {
      supported: true, configured: selected, connected: selected, setupAttempted: selected,
      permissionGranted: true, account: selected ? 'pessoal@exemplo.com' : '', connectionId: selected ? 'account-a' : '',
    };
    const start = Date.now() + 3600000;
    const day = new Date(); day.setHours(0, 0, 0, 0);
    window.__tabletEvents = [
      { id: 'meeting', title: 'Compromisso da conta escolhida', start, end: start + 1800000, calendar: 'Pessoal', allDay: false },
      { id: 'all-day', title: 'Dia inteiro na data certa', start: +day, end: +day + 86400000, calendar: 'Pessoal', allDay: true },
    ];
    window.Android = { calendarRequest(key, id, operation) {
      if (key !== 'test-key') throw new Error('invalid key');
      window.__calendarCalls.push(operation);
      if (operation === 'connect') {
        Object.assign(window.__calendarState, { configured: true, connected: true, setupAttempted: true, account: 'pessoal@exemplo.com', connectionId: 'account-a' });
        sessionStorage.setItem('test-tablet-account', JSON.stringify(window.__calendarState));
      }
      const reply = operation === 'today' ? {
        today: window.__tabletEvents.filter((e) => !e.allDay), events: window.__tabletEvents,
        calendars: true, source: 'tablet', updatedAt: Date.now(), ...window.__calendarState,
      } : { ...window.__calendarState };
      setTimeout(() => window.onFederanoCalendarResult(id, JSON.stringify(reply)), 0);
    } };
  }, { selected });
  await page.goto('/panel/');
  await page.waitForFunction(() => window.__pbUp);
  return page.locator('.w-meetings');
}

test('a conta escolhida fornece as reuniões mesmo com filtro antigo do PC e sem conexão', async ({ page }) => {
  const meetings = await setup(page);
  await expect(meetings).toContainText('Compromisso da conta escolhida');
  await expect(meetings).not.toContainText('Dia inteiro na data certa');
  await page.evaluate(async () => {
    window.__pcOffline = true;
    (await import('/panel/main.js')).setOnline(false);
    window.__tabletEvents[0].title = 'Alterado enquanto o PC está desligado';
    window.onFederanoCalendarChanged();
  });
  await expect(meetings).toContainText('Alterado enquanto o PC está desligado');
  const calendar = await page.evaluate(async () => (await import('/panel/main.js')).D.calendar);
  expect(calendar.events.find((e) => e.allDay).start).toBe(await page.evaluate(() => { const day = new Date(); day.setHours(0, 0, 0, 0); return +day; }));
});

test('revogar a permissão ou remover a conta tira os dados anteriores da tela', async ({ page }) => {
  const meetings = await setup(page);
  await expect(meetings).toContainText('Compromisso da conta escolhida');
  await page.evaluate(() => {
    window.__calendarState.connected = false;
    window.__calendarState.permissionGranted = false;
    window.onFederanoCalendarChanged();
  });
  await expect(meetings).not.toContainText('Compromisso da conta escolhida');
  await expect(meetings).toContainText('Autorize o acesso');
  await expect.poll(() => page.evaluate(async () => (await import('/panel/main.js')).D.calendar?.events?.length)).toBe(0);
});

test('a escolha inicial é solicitada uma vez e não reaparece ao reabrir o painel', async ({ page }) => {
  const meetings = await setup(page, false);
  await expect(meetings).toContainText('Compromisso da conta escolhida');
  expect(await page.evaluate(() => window.__calendarCalls.filter((op) => op === 'connect').length)).toBe(1);
  await page.reload();
  await page.waitForFunction(() => window.__pbUp);
  await expect(meetings).toContainText('Compromisso da conta escolhida');
  expect(await page.evaluate(() => window.__calendarCalls.filter((op) => op === 'connect').length)).toBe(0);
});

test('o botão da conta mostra a conta escolhida e troca por outra num toque', async ({ page }) => {
  const meetings = await setup(page);
  await page.evaluate(() => { window.__phoneboxKey = 'test-key'; });
  const acc = meetings.locator('.mt-accbtn');
  await expect(acc).toHaveText('pessoal ⇄');
  await page.evaluate(() => {
    const real = window.Android.calendarRequest;
    window.Android.calendarRequest = (key, id, operation, payload) => {
      if (operation === 'choose') Object.assign(window.__calendarState, { account: 'fernando.ribeiro@polibrasnet.com.br', connectionId: 'account-b' });
      return real(key, id, operation, payload);
    };
  });
  await acc.click();
  await expect(acc).toHaveText('fernando.ribeiro ⇄');
  expect(await page.evaluate(() => window.__calendarCalls)).toContain('choose');
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/agenda-conta.png' });
});
