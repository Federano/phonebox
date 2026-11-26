const { test, expect } = require('@playwright/test');
const KEY = 'federano.editor.offline.v1';
test.use({ viewport: { width: 1280, height: 800 } });

async function setup(page, native = false) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(({ native }) => {
    window.__pagePosts = [];
    let inner = window.fetch;
    Object.defineProperty(window, 'fetch', {
      configurable: true,
      get: () => {
        const fallback = inner;
        return async (url, init) => {
          const path = String(url);
          if (path.includes('/agent/api/') && localStorage.getItem('test-agent-offline') === '1') throw new TypeError('offline');
          if (path.includes('/api/panel/page/') && init?.method === 'POST') {
            window.__pagePosts.push(JSON.parse(init.body));
            const reply = await fallback(url, init);
            if (localStorage.getItem('test-drop-reply') === '1') {
              localStorage.removeItem('test-drop-reply'); localStorage.setItem('test-agent-offline', '1');
              throw new TypeError('reply lost after write');
            }
            return reply;
          }
          const reply = await fallback(url, init);
          if (path.endsWith('/api/config') && localStorage.getItem('test-other-pc') === '1') {
            const body = await reply.json(); body.editorPcId = 'other-pc';
            return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
          }
          return reply;
        };
      },
      set: (next) => { inner = next; },
    });
    if (native) window.Android = { savePage: (_key, id, body, requestId) => {
      window.__nativeBody = JSON.parse(body);
      fetch(`/agent/api/panel/page/${id}`, { method: 'POST', body }).then(async (r) => {
        window.dispatchEvent(new CustomEvent('federano-page-saved', { detail: { id: requestId, status: r.status, data: await r.json() } }));
      });
    } };
  }, { native });
  await page.goto('/panel/');
  await page.waitForFunction(() => window.__pbUp);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('pb-demo-config', JSON.stringify({ night: { enabled: false }, shortcuts: [],
      pages: [{ id: 'home', title: 'Início', enabled: true, widgets: [
        { id: 'c', type: 'clock', x: 0, y: 0, w: 6, h: 4, options: { date: true } },
        { id: 'n', type: 'note', x: 6, y: 0, w: 3, h: 2, appearance: { accent: '#ff0000' }, options: { text: 'original' } },
      ] }, { id: 'other', title: 'Outra', enabled: true, widgets: [] }] }));
  });
  await page.reload();
  await page.waitForFunction(() => window.__pbUp);
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{}').catalogs?.length || 0, KEY)).toBe(1);
  return errors;
}
async function offline(page) {
  await page.evaluate(async () => { localStorage.setItem('test-agent-offline', '1'); (await import('/panel/main.js')).setOnline(false); });
}
async function reconnect(page) {
  await page.evaluate(async () => {
    localStorage.removeItem('test-agent-offline');
    await (await import('/panel/main.js')).loadConfig();
  });
}
async function editor(page) {
  await page.evaluate(() => window.openOverview());
  await page.locator('#ovEdit').click();
  await expect(page.locator('.ed')).toBeVisible();
}
async function editNote(page, text) {
  await editor(page);
  await page.locator('.ed-w', { hasText: 'Nota' }).click();
  await page.locator('#ed-n-text').fill(text);
}
const drafts = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)).drafts, KEY);
const pcWidgets = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('pb-demo-config')).pages.find((p) => p.id === 'home')?.widgets);
async function save(page) { await page.locator('.ed-save').click(); await expect(page.locator('.ed')).toHaveCount(0); }

test('edit offline without opening the editor beforehand; survive reloads, edit again and sync once', async ({ page }) => {
  const errors = await setup(page);
  await offline(page);
  await editNote(page, 'Primeira edição offline'); await save(page);
  expect((await pcWidgets(page)).find((w) => w.id === 'n').options.text).toBe('original');
  await page.reload();
  await editNote(page, 'Segunda edição offline');
  await page.locator('.ed-btn', { hasText: '+ Adicionar' }).click();
  await page.locator('.ed-pi b', { hasText: 'Relógio analógico' }).click();
  await save(page);
  const local = (await drafts(page))[0];
  expect(local.page.widgets.find((w) => w.id === 'n').appearance).toEqual({ accent: '#ff0000' });
  const addedId = local.page.widgets.find((w) => w.type === 'analog').id;
  await reconnect(page);
  await expect.poll(async () => (await drafts(page)).length).toBe(0);
  const remote = await pcWidgets(page);
  expect(remote.find((w) => w.id === 'n').options.text).toBe('Segunda edição offline');
  expect(remote.filter((w) => w.type === 'analog').map((w) => w.id)).toEqual([addedId]);
  expect(errors).toEqual([]);
});

test('a lost acknowledgement is recognized after reloading and does not add a widget twice', async ({ page }) => {
  await setup(page); await offline(page); await editor(page);
  await page.locator('.ed-btn', { hasText: '+ Adicionar' }).click();
  await page.locator('.ed-pi b', { hasText: 'Relógio analógico' }).click(); await save(page);
  await page.evaluate(() => localStorage.setItem('test-drop-reply', '1'));
  await reconnect(page);
  expect((await drafts(page)).length).toBe(1);
  expect((await pcWidgets(page)).filter((w) => w.type === 'analog')).toHaveLength(1);
  await page.reload(); await reconnect(page);
  await expect.poll(async () => (await drafts(page)).length).toBe(0);
  expect((await pcWidgets(page)).filter((w) => w.type === 'analog')).toHaveLength(1);
  expect(await page.evaluate(() => window.__pagePosts.length)).toBe(0);
});

test('editing again after a lost reply keeps the newest offline text', async ({ page }) => {
  await setup(page); await offline(page); await editNote(page, 'Primeira'); await save(page);
  await page.evaluate(() => localStorage.setItem('test-drop-reply', '1'));
  await reconnect(page);
  await editNote(page, 'Mais recente'); await save(page);
  await reconnect(page);
  await expect.poll(async () => (await drafts(page)).length).toBe(0);
  expect((await pcWidgets(page)).find((w) => w.id === 'n').options.text).toBe('Mais recente');
});

for (const choosePc of [true, false]) test(`a desktop conflict preserves both copies until choosing ${choosePc ? 'PC' : 'tablet'}`, async ({ page }) => {
  await setup(page); await offline(page); await editNote(page, 'Texto do tablet'); await save(page);
  await page.evaluate(() => {
    const config = JSON.parse(localStorage.getItem('pb-demo-config'));
    config.pages[0].widgets.find((w) => w.id === 'n').options.text = 'Texto do PC';
    localStorage.setItem('pb-demo-config', JSON.stringify(config));
  });
  await reconnect(page);
  expect((await drafts(page))[0].conflict.kind).toBe('changed');
  expect((await pcWidgets(page)).find((w) => w.id === 'n').options.text).toBe('Texto do PC');
  await editor(page);
  await expect(page.locator('.ed-side')).toContainText('também mudou no PC');
  await page.screenshot({ path: test.info().outputPath('conflict.png'), animations: 'disabled' });
  if (choosePc) await page.locator('.ed-use-pc').click(); else await save(page);
  await expect.poll(async () => (await drafts(page)).length).toBe(0);
  expect((await pcWidgets(page)).find((w) => w.id === 'n').options.text).toBe(choosePc ? 'Texto do PC' : 'Texto do tablet');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('cfg')).pages.map((p) => p.id))).toEqual(['home', 'other']);
});

test('drafts are never uploaded to a different computer', async ({ page }) => {
  await setup(page); await offline(page); await editNote(page, 'Apenas no meu PC'); await save(page);
  await page.evaluate(() => localStorage.setItem('test-other-pc', '1')); await reconnect(page);
  expect(await page.evaluate(() => window.__pagePosts.length)).toBe(0);
  expect((await drafts(page))[0].pcId).toBe('demo-pc');
  expect((await pcWidgets(page)).find((w) => w.id === 'n').options.text).toBe('original');
});

test('the native bridge carries the JSON body and acknowledgement', async ({ page }) => {
  const errors = await setup(page, true);
  await editNote(page, 'Enviado pelo app Android'); await save(page);
  await expect.poll(async () => (await drafts(page)).length).toBe(0);
  const body = await page.evaluate(() => window.__nativeBody);
  expect(body.pcId).toBe('demo-pc'); expect(body.baseRevision).toBeTruthy(); expect(body.editId).toBeTruthy();
  expect((await pcWidgets(page)).find((w) => w.id === 'n').options.text).toBe('Enviado pelo app Android');
  expect(errors).toEqual([]);
});

test('a failed local write keeps the editor and unsaved text open', async ({ page }) => {
  await setup(page); await offline(page); await editNote(page, 'Não pode sumir');
  await page.evaluate((key) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(k, value) { if (k === key) throw new DOMException('full', 'QuotaExceededError'); return original.call(this, k, value); };
  }, KEY);
  await page.locator('.ed-save').click();
  await expect(page.locator('#toast')).toContainText('Não foi possível salvar no tablet');
  await expect(page.locator('.ed')).toBeVisible();
  await expect(page.locator('#ed-n-text')).toHaveValue('Não pode sumir');
  expect((await drafts(page)).length).toBe(0);
});

test('a draft is recovered even when the app closed before updating the displayed layout cache', async ({ page }) => {
  await setup(page); await offline(page); await editNote(page, 'Cópia durável'); await save(page);
  await page.evaluate(() => {
    const stale = JSON.parse(localStorage.getItem('cfg'));
    stale.pages[0].widgets.find((w) => w.id === 'n').options.text = 'Cache antigo';
    localStorage.setItem('cfg', JSON.stringify(stale));
  });
  await page.reload(); await page.waitForFunction(() => window.__pbUp);
  await expect(page.locator('.w-note')).toContainText('Cópia durável');
  await editor(page); await page.locator('.ed-w', { hasText: 'Nota' }).click();
  await expect(page.locator('#ed-n-text')).toHaveValue('Cópia durável');
  await page.screenshot({ path: test.info().outputPath('offline.png'), animations: 'disabled' });
});

test('deleting a page on the PC keeps its offline copy until explicitly discarded', async ({ page }) => {
  await setup(page); await offline(page); await editNote(page, 'Preservar página'); await save(page);
  await page.evaluate(() => {
    const config = JSON.parse(localStorage.getItem('pb-demo-config'));
    config.pages = config.pages.filter((p) => p.id !== 'home');
    localStorage.setItem('pb-demo-config', JSON.stringify(config));
  });
  await reconnect(page);
  expect((await drafts(page))[0].conflict.kind).toBe('deleted');
  await editor(page);
  await expect(page.locator('.ed-save')).toBeDisabled();
  await expect(page.locator('.ed-side')).toContainText('removida no PC');
  await page.locator('.ed-btn', { hasText: 'Cancelar' }).click();
  expect((await drafts(page)).length).toBe(1);
  await editor(page); await page.locator('.ed-use-pc').click();
  expect((await drafts(page)).length).toBe(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('cfg')).pages.map((p) => p.id))).toEqual(['other']);
});
