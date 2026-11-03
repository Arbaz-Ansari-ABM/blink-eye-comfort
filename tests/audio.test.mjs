import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioManager } from '../src/audio/AudioManager.js';
import { BUILT_IN_RINGTONES, encodeWav, renderTone, TONE_SAMPLE_RATE } from '../src/audio/tones.js';
import { validateAudioFile, MAX_CUSTOM_BYTES } from '../src/audio/soundStore.js';

// ---------- mock Web Audio ----------
function makeWin({ resumeWorks = true, htmlPlays = true, fileSeconds = 11 } = {}) {
  const log = [];
  let clock = 0;
  class Param { constructor() { this.value = 1; } setValueAtTime() {} linearRampToValueAtTime() {} cancelScheduledValues() {} }
  class Ctx {
    constructor() { this.state = 'suspended'; this.sampleRate = 44100; this.destination = {}; }
    get currentTime() { return clock; }
    createGain() { return { gain: new Param(), connect() {}, disconnect() {} }; }
    createBuffer(ch, len, sr) { return { duration: len / sr, copyToChannel() {} }; }
    createBufferSource() {
      const src = { loop: false, buffer: null, connect() {}, disconnect() {}, started: null, stopped: null, offset: 0,
        start(t, o = 0) { src.started = t; src.offset = o; log.push({ ev: 'start', src, at: clock }); },
        stop(t) { if (src.stopped === null) src.stopped = t; src.stopCalls.push(t); log.push({ ev: 'stop', src, at: clock }); }, stopCalls: [] };
      return src;
    }
    decodeAudioData(ab, ok) { const b = { duration: fileSeconds, copyToChannel() {} }; ok(b); return Promise.resolve(b); }
    resume() { if (resumeWorks) { this.state = 'running'; return Promise.resolve(); } return new Promise(() => {}); }
    close() { return Promise.resolve(); }
  }
  const listeners = {};
  const win = {
    AudioContext: Ctx,
    document: { addEventListener: (t, f) => { listeners[t] = f; }, removeEventListener() {}, visibilityState: 'visible' },
    fetch: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }),
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    Blob: class { constructor(p) { this.parts = p; } arrayBuffer() { return Promise.resolve(new ArrayBuffer(8)); } },
    Audio: class {
      constructor() { this.listeners = {}; } addEventListener() {} removeEventListener() {}
      play() { return htmlPlays ? Promise.resolve() : Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' })); }
      pause() {} removeAttribute() {} load() {}
    },
  };
  return { win, log, listeners, advance: (s) => { clock += s; }, getClock: () => clock };
}

// Ignore the 1-sample silent buffer used internally to unlock audio.
const sources = (log) => log.filter((e) => e.ev === 'start').map((e) => e.src).filter((src) => src.buffer.duration > 0.01);

// ---------- tones ----------
test('built-in ringtones are real audio, loop seamlessly, and encode to valid WAV', () => {
  assert.equal(BUILT_IN_RINGTONES.length, 6);
  assert.deepEqual(BUILT_IN_RINGTONES.map((r) => r.name), ['Gentle Chime', 'Soft Bell', 'Digital Pulse', 'Wind Chimes', 'Music Box', 'Calm Marimba']);
  for (const tone of BUILT_IN_RINGTONES) {
    const data = renderTone(tone.id);
    assert.equal(data.length, tone.loopSeconds * TONE_SAMPLE_RATE, `${tone.id} loop length`);
    let peak = 0; let energy = 0;
    for (const v of data) { peak = Math.max(peak, Math.abs(v)); energy += v * v; }
    assert.ok(peak > 0.3 && peak <= 0.75, `${tone.id} peak ${peak}`);
    assert.ok(energy / data.length > 1e-4, `${tone.id} is not silent`);
    // Seamless loop: the jump from the last sample back to the first must be tiny (no click).
    const seam = Math.abs(data[data.length - 1] - data[0]);
    assert.ok(seam < 0.05, `${tone.id} loop seam ${seam}`);
    const wav = new DataView(encodeWav(data));
    assert.equal(String.fromCharCode(wav.getUint8(0), wav.getUint8(1), wav.getUint8(2), wav.getUint8(3)), 'RIFF');
    assert.equal(wav.getUint32(40, true), data.length * 2);
  }
});

// ---------- 20 second rule ----------
test('short built-in tone loops and is cut at exactly 20 s (partial last loop)', async () => {
  const { win, log } = makeWin();
  const audio = new AudioManager({ win });
  assert.equal(await audio.playRingtone({ key: 1 }), true);
  const [src] = sources(log);
  assert.equal(src.loop, true);
  assert.ok(Math.abs((src.stopped - src.started) - 20) < 1e-9, `duration ${src.stopped - src.started}`);
  assert.ok(src.buffer.duration < 20); // 4 s loop => 5 loops, no pitch change / stretch
  audio.dispose();
});

test('every built-in ringtone (all 6) plays for exactly 20 s', async () => {
  for (const tone of BUILT_IN_RINGTONES) {
    const { win, log } = makeWin();
    const audio = new AudioManager({ win });
    audio.setSettings({ ringtoneId: tone.id });
    await audio.previewRingtone(tone.id);
    const [src] = sources(log);
    assert.ok(Math.abs((src.stopped - src.started) - 20) < 1e-9, tone.id);
    audio.dispose();
  }
});

test('long custom file (30 s) is stopped at 20 s; exact 20 s plays once through', async () => {
  for (const seconds of [30, 20]) {
    const { win, log } = makeWin({ fileSeconds: seconds });
    const audio = new AudioManager({ win });
    audio.setCustomRingtone(new win.Blob(['x']));
    audio.setSettings({ ringtoneId: 'custom' });
    await audio.playRingtone({ key: seconds });
    const [src] = sources(log);
    assert.equal(src.buffer.duration, seconds);
    assert.ok(Math.abs((src.stopped - src.started) - 20) < 1e-9, `${seconds}s file`);
    audio.dispose();
  }
});

test('rest ringtone loops for the remaining rest time and resumes at the right offset', async () => {
  const { win, log } = makeWin();
  const audio = new AudioManager({ win });
  audio.setSettings({ ringtoneId: 'soft-bell' });
  await audio.startRestTune({ totalSec: 20, elapsedSec: 0 });
  await audio.startRestTune({ totalSec: 20, elapsedSec: 13 }); // resume after pause at 13 s
  const [first, second] = sources(log);
  assert.equal(first.loop, true);
  assert.ok(Math.abs((first.stopped - first.started) - 20) < 1e-9);
  assert.ok(Math.abs((second.stopped - second.started) - 7) < 1e-9);
  assert.ok(Math.abs(second.offset - (13 % second.buffer.duration)) < 1e-9);
  audio.dispose();
});

test('nothing plays after the rest ends: stopRestTune silences it and no ringtone follows', async () => {
  const { win, log } = makeWin();
  const audio = new AudioManager({ win });
  await audio.startRestTune({ totalSec: 20 });
  assert.equal(audio.getSnapshot().restPlaying, true);
  audio.stopRestTune();
  assert.equal(audio.getSnapshot().restPlaying, false);
  assert.equal(sources(log).length, 1);
  audio.dispose();
});

// ---------- no overlap / stop / duplicates ----------
test('only one sound at a time: starting a preview stops the rest ringtone', async () => {
  const { win } = makeWin();
  const audio = new AudioManager({ win });
  await audio.startRestTune({ totalSec: 20 });
  await audio.previewRingtone('wind-chimes');
  assert.equal(audio.getSnapshot().restPlaying, false);
  assert.equal(audio.getSnapshot().previewId, 'wind-chimes');
  audio.dispose();
});

test('stop is immediate, also while a start is still loading', async () => {
  const { win, log } = makeWin();
  const audio = new AudioManager({ win });
  await audio.playRingtone({ key: 1 });
  audio.stopRingtone();
  assert.equal(audio.getSnapshot().ringing, false);
  assert.ok(log.some((e) => e.ev === 'stop'));
  // stop while loading: must not start afterwards
  const before = sources(log).length;
  const pending = audio.playRingtone({ key: 2 });
  audio.stopRingtone();
  assert.equal(await pending, false);
  assert.equal(sources(log).length, before);
  audio.dispose();
});

test('duplicate completion events are ignored', async () => {
  const { win, log } = makeWin();
  const audio = new AudioManager({ win });
  await audio.playRingtone({ key: 'same' });
  await audio.playRingtone({ key: 'same' });
  assert.equal(sources(log).length, 1);
  audio.dispose();
});

test('sound OFF mutes timer sounds but previews still work', async () => {
  const { win, log } = makeWin();
  const audio = new AudioManager({ win });
  audio.setSettings({ enabled: false });
  assert.equal(await audio.playRingtone({ key: 1 }), false);
  assert.equal(await audio.startRestTune({ totalSec: 20 }), false);
  assert.equal(sources(log).length, 0);
  assert.equal(await audio.previewRingtone('gentle-chime'), true);
  audio.dispose();
});

// ---------- autoplay / WebView failure handling ----------
test('blocked audio is remembered and resumed on the next tap', async () => {
  const env = makeWin({ resumeWorks: false, htmlPlays: false });
  const audio = new AudioManager({ win: env.win });
  const errors = []; const origError = console.error; const origWarn = console.warn;
  console.error = (...a) => errors.push(a.join(' ')); console.warn = () => {};
  const started = await audio.playRingtone({ key: 1 });
  assert.equal(started, false);
  assert.equal(audio.getSnapshot().blocked, true);
  assert.ok(errors.some((e) => e.includes('blocked')), 'a useful console error is logged');
  // The user taps: context can now resume.
  env.win.AudioContext.prototype.resume = function resume() { this.state = 'running'; return Promise.resolve(); };
  await audio.unlock();
  await new Promise((r) => setTimeout(r, 20));
  console.error = origError; console.warn = origWarn;
  assert.equal(audio.getSnapshot().blocked, false);
  assert.equal(sources(env.log).length, 1);
  audio.dispose();
});

test('falls back to HTMLAudio when the Web Audio context cannot resume', async () => {
  const env = makeWin({ resumeWorks: false, htmlPlays: true });
  const audio = new AudioManager({ win: env.win });
  const origWarn = console.warn; console.warn = () => {};
  assert.equal(await audio.playRingtone({ key: 1 }), true);
  console.warn = origWarn;
  assert.equal(audio.getSnapshot().engine, 'html');
  audio.stopAll();
  audio.dispose();
});

// ---------- file validation ----------
test('custom ringtone validation', () => {
  const f = (name, type, size = 1000) => ({ name, type, size });
  for (const [name, type] of [['a.mp3', 'audio/mpeg'], ['a.wav', 'audio/wav'], ['a.aac', 'audio/aac'], ['a.m4a', 'audio/mp4'], ['a.ogg', 'audio/ogg'], ['a.mp3', ''], ['A.M4A', 'application/octet-stream']]) {
    assert.equal(validateAudioFile(f(name, type)).ok, true, `${name} ${type}`);
  }
  assert.equal(validateAudioFile(f('a.exe', 'application/x-msdownload')).ok, false);
  assert.equal(validateAudioFile(f('a.png', 'image/png')).ok, false);
  assert.equal(validateAudioFile(f('a.mp3', 'image/png')).ok, false);
  assert.equal(validateAudioFile(f('a.flac', 'audio/flac')).ok, false);
  assert.equal(validateAudioFile(f('a.mp3', 'audio/mpeg', 0)).ok, false);
  assert.equal(validateAudioFile(f('a.mp3', 'audio/mpeg', MAX_CUSTOM_BYTES + 1)).ok, false);
  assert.equal(validateAudioFile(null).ok, false);
});
