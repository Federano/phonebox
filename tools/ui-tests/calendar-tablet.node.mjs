import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// The production file is a browser ES module; importing a data URL keeps the
// repository's other (CommonJS) test tools unchanged.
const source = await readFile(new URL('../../android/app/src/main/assets/www/calendar-tablet.js', import.meta.url), 'utf8');
const { createTabletCalendar } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const CURRENT = new Date(2026, 10, 26, 10).getTime();
const connected = (id = 'account-a') => ({
  supported: true, configured: true, connected: true, permissionGranted: true,
  setupAttempted: true, account: `${id}@example.test`, connectionId: id,
});
const appointment = (id = 'a', start = CURRENT + 3600000) => ({
  id, title: `Reunião ${id}`, start, end: start + 1800000, allDay: false,
  calendar: 'Trabalho', color: '#ff2a4f', meet: 'https://meet.google.com/example', location: '', attendees: 2,
});
function make(t, overrides = {}) {
  let identity = connected(), clock = CURRENT;
  const calls = [], handlers = new Map();
  const win = { __phoneboxKey: 'panel-bridge-key' };
  Object.defineProperty(win, 'localStorage', { get() { throw new Error('Calendar data must not reach browser storage'); } });
  const packet = (events = [appointment()]) => ({
    today: events, events, calendars: true, source: 'tablet', updatedAt: clock,
    connectionId: identity.connectionId, account: identity.account,
  });
  const send = (id, value) => win.onFederanoCalendarResult?.(id, typeof value === 'string' ? value : JSON.stringify(value));
  win.Android = {
    calendarRequest(key, id, operation, payloadJSON) {
      const call = { key, id, operation, payload: JSON.parse(payloadJSON) };
      calls.push(call);
      queueMicrotask(() => {
        const result = handlers.has(operation) ? handlers.get(operation)(call) : operation === 'state' ? identity : operation === 'today' ? packet() : { ok: true };
        if (result !== undefined) send(id, result);
      });
    },
  };
  const client = createTabletCalendar({ window: win, now: () => clock, timeoutMs: 40, userTimeoutMs: 60, ...overrides });
  t.after(() => client.dispose());
  return { client, win, calls, send, packet, handlers, identify(value) { identity = value; }, time(value) { clock = value; } };
}

test('web/browser use stays unconfigured and cannot initiate native consent', async () => {
  const client = createTabletCalendar({ window: {} });
  assert.equal(client.supported(), false);
  assert.equal((await client.state()).configured, false);
  assert.equal(await client.today(), null);
  await assert.rejects(client.connect(), { code: 'unsupported' });
  client.dispose();
});

test('the bridge receives the private key and positive Kotlin-compatible integer IDs', async (t) => {
  const { client, calls } = make(t);
  const data = await client.today();
  assert.equal(data.source, 'tablet');
  assert.equal(data.today[0].title, 'Reunião a');
  assert.equal(data.today[0].people, 2);
  assert.deepEqual(calls.map((c) => c.operation), ['state', 'today']);
  assert.ok(calls.every((c) => c.key === 'panel-bridge-key' && Number.isInteger(c.id) && c.id > 0 && c.id <= 2147483647));
  assert.notEqual(calls[0].id, calls[1].id);
});

test('concurrent widgets share the permission and account identity check', async (t) => {
  const { client, calls } = make(t);
  const [a, b] = await Promise.all([client.today(), client.today()]);
  assert.equal(a.today[0].id, 'a');
  assert.equal(b.today[0].id, 'a');
  assert.equal(calls.filter((c) => c.operation === 'state').length, 1);
});

test('native query failures reuse isolated memory only after confirming permission', async (t) => {
  const { client, handlers } = make(t);
  const fresh = await client.today();
  fresh.today[0].title = 'consumer changed data';
  fresh.events.length = 0;
  handlers.set('today', () => ({ ok: false, error: 'Provedor temporariamente indisponível.' }));
  const cached = await client.today();
  assert.equal(cached.stale, true);
  assert.equal(cached.today[0].title, 'Reunião a');
  assert.equal(cached.events.length, 1);
  handlers.set('state', () => ({ ok: false, error: 'Não foi possível conferir a permissão.' }));
  assert.deepEqual((await client.today()).today, []);
});

test('switching accounts never reuses appointments from the preceding account', async (t) => {
  const { client, handlers, identify } = make(t);
  await client.today();
  identify(connected('account-b'));
  handlers.set('today', () => ({ ok: false, error: 'Falha ao consultar.' }));
  const result = await client.today();
  assert.equal(result.connectionId, 'account-b');
  assert.deepEqual(result.today, []);
  assert.deepEqual(result.events, []);
});

test('permission revocation clears memory even when it occurs between state and query', async (t) => {
  const { client, handlers } = make(t);
  await client.today();
  handlers.set('today', () => ({ ok: false, code: 'permission_denied', error: 'Permissão revogada.' }));
  const result = await client.today();
  assert.deepEqual(result.today, []);
  assert.equal(result.needsAuthorization, true);
});

test('configured accounts without current permission remain a tablet source, with no PC fallback', async (t) => {
  const { client, identify, calls } = make(t);
  identify({ ...connected(), permissionGranted: false, connected: false });
  const result = await client.today();
  assert.notEqual(result, null);
  assert.equal(result.source, 'tablet');
  assert.equal(result.needsAuthorization, true);
  assert.deepEqual(result.today, []);
  assert.equal(calls.filter((c) => c.operation === 'today').length, 0);
});

test('provider changes invalidate memory and notify every subscriber without storage', async (t) => {
  const { client, handlers, win } = make(t);
  await client.today();
  let updates = 0;
  client.subscribe(() => { throw new Error('bad widget'); });
  const unsubscribe = client.subscribe((event) => { assert.equal(event.type, 'changed'); updates++; });
  win.onFederanoCalendarChanged();
  handlers.set('today', () => ({ ok: false, error: 'Consulta falhou.' }));
  assert.deepEqual((await client.today()).today, []);
  assert.equal(updates, 1);
  unsubscribe();
  win.onFederanoCalendarChanged();
  assert.equal(updates, 1);
});

test('a result arriving after a native change cannot repopulate old appointments', async (t) => {
  const { client, handlers, calls, win, send, packet } = make(t);
  await client.state();
  handlers.set('today', () => undefined);
  const reading = client.today();
  await new Promise((resolve) => setImmediate(resolve));
  const call = calls.findLast((c) => c.operation === 'today');
  win.onFederanoCalendarChanged();
  send(call.id, packet());
  const result = await reading;
  assert.deepEqual(result.today, []);
  assert.equal(result.stale, true);
});

test('timeouts discard callbacks and unrelated request IDs cannot resolve a subsequent request', async (t) => {
  const { client, handlers, calls, send } = make(t, { timeoutMs: 10 });
  handlers.set('state', () => undefined);
  await assert.rejects(client.state(), { code: 'timeout' });
  const expiredId = calls.at(-1).id;
  const pending = client.state();
  send(expiredId, connected('wrong-account'));
  await new Promise((resolve) => setImmediate(resolve));
  send(calls.at(-1).id, connected('right-account'));
  assert.equal((await pending).connectionId, 'right-account');
});

test('malformed JSON and mismatched account results fail closed', async (t) => {
  const { client, handlers, packet } = make(t);
  handlers.set('state', () => '{invalid-json');
  await assert.rejects(client.state(), { code: 'invalid_response' });
  handlers.delete('state');
  handlers.set('today', () => ({ ...packet(), connectionId: 'other-account' }));
  assert.deepEqual((await client.today()).today, []);
});

test('only explicit actions ask permission or open account selection', async (t) => {
  const { client, handlers, identify, calls } = make(t);
  identify({ ...connected(), configured: false, connected: false, setupAttempted: true });
  assert.equal((await client.state()).setupAttempted, true);
  assert.equal(await client.today(), null);
  assert.equal(calls.some((c) => ['connect', 'choose'].includes(c.operation)), false);
  handlers.set('connect', () => { identify(connected()); return { ok: true }; });
  assert.equal((await client.connect()).connected, true);
  handlers.set('choose', () => { identify(connected('account-b')); return { ok: true }; });
  assert.equal((await client.choose()).connectionId, 'account-b');
  handlers.set('disconnect', () => { identify({ ...connected(''), connected: false, configured: false }); return { ok: true }; });
  assert.equal((await client.disconnect()).configured, false);
});

test('a device account remains selected while Android has not exposed its calendars yet', async (t) => {
  const { client, identify, calls, handlers } = make(t);
  const waiting = { ...connected('device-account'), connected: false, code: 'sync_pending',
    error: 'Conta selecionada. O Android ainda não disponibilizou a agenda.' };
  identify(waiting);
  handlers.set('choose', () => waiting);
  assert.equal((await client.choose()).account, waiting.account);
  const data = await client.today();
  assert.equal(data.account, waiting.account);
  assert.equal(data.error, waiting.error);
  assert.equal(data.needsAuthorization, false);
  assert.deepEqual(data.events, []);
  assert.equal(calls.some((c) => c.operation === 'today'), false);
  identify(connected('device-account'));
  assert.equal((await client.today()).today.length, 1);
});

test('canceling the Android account chooser preserves the preceding account', async (t) => {
  const { client, handlers } = make(t);
  await client.state();
  handlers.set('choose', () => ({ ...connected(), cancelled: true }));
  assert.equal((await client.choose()).connectionId, 'account-a');
  assert.equal((await client.today()).account, 'account-a@example.test');
});

test('an overnight stale result derives today from the fourteen-day memory snapshot', async (t) => {
  const { client, handlers, packet, time } = make(t);
  const tomorrow = appointment('tomorrow', CURRENT + 86400000);
  handlers.set('today', () => ({ ...packet([appointment()]), events: [appointment(), tomorrow] }));
  await client.today();
  time(CURRENT + 86400000);
  handlers.set('today', () => ({ ok: false, error: 'Sem acesso ao provedor.' }));
  const data = await client.today();
  assert.deepEqual(data.today.map((e) => e.id), ['tomorrow']);
  assert.equal(data.stale, true);
});

test('all-day events stay in the agenda but never become meetings after a query failure', async (t) => {
  const { client, handlers, packet } = make(t);
  const birthday = { ...appointment('birthday'), allDay: true, people: 5 };
  handlers.set('today', () => packet([appointment(), birthday]));
  const fresh = await client.today();
  assert.deepEqual(fresh.today.map((e) => e.id), ['a']);
  assert.equal(fresh.events.find((e) => e.id === 'birthday').people, 5);
  handlers.set('today', () => ({ ok: false, error: 'Consulta falhou.' }));
  assert.deepEqual((await client.today()).today.map((e) => e.id), ['a']);
});

test('unknown credential-like fields never enter calendar snapshots', async (t) => {
  const { client, handlers, packet } = make(t);
  handlers.set('today', () => ({ ...packet(), accessToken: 'sensitive-not-to-be-stored', refreshToken: 'also-sensitive' }));
  const result = await client.today();
  assert.equal('accessToken' in result, false);
  assert.equal('refreshToken' in result, false);
  handlers.set('today', () => ({ ok: false, error: 'Consulta falhou.' }));
  assert.equal(JSON.stringify(await client.today()).includes('sensitive'), false);
});
