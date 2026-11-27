// Calendar data stays in Android's Calendar Provider. This module never reads credentials,
// makes cloud requests, or writes appointments to WebView storage.
const MAX_REQUEST_ID = 2147483647;
const NORMAL_TIMEOUT = 15000;
const USER_TIMEOUT = 90000;
const EMPTY_STATE = Object.freeze({
  supported: false, configured: false, connected: false, permissionGranted: false,
  setupAttempted: false, account: '', connectionId: '',
});

export function createTabletCalendar(options = {}) {
  const win = options.window ?? globalThis.window;
  const setTimer = options.setTimeout ?? globalThis.setTimeout;
  const clearTimer = options.clearTimeout ?? globalThis.clearTimeout;
  const now = options.now ?? Date.now;
  const timeout = options.timeoutMs ?? NORMAL_TIMEOUT;
  const userTimeout = options.userTimeoutMs ?? USER_TIMEOUT;
  const pending = new Map(), listeners = new Set();
  let requestId = 0, stateVersion = 0, epoch = 0, disposed = false, stateFlight = null;
  let currentState = { ...EMPTY_STATE }, snapshot = null;

  const supported = () => !disposed && !!win?.__phoneboxKey && typeof win?.Android?.calendarRequest === 'function';
  const cleanText = (value, limit = 256) => typeof value === 'string' ? value.slice(0, limit) : '';
  const problem = (message, code = 'unavailable') => Object.assign(new Error(message), { code });
  const copyState = () => ({ ...currentState });
  const notify = (type) => {
    const event = { type, state: copyState() };
    for (const listener of [...listeners]) {
      try { listener(event); } catch { /* One widget must not prevent others from refreshing. */ }
    }
  };
  const invalidate = () => { snapshot = null; epoch++; };
  const changedError = () => problem('A agenda mudou. Atualize para consultar a conta selecionada.', 'changed');
  const invalidError = () => problem('Não foi possível ler a resposta da agenda do tablet.', 'invalid_response');
  const messageOf = (error) => cleanText(error?.message, 512) || 'Não foi possível consultar a agenda do tablet.';

  function normalizeState(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalidError();
    const state = {
      supported: raw.supported === true,
      configured: raw.configured === true,
      connected: false,
      permissionGranted: raw.permissionGranted === true,
      setupAttempted: raw.setupAttempted === true,
      account: cleanText(raw.account),
      connectionId: cleanText(raw.connectionId),
    };
    state.connected = state.supported && state.configured && state.permissionGranted &&
      raw.connected === true && !!state.connectionId;
    if (raw.error) { state.error = cleanText(raw.error, 512); state.code = cleanText(raw.code, 64); }
    return state;
  }

  function applyState(next) {
    if (next.connectionId !== currentState.connectionId || next.connected !== currentState.connected ||
        next.configured !== currentState.configured || next.permissionGranted !== currentState.permissionGranted) invalidate();
    currentState = next;
    return copyState();
  }

  function request(operation, payload = {}, wait = timeout) {
    if (!supported()) return Promise.reject(problem('A agenda do tablet está disponível somente no aplicativo Android.', 'unsupported'));
    // Positive Int IDs also work with JavascriptInterface methods declared with Kotlin Int.
    do { requestId = requestId >= MAX_REQUEST_ID ? 1 : requestId + 1; } while (pending.has(requestId));
    const id = requestId;
    return new Promise((resolve, reject) => {
      const timer = setTimer(() => {
        pending.delete(id);
        reject(problem('A consulta à agenda do tablet demorou demais. Tente novamente.', 'timeout'));
      }, wait);
      pending.set(id, { resolve, reject, timer });
      try {
        win.Android.calendarRequest(win.__phoneboxKey, id, operation, JSON.stringify(payload));
      } catch {
        pending.delete(id); clearTimer(timer);
        reject(problem('Não foi possível acessar a agenda do tablet.', 'bridge_error'));
      }
    });
  }

  const previousResult = win?.onFederanoCalendarResult;
  const previousChanged = win?.onFederanoCalendarChanged;
  function onResult(id, json) {
    const item = pending.get(id);
    if (!item) return; // Expired and duplicate callbacks cannot complete a different request.
    pending.delete(id); clearTimer(item.timer);
    let result;
    try { result = typeof json === 'string' ? JSON.parse(json) : json; } catch { item.reject(invalidError()); return; }
    if (!result || typeof result !== 'object' || Array.isArray(result)) { item.reject(invalidError()); return; }
    const waitingForSync = result.supported === true && result.configured === true && result.permissionGranted === true &&
      !!result.connectionId && ['sync_pending', 'sync_disabled'].includes(result.code);
    if (result.ok === false || (result.error && !Array.isArray(result.today) && !waitingForSync)) {
      item.reject(problem(cleanText(result.error, 512) || 'Não foi possível consultar a agenda do tablet.', cleanText(result.code, 64) || 'unavailable'));
    } else item.resolve(result);
  }
  function onChanged() {
    invalidate();
    notify('changed');
    if (typeof previousChanged === 'function') {
      try { previousChanged(); } catch { /* Preserve an existing observer without breaking this one. */ }
    }
  }
  if (win) {
    win.onFederanoCalendarResult = onResult;
    win.onFederanoCalendarChanged = onChanged;
  }

  function state() {
    if (!supported()) return Promise.resolve(applyState({ ...EMPTY_STATE }));
    // The calendar widget and meeting widget may ask concurrently.
    if (stateFlight?.epoch === epoch) return stateFlight.promise;
    const flight = { version: ++stateVersion, epoch, promise: null };
    flight.promise = (async () => {
      try {
        const result = normalizeState(await request('state'));
        if (flight.version !== stateVersion || flight.epoch !== epoch) throw changedError();
        return applyState(result);
      } finally {
        if (stateFlight === flight) stateFlight = null;
      }
    })();
    stateFlight = flight;
    return flight.promise;
  }

  const timestamp = (value) => {
    const ms = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN;
    return Number.isFinite(ms) && ms >= 0 ? ms : null;
  };
  function normalizeEvents(events) {
    if (!Array.isArray(events)) throw invalidError();
    return events.slice(0, 5000).flatMap((event) => {
      if (!event || typeof event !== 'object') return [];
      const start = timestamp(event.start), end = timestamp(event.end);
      if (start == null || end == null || end < start) return [];
      const meet = cleanText(event.meet, 2048);
      const count = Number.isFinite(event.people) ? event.people : event.attendees;
      const people = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
      return [{
        id: cleanText(event.id), title: cleanText(event.title, 2048) || 'Compromisso', start, end,
        allDay: event.allDay === true, calendar: cleanText(event.calendar), color: cleanText(event.color, 32),
        meet: /^https:\/\//i.test(meet) ? meet : '', location: cleanText(event.location, 2048),
        people, attendees: people,
      }];
    });
  }
  function empty(error = '', stale = false) {
    return {
      today: [], events: [], calendars: false, source: 'tablet', updatedAt: null,
      account: currentState.account, connectionId: currentState.connectionId,
      stale, error, needsAuthorization: !currentState.connected && !['sync_pending', 'sync_disabled'].includes(currentState.code),
    };
  }
  function cloneData(data) {
    return { ...data, today: data.today.map((e) => ({ ...e })), events: data.events.map((e) => ({ ...e })) };
  }
  function staleData(error) {
    if (!snapshot || snapshot.connectionId !== currentState.connectionId || !currentState.connected) return empty(messageOf(error), true);
    const data = cloneData(snapshot);
    // A tablet left open overnight must not present yesterday's appointments as today's.
    const day = new Date(now()), next = new Date(now());
    day.setHours(0, 0, 0, 0); next.setHours(24, 0, 0, 0);
    data.today = data.events.filter((e) => !e.allDay && e.end > +day && e.start < +next);
    return { ...data, stale: true, error: messageOf(error) };
  }

  async function today() {
    let selected;
    try { selected = await state(); } catch (error) {
      // A failed permission/identity check never authorizes reuse of appointments.
      return empty(messageOf(error), true);
    }
    if (!selected.supported || !selected.configured) return null;
    if (!selected.connected) return empty(selected.error || 'Autorize o acesso à agenda e selecione uma conta no tablet.');
    const started = epoch;
    try {
      const raw = await request('today');
      if (started !== epoch) return empty(messageOf(changedError()), true);
      if (raw.connectionId !== selected.connectionId) {
        invalidate();
        return empty(messageOf(changedError()), true);
      }
      const data = {
        today: normalizeEvents(raw.today).filter((e) => !e.allDay), events: normalizeEvents(raw.events),
        calendars: raw.calendars === true, source: 'tablet', updatedAt: timestamp(raw.updatedAt) ?? now(),
        account: selected.account, connectionId: selected.connectionId,
        stale: raw.stale === true, error: cleanText(raw.error, 512), needsAuthorization: false,
      };
      snapshot = cloneData(data);
      return data;
    } catch (error) {
      if (started !== epoch) return empty(messageOf(changedError()), true);
      if (['permission_denied', 'account_missing', 'not_connected', 'not_configured'].includes(error?.code)) {
        invalidate();
        currentState = { ...currentState, connected: false,
          permissionGranted: error.code === 'permission_denied' ? false : currentState.permissionGranted };
        return empty(messageOf(error));
      }
      return staleData(error);
    }
  }

  async function action(operation) {
    invalidate();
    try { await request(operation, {}, userTimeout); }
    finally { notify('changed'); }
    return state();
  }

  return {
    supported, state, today,
    connect: () => action('connect'),
    choose: () => action('choose'),
    disconnect: () => action('disconnect'),
    refresh: () => { invalidate(); return today(); },
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('O observador da agenda deve ser uma função.');
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      disposed = true; invalidate(); listeners.clear();
      for (const item of pending.values()) { clearTimer(item.timer); item.reject(problem('A consulta à agenda foi encerrada.', 'disposed')); }
      pending.clear();
      if (win?.onFederanoCalendarResult === onResult) win.onFederanoCalendarResult = previousResult;
      if (win?.onFederanoCalendarChanged === onChanged) win.onFederanoCalendarChanged = previousChanged;
    },
  };
}

export const tabletCalendar = createTabletCalendar();
