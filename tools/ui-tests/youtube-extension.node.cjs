const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const extension = path.resolve(__dirname, '../../extras/chrome-federano');

function contentFixture() {
  const events = new Map(), intervals = [], reports = [];
  let ad = false, pageId = 'abcdefghijk';
  const location = { hostname: 'www.youtube.com', pathname: '/watch', href: 'https://www.youtube.com/watch?v=abcdefghijk' };
  const video = {
    tagName: 'VIDEO', videoWidth: 1280, videoHeight: 720, readyState: 4,
    paused: false, ended: false, seeking: false, currentTime: 25.125, playbackRate: 1,
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 1280, bottom: 720, width: 1280, height: 720 }),
    pause() { this.paused = true; },
  };
  const document = {
    title: '(1) Artist - Song - YouTube', fullscreenElement: null,
    querySelectorAll: (selector) => selector === 'video' ? [video] : [],
    querySelector: (selector) => selector === 'ytd-watch-flexy[video-id]'
      ? { getAttribute: () => pageId } : ad ? {} : null,
    addEventListener: (name, callback) => events.set(name, callback),
  };
  const chrome = { runtime: { lastError: null, sendMessage: (message, reply) => reports.push({ message, reply }) } };
  vm.runInNewContext(fs.readFileSync(path.join(extension, 'content.js'), 'utf8'), {
    document, location, chrome, URL, innerWidth: 1280, innerHeight: 720,
    setInterval: (callback) => { intervals.push(callback); return intervals.length; },
  });
  return { video, location, reports, tick: intervals[0],
    event: (name) => events.get(name)({ target: video }),
    last: () => reports.at(-1).message,
    setAd: (value) => { ad = value; }, setPageId: (value) => { pageId = value; } };
}

test('the content report forwards speed and freezes immediately during buffering or seeking', () => {
  const f = contentFixture();
  f.video.playbackRate = 2;
  f.event('ratechange');
  assert.equal(f.last().rate, 2);
  assert.equal(f.last().advancing, true);
  assert.equal(f.last().t, 25.125);
  f.video.readyState = 1;
  f.event('waiting');
  assert.equal(f.last().playing, true);
  assert.equal(f.last().advancing, false);
  f.video.readyState = 4;
  f.tick();
  assert.equal(f.last().advancing, false); // Ready data alone has not resumed playback.
  f.event('playing');
  assert.equal(f.last().advancing, true);
  f.video.seeking = true;
  f.video.currentTime = 90.625;
  f.event('seeking');
  assert.equal(f.last().advancing, false);
  assert.equal(f.last().t, 90.625);
  f.video.seeking = false;
  f.event('seeked');
  assert.equal(f.last().advancing, true);
});

test('ads, ended playback and zero speed never advance the lyric clock', () => {
  const f = contentFixture();
  f.setAd(true); f.tick();
  assert.equal(f.last().ad, true);
  assert.equal(f.last().advancing, false);
  f.setAd(false); f.video.ended = true; f.event('ended');
  assert.equal(f.last().playing, false);
  assert.equal(f.last().advancing, false);
  f.video.ended = false; f.video.playbackRate = 0; f.event('ratechange');
  assert.equal(f.last().advancing, false);
});

test('a YouTube navigation cannot report the old player as the new video or apply its old reply', () => {
  const f = contentFixture();
  f.tick();
  const old = f.reports[0];
  f.location.href = 'https://www.youtube.com/watch?v=lmnopqrstuv';
  f.tick();
  assert.equal(f.reports.length, 1);
  old.reply({ pause: true });
  assert.equal(f.video.paused, false);
  f.setPageId('lmnopqrstuv');
  f.event('yt-navigate-finish');
  assert.equal(f.last().v, 'lmnopqrstuv');
});

test('a one-shot pause reply for the same video is not lost when the next report was already sent', () => {
  const f = contentFixture();
  f.tick(); f.tick();
  f.reports[0].reply({ pause: true });
  assert.equal(f.video.paused, true);
});

test('the background forwards optional clock metadata and remains compatible with old reports', async () => {
  let listener;
  const urls = [];
  const hook = { addListener() {} };
  const chrome = { runtime: { onMessage: { addListener: (callback) => { listener = callback; } }, onConnect: hook },
    action: { onClicked: hook }, offscreen: { hasDocument: async () => false } };
  vm.runInNewContext(fs.readFileSync(path.join(extension, 'background.js'), 'utf8'), {
    chrome, URLSearchParams, fetch: async (url) => { urls.push(url); return { ok: true, json: async () => ({}) }; },
  });
  const send = (message) => new Promise((resolve) => listener(message, { tab: { id: 7 } }, resolve));
  await send({ type: 'federano-video', v: 'abcdefghijk', t: 12.625, playing: true, rate: 0.5, advancing: false, ad: true });
  let q = new URL(urls[0]).searchParams;
  assert.equal(q.get('rate'), '0.5');
  assert.equal(q.get('advancing'), 'false');
  assert.equal(q.get('ad'), 'true');
  assert.equal(q.get('tab'), '7');
  await send({ type: 'federano-video', v: 'abcdefghijk', t: 12.625, playing: true });
  q = new URL(urls[1]).searchParams;
  for (const key of ['rate', 'advancing', 'ad']) assert.equal(q.has(key), false);
});
