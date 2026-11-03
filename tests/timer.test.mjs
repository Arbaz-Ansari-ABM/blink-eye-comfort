import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/', pretendToBeVisual: true });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });

const React = (await import('react')).default;
const { createRoot } = await import('react-dom/client');
const { act } = await import('react');
const { useRestTimer, FOCUS_SECONDS, REST_SECONDS } = await import('../src/audio/useRestTimer.js');

const realNow = Date.now;
let offset = 0;
Date.now = () => realNow() + offset;
const jump = (seconds) => { offset += seconds * 1000; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function setup() {
  window.localStorage.clear();
  const calls = [];
  const audio = {
    unlock: () => calls.push('unlock'), stopAll: () => calls.push('stopAll'), stopRingtone: () => calls.push('stopRingtone'),
    stopRestTune: () => calls.push('stopRestTune'),
    startRestTune: (o) => calls.push(`startRestTune:${o.totalSec}:${o.elapsedSec}`),
    playRingtone: (o) => calls.push(`playRingtone:${o.maxSec}:${o.key}`),
  };
  const events = [];
  let api;
  function Probe() { api = useRestTimer({ audio, onEvent: (e) => events.push(e) }); return null; }
  const root = createRoot(document.getElementById('root'));
  act(() => root.render(React.createElement(Probe)));
  return { calls, events, get: () => api, root };
}
const tick = async () => { await act(async () => { await wait(320); }); };

test('focus -> rest (ringtone starts) -> rest ends (ringtone stops), once each, nothing rings after', async () => {
  const t = setup();
  act(() => t.get().start());
  assert.equal(t.get().phase, 'focus');
  assert.ok(t.calls.includes('unlock'));

  jump(FOCUS_SECONDS + 1); await tick();
  assert.equal(t.get().phase, 'rest');
  assert.equal(t.calls.filter((c) => c.startsWith('startRestTune')).length, 1);
  assert.ok(t.calls.includes(`startRestTune:${REST_SECONDS}:0`));

  jump(REST_SECONDS + 1); await tick(); await tick(); await tick();
  assert.equal(t.get().phase, 'focus');
  assert.equal(t.get().completed, 1);
  assert.equal(t.calls.filter((c) => c === 'stopRestTune').length, 1, 'rest ringtone stopped exactly once');
  assert.equal(t.calls.filter((c) => c.startsWith('playRingtone')).length, 0, 'no ringtone after the rest');
  assert.deepEqual(t.events.filter((e) => e.endsWith('complete')), ['focus-complete', 'rest-complete']);
  act(() => t.root.unmount());
});

test('pause during rest keeps the rest, resume continues it and resumes the tune at the right offset', async () => {
  const t = setup();
  act(() => t.get().start());
  jump(FOCUS_SECONDS + 1); await tick();
  assert.equal(t.get().phase, 'rest');
  jump(8); await tick();
  act(() => t.get().pause());
  assert.equal(t.get().phase, 'paused');
  assert.equal(t.get().pausedFrom, 'rest');
  const left = t.get().secondsLeft;
  assert.ok(left >= 11 && left <= 13, `left ${left}`);
  jump(60); await tick();               // time passing while paused must not change anything
  assert.equal(t.get().secondsLeft, left);
  act(() => t.get().start());
  assert.equal(t.get().phase, 'rest');  // resumes the REST, not a focus session
  const resumeCall = t.calls.filter((c) => c.startsWith('startRestTune')).pop();
  assert.ok(/startRestTune:20:(7|8|9)$/.test(resumeCall), resumeCall);
  jump(left + 1); await tick(); await tick();
  assert.equal(t.get().phase, 'focus');
  assert.equal(t.calls.filter((c) => c.startsWith('playRingtone')).length, 0);
  act(() => t.root.unmount());
});

test('reset stops all sound and returns to a fresh focus timer', async () => {
  const t = setup();
  act(() => t.get().start());
  jump(30); await tick();
  act(() => t.get().reset());
  assert.equal(t.get().phase, 'stopped');
  assert.equal(t.get().secondsLeft, FOCUS_SECONDS);
  assert.ok(t.calls.includes('stopAll'));
  act(() => t.root.unmount());
});

test('a long background gap does not drift: remaining time comes from timestamps', async () => {
  const t = setup();
  act(() => t.get().start());
  jump(600); await tick();               // 10 minutes pass with no ticks in between
  assert.ok(Math.abs(t.get().secondsLeft - (FOCUS_SECONDS - 600)) <= 1);
  act(() => t.root.unmount());
});
