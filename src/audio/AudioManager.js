// Central audio manager for Blink.
//
// One instance owns ALL sound in the app. Only one sound can play at a time
// (rest tune, completion ringtone or a settings preview), so nothing overlaps.
//
// Playback strategy (important for Android WebView / AppGeyser):
//   1. Web Audio API   – AudioBufferSourceNode with loop=true and a sample-accurate stop().
//                        This gives gap-free looping and an exact 20 s cut-off.
//   2. HTMLAudioElement – fallback when Web Audio is missing, the context cannot be resumed,
//                        or a file cannot be decoded. Uses loop=true + a timer deadline.
//   3. "Blocked" state – if both fail (autoplay policy), playback is remembered and resumed
//                        on the very next tap, if its time window has not passed yet.
//
// Every failure is logged with console.error so it is visible in chrome://inspect.

import { BUILT_IN_RINGTONES, RINGTONE_SECONDS } from './ringtoneCatalog.js';

export { BUILT_IN_RINGTONES, RINGTONE_SECONDS };
export const CUSTOM_RINGTONE_ID = 'custom';

const LOG = '[Blink audio]';
const CHANNEL_NAMES = ['rest', 'ringtone', 'preview'];
const RESUME_TIMEOUT_MS = 700;
const FADE_OUT_SECONDS = 0.015;

const clamp01 = (value) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
function createSilentWav(sampleCount = 441) {
  const buffer = new ArrayBuffer(44 + sampleCount * 2);
  const view = new DataView(buffer);
  const write = (offset, text) => {
    for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
  };
  write(0, 'RIFF');
  view.setUint32(4, 36 + sampleCount * 2, true);
  write(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 44100, true);
  view.setUint32(28, 88200, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, sampleCount * 2, true);
  return buffer;
}
const withTimeout = (promise, ms) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
});

export class AudioManager {
  constructor({ win } = {}) {
    this.win = win || (typeof window !== 'undefined' ? window : null);
    this.ctx = null;
    this.master = null;
    this.settings = { enabled: true, volume: 0.8, ringtoneId: 'gentle-chime' };
    this.customBlob = null;
    this.customUrl = null;
    this.buffers = new Map();     // cache key -> AudioBuffer
    this.rawBytes = new Map();    // url -> Promise<ArrayBuffer> (prefetched, needs no context)
    this.wavUrls = new Map();     // built-in id -> blob: URL for the HTMLAudio fallback
    this.channels = {};           // channel -> active playback
    this.token = 0;               // bumped on every start/stop; stale async work aborts
    this.pending = null;          // playback blocked by autoplay policy, retried on next tap
    this.loading = null;          // { channel, token } of a start() that is still loading/resuming
    this.lastRingKey = null;
    this.listeners = new Set();
    this.disposed = false;
    this.lastEngine = 'none';
    this.lastError = '';
    this.silentUrl = null;
    this.snapshot = this._buildSnapshot();
    this._onGesture = this._onGesture.bind(this);
    this._onVisibility = this._onVisibility.bind(this);
    this._installListeners();
  }

  // ---------- subscription (useSyncExternalStore friendly) ----------
  subscribe = (listener) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  getSnapshot = () => this.snapshot;

  _emit() {
    this.snapshot = this._buildSnapshot();
    this.listeners.forEach((listener) => { try { listener(); } catch (error) { console.error(LOG, 'listener failed', error); } });
  }

  _buildSnapshot() {
    const { rest, ringtone, preview } = this.channels;
    return {
      ctxState: this.ctx ? this.ctx.state : 'none',
      engine: this.lastEngine,
      blocked: !!this.pending,
      restPlaying: !!rest,
      ringing: !!ringtone,
      ringtoneEndsAt: ringtone ? ringtone.endsAtWall : 0,
      previewId: preview ? preview.id : null,
      previewEndsAt: preview ? preview.endsAtWall : 0,
      lastError: this.lastError,
    };
  }

  _fail(message, error) {
    this.lastError = `${message}${error && error.message ? `: ${error.message}` : ''}`;
    console.error(LOG, message, error || '');
  }

  // ---------- unlock / lifecycle ----------
  _installListeners() {
    const doc = this.win && this.win.document;
    if (!doc) return;
    // Kept for the lifetime of the app on purpose: Android can suspend the context again
    // (call, notification, app switch) and the next tap must be able to wake it.
    ['pointerdown', 'touchend', 'click', 'keydown'].forEach((type) => doc.addEventListener(type, this._onGesture, { capture: true, passive: true }));
    doc.addEventListener('visibilitychange', this._onVisibility);
  }

  _onGesture() {
    if (this.disposed) return;
    const needsWork = !this.ctx || this.ctx.state !== 'running' || this.pending;
    if (needsWork) this.unlock();
  }

  _onVisibility() {
    const doc = this.win && this.win.document;
    if (!doc || doc.visibilityState !== 'visible' || !this.ctx) return;
    if (this.ctx.state !== 'running') this._ensureRunning().then(() => this._retryPending());
  }

  _ensureContext() {
    if (this.ctx) return this.ctx;
    const Ctor = this.win && (this.win.AudioContext || this.win.webkitAudioContext);
    if (!Ctor) { this._fail('Web Audio API is not available'); return null; }
    try {
      this.ctx = new Ctor({ latencyHint: 'interactive' });
      this.master = this.ctx.createGain();
      this.master.gain.value = this.settings.volume;
      this.master.connect(this.ctx.destination);
      this.ctx.onstatechange = () => {
        this._emit();
        // If the OS suspends us mid-sound, try to wake up again (works if a gesture is active).
        if (this.ctx.state !== 'running' && (this.channels.rest || this.channels.ringtone)) this._ensureRunning();
      };
    } catch (error) {
      this._fail('Could not create AudioContext', error);
      this.ctx = null;
    }
    return this.ctx;
  }

  async _ensureRunning() {
    const ctx = this._ensureContext();
    if (!ctx) return false;
    if (ctx.state === 'running') return true;
    try {
      // resume() can stay pending forever without a user gesture, so never await it unbounded.
      await withTimeout(Promise.resolve(ctx.resume()), RESUME_TIMEOUT_MS);
    } catch (error) {
      console.warn(LOG, 'AudioContext.resume() did not complete', error.message);
    }
    this._emit();
    return ctx.state === 'running';
  }

  /** Call from a user gesture. Resumes Web Audio, primes HTMLAudio, retries blocked sound. */
  unlock() {
    const ctx = this._ensureContext();
    if (ctx) {
      // Synchronous part: must run inside the gesture handler.
      try { ctx.resume(); } catch (error) { console.warn(LOG, 'resume threw', error); }
      try {
        const silent = ctx.createBuffer(1, 1, ctx.sampleRate || 44100);
        const source = ctx.createBufferSource();
        source.buffer = silent;
        source.connect(ctx.destination);
        source.start(0);
      } catch (error) { console.warn(LOG, 'silent unlock buffer failed', error); }
    }
    this._primeHtmlAudio();
    return this._ensureRunning().then((running) => {
      this._emit();
      if (running) this._retryPending();
      return running;
    });
  }

  _primeHtmlAudio() {
    const AudioCtor = this.win && this.win.Audio;
    if (!AudioCtor || this.htmlPrimed) return;
    try {
      if (!this.silentUrl) this.silentUrl = this._blobUrl(createSilentWav(), 'audio/wav');
      const audio = new AudioCtor(this.silentUrl);
      audio.volume = 0;
      const played = audio.play();
      if (played && played.then) played.then(() => { audio.pause(); this.htmlPrimed = true; }).catch(() => {});
    } catch (error) { console.warn(LOG, 'HTMLAudio prime failed', error); }
  }

  _blobUrl(data, type) {
    return this.win.URL.createObjectURL(new this.win.Blob([data], { type }));
  }

  // ---------- settings ----------
  setSettings(patch) {
    const previous = this.settings;
    this.settings = { ...previous, ...patch };
    this.settings.volume = clamp01(this.settings.volume);
    if (this.master) this.master.gain.value = this.settings.volume;
    Object.values(this.channels).forEach((active) => active.setVolume && active.setVolume(this.settings.volume));
    if (previous.enabled && !this.settings.enabled) { this.stopRestTune(); this.stopRingtone(); }
    if (previous.ringtoneId !== this.settings.ringtoneId) this.preload();
  }

  setCustomRingtone(blob) {
    if (this.channels.preview && this.channels.preview.id === CUSTOM_RINGTONE_ID) this.stopPreview();
    if (this.settings.ringtoneId === CUSTOM_RINGTONE_ID) this.stopRingtone();
    if (this.customUrl) this.win.URL.revokeObjectURL(this.customUrl);
    this.buffers.delete(CUSTOM_RINGTONE_ID);
    this.customBlob = blob || null;
    this.customUrl = blob ? this.win.URL.createObjectURL(blob) : null;
  }

  hasCustomRingtone() { return !!this.customBlob; }

  /** Checks that this device can really play a file. Resolves { ok, duration?, reason? }. */
  async probe(blob) {
    const ctx = this._ensureContext();
    if (ctx) {
      try {
        const buffer = await this._decode(await this._readBlob(blob));
        return { ok: true, duration: buffer.duration };
      } catch (error) {
        console.warn(LOG, 'Web Audio could not decode the file, trying <audio>:', error && error.message);
      }
    }
    const AudioCtor = this.win && this.win.Audio;
    if (!AudioCtor) return { ok: false, reason: 'This device cannot play audio files.' };
    const url = this.win.URL.createObjectURL(blob);
    try {
      return await new Promise((resolve) => {
        const audio = new AudioCtor();
        const timer = setTimeout(() => resolve({ ok: false, reason: 'The file took too long to load.' }), 5000);
        audio.preload = 'metadata';
        audio.onloadedmetadata = () => { clearTimeout(timer); resolve({ ok: true, duration: audio.duration }); };
        audio.onerror = () => { clearTimeout(timer); resolve({ ok: false, reason: 'This device cannot play that audio format.' }); };
        audio.src = url;
      });
    } finally {
      this.win.URL.revokeObjectURL(url);
    }
  }

  // ---------- preloading ----------
  /** Decodes the selected ringtone ahead of time (once a context exists) so rest starts instantly. */
  preload() {
    if (this.ctx) this._getBuffer(this._ringtoneDesc(this.settings.ringtoneId)).catch(() => {});
  }

  _fetchBytes(url) {
    if (!this.rawBytes.has(url)) {
      const request = this.win.fetch(url).then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
        return response.arrayBuffer();
      });
      request.catch(() => this.rawBytes.delete(url));
      this.rawBytes.set(url, request);
    }
    return this.rawBytes.get(url);
  }

  async _decode(arrayBuffer) {
    const ctx = this.ctx;
    // Callback form first-class: older Android WebViews do not return a promise.
    return new Promise((resolve, reject) => {
      const maybe = ctx.decodeAudioData(arrayBuffer.slice(0), resolve, reject);
      if (maybe && maybe.then) maybe.then(resolve, reject);
    });
  }

  async _getBuffer(desc) {
    const ctx = this._ensureContext();
    if (!ctx) throw new Error('no AudioContext');
    if (this.buffers.has(desc.key)) return this.buffers.get(desc.key);
    let buffer;
    if (desc.tone) {
      const { TONE_SAMPLE_RATE, renderTone } = await import('./tones.js');
      const samples = renderTone(desc.tone, TONE_SAMPLE_RATE);
      buffer = ctx.createBuffer(1, samples.length, TONE_SAMPLE_RATE);
      buffer.copyToChannel(samples, 0);
    } else if (desc.blob) {
      buffer = await this._decode(await this._readBlob(desc.blob));
    } else {
      buffer = await this._decode(await this._fetchBytes(desc.url));
    }
    this.buffers.set(desc.key, buffer);
    return buffer;
  }

  _readBlob(blob) {
    if (blob.arrayBuffer) return blob.arrayBuffer();
    return new Promise((resolve, reject) => {
      const reader = new this.win.FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(blob);
    });
  }

  async _htmlUrlFor(desc) {
    if (desc.tone) {
      if (!this.wavUrls.has(desc.tone)) {
        const { encodeWav, renderTone } = await import('./tones.js');
        this.wavUrls.set(desc.tone, this._blobUrl(encodeWav(renderTone(desc.tone)), 'audio/wav'));
      }
      return this.wavUrls.get(desc.tone);
    }
    if (desc.blob) return this.customUrl;
    return desc.url;
  }

  // ---------- descriptors ----------
  _ringtoneDesc(id) {
    if (id === CUSTOM_RINGTONE_ID) {
      if (this.customBlob) return { key: CUSTOM_RINGTONE_ID, blob: this.customBlob, id };
      console.warn(LOG, 'Custom ringtone selected but none is stored; using Gentle Chime');
      return { key: 'gentle-chime', tone: 'gentle-chime', id: 'gentle-chime' };
    }
    if (BUILT_IN_RINGTONES.some((tone) => tone.id === id)) return { key: id, tone: id, id };
    return { key: 'gentle-chime', tone: 'gentle-chime', id: 'gentle-chime' };
  }

  // ---------- public playback API ----------
  /**
   * Plays the selected ringtone ONLY for the rest period: loops it until the rest ends (exactly
   * totalSec - elapsedSec from now). Nothing plays after the rest finishes.
   */
  startRestTune({ totalSec = RINGTONE_SECONDS, elapsedSec = 0 } = {}) {
    if (!this.settings.enabled) return Promise.resolve(false);
    return this._start('rest', this._ringtoneDesc(this.settings.ringtoneId), totalSec, elapsedSec);
  }

  stopRestTune() { this._stopChannel('rest'); }

  /** Plays the selected completion ringtone for exactly `maxSec` (loop if shorter, cut if longer). */
  playRingtone({ maxSec = RINGTONE_SECONDS, key = null } = {}) {
    if (!this.settings.enabled) return Promise.resolve(false);
    if (key !== null && key === this.lastRingKey) { console.warn(LOG, 'duplicate completion ignored', key); return Promise.resolve(false); }
    this.lastRingKey = key;
    return this._start('ringtone', this._ringtoneDesc(this.settings.ringtoneId), maxSec, 0);
  }

  stopRingtone() { this._stopChannel('ringtone'); }

  /** Settings previews always work, even when Sound is switched OFF. Same 20 s rule. */
  previewRingtone(id = this.settings.ringtoneId) {
    return this._start('preview', this._ringtoneDesc(id), RINGTONE_SECONDS, 0);
  }

  stopPreview() { this._stopChannel('preview'); }

  stopAll() {
    this.token += 1;
    this.loading = null;
    this.pending = null;
    CHANNEL_NAMES.forEach((name) => this._stopChannel(name, false));
    this._emit();
  }

  isActive() { return Object.keys(this.channels).length > 0; }

  // ---------- engine ----------
  async _start(channel, desc, durationSec, offsetSec) {
    // Stop everything first and synchronously => never two sounds at once, even while loading.
    CHANNEL_NAMES.forEach((name) => this._stopChannel(name, false));
    this.pending = null;
    const token = ++this.token;
    this.loading = { channel, token };
    const remaining = Math.max(0, durationSec - offsetSec);
    if (remaining <= 0.05) { this.loading = null; this._emit(); return false; }
    const wallStart = Date.now() - offsetSec * 1000;
    const params = { channel, desc, durationSec, offsetSec };

    let started = false;
    try {
      const running = await this._ensureRunning();
      if (token !== this.token) return false;           // superseded while waiting
      if (running) {
        started = await this._playWebAudio(token, params, remaining);
        if (token !== this.token) return false;
      }
    } catch (error) {
      if (token !== this.token) return false;
      this._fail(`Web Audio playback failed for ${desc.key}`, error);
    }

    if (!started) {
      try {
        started = await this._playHtml(token, params, remaining);
        if (token !== this.token) return false;
      } catch (error) {
        if (token !== this.token) return false;
        this._fail(`HTMLAudio playback failed for ${desc.key}`, error);
      }
    }

    if (this.loading && this.loading.token === token) this.loading = null;
    if (!started) {
      // Autoplay policy (or a dead audio stack). Remember it, retry on the next tap.
      console.error(LOG, `"${channel}" is blocked. Tap anywhere to enable sound.`);
      this.pending = { channel, params, wallStart, until: wallStart + durationSec * 1000 };
    }
    this._emit();
    return started;
  }

  async _playWebAudio(token, { channel, desc, durationSec, offsetSec }, remaining) {
    const ctx = this.ctx;
    const buffer = await this._getBuffer(desc);
    if (token !== this.token) return false;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;                       // loops seamlessly if the file is shorter than the limit
    const gain = ctx.createGain();
    source.connect(gain);
    gain.connect(this.master);

    const startAt = ctx.currentTime + 0.02;
    const endAt = startAt + remaining;        // exact deadline; a partial last loop is simply cut
    gain.gain.setValueAtTime(1, startAt);
    gain.gain.setValueAtTime(1, Math.max(startAt, endAt - FADE_OUT_SECONDS * 2));
    gain.gain.linearRampToValueAtTime(0, endAt);
    const loopOffset = buffer.duration > 0 ? offsetSec % buffer.duration : 0;
    source.start(startAt, loopOffset);
    source.stop(endAt);

    const active = {
      id: desc.id,
      kind: 'webaudio',
      endsAtWall: Date.now() + remaining * 1000 + 20,
      stop: () => {
        try {
          const now = ctx.currentTime;
          gain.gain.cancelScheduledValues(now);
          gain.gain.setValueAtTime(gain.gain.value, now);
          gain.gain.linearRampToValueAtTime(0, now + FADE_OUT_SECONDS);
          source.stop(now + FADE_OUT_SECONDS + 0.005);
        } catch (error) { /* already stopped */ }
      },
      cleanup: () => { try { source.disconnect(); gain.disconnect(); } catch (error) { /* ignore */ } },
    };
    source.onended = () => this._release(channel, active);
    this.channels[channel] = active;
    this.lastEngine = 'webaudio';
    return true;
  }

  async _playHtml(token, { channel, desc, durationSec, offsetSec }, remaining) {
    const AudioCtor = this.win && this.win.Audio;
    const url = await this._htmlUrlFor(desc);
    if (!AudioCtor || !url) throw new Error('HTMLAudio unavailable');
    const audio = new AudioCtor();
    audio.preload = 'auto';
    audio.loop = true;
    audio.src = url;
    audio.volume = this.settings.volume;
    audio.addEventListener('error', () => {
      const code = audio.error ? audio.error.code : 'unknown';
      this._fail(`<audio> error code ${code} for ${desc.key}`);
    });
    if (offsetSec > 0) {
      audio.addEventListener('loadedmetadata', () => {
        if (audio.duration > 0) audio.currentTime = offsetSec % audio.duration;
      }, { once: true });
    }
    const endsAtWall = Date.now() + remaining * 1000;
    const active = {
      id: desc.id,
      kind: 'html',
      endsAtWall,
      setVolume: (volume) => { audio.volume = volume; },
      stop: () => { clearTimeout(active.timer); try { audio.pause(); } catch (error) { /* ignore */ } },
      cleanup: () => {
        clearTimeout(active.timer);
        try { audio.pause(); audio.removeAttribute('src'); audio.load(); } catch (error) { /* ignore */ }
      },
    };
    await audio.play();                        // rejects with NotAllowedError when blocked
    if (token !== this.token) { active.cleanup(); return false; }
    const stopIfCurrent = () => { if (this.channels[channel] === active) this._stopChannel(channel); };
    active.timer = setTimeout(stopIfCurrent, remaining * 1000);
    audio.addEventListener('timeupdate', () => { if (Date.now() >= endsAtWall) stopIfCurrent(); });
    this.channels[channel] = active;
    this.lastEngine = 'html';
    return true;
  }

  _stopChannel(channel, emit = true) {
    // A start() that is still loading must not begin playing after it was stopped.
    if (this.loading && this.loading.channel === channel) { this.token += 1; this.loading = null; }
    if (this.pending && this.pending.channel === channel) this.pending = null;
    const active = this.channels[channel];
    if (!active) { if (emit) this._emit(); return; }
    delete this.channels[channel];
    active.stop();
    // Let the fade-out finish before tearing the graph down.
    setTimeout(() => active.cleanup(), 60);
    if (emit) this._emit();
  }

  _release(channel, active) {
    if (this.channels[channel] === active) {
      delete this.channels[channel];
      this._emit();
    }
    active.cleanup();
  }

  _retryPending() {
    const pending = this.pending;
    if (!pending || Date.now() >= pending.until) { this.pending = null; this._emit(); return; }
    const elapsed = (Date.now() - pending.wallStart) / 1000;
    this.pending = null;
    console.warn(LOG, `resuming blocked "${pending.channel}" after tap (${elapsed.toFixed(1)} s late)`);
    const { desc, durationSec } = pending.params;
    this._start(pending.channel, desc, durationSec, elapsed);
  }

  dispose() {
    this.disposed = true;
    this.stopAll();
    const doc = this.win && this.win.document;
    if (doc) {
      ['pointerdown', 'touchend', 'click', 'keydown'].forEach((type) => doc.removeEventListener(type, this._onGesture, { capture: true }));
      doc.removeEventListener('visibilitychange', this._onVisibility);
    }
    [this.customUrl, this.silentUrl, ...this.wavUrls.values()].forEach((url) => url && this.win.URL.revokeObjectURL(url));
    if (this.ctx && this.ctx.close) this.ctx.close().catch(() => {});
    this.ctx = null;
    this.listeners.clear();
  }
}

// App-wide singleton (browser only; tests build their own instance).
export const audioManager = typeof window !== 'undefined' ? new AudioManager() : null;
