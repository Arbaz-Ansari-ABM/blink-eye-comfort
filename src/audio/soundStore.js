// Persistence for sound settings and the user's custom ringtone.
// IndexedDB is the primary store (it can hold the audio file itself). Small settings are also
// mirrored to localStorage so they survive when IndexedDB is unavailable (some WebViews / private
// modes). Nothing here ever leaves the device: the custom ringtone is never uploaded anywhere.

export const DEFAULT_SOUND_SETTINGS = {
  enabled: true,
  volume: 0.8,
  ringtoneId: 'gentle-chime',
};

export const MAX_CUSTOM_BYTES = 10 * 1024 * 1024; // 10 MB
export const ALLOWED_EXTENSIONS = ['mp3', 'wav', 'aac', 'm4a', 'ogg'];
const MIME_BY_EXTENSION = {
  mp3: 'audio/mpeg', wav: 'audio/wav', aac: 'audio/aac', m4a: 'audio/mp4', ogg: 'audio/ogg',
};

const DB_NAME = 'blink-sound';
const STORE = 'kv';
const SETTINGS_KEY = 'settings';
const CUSTOM_KEY = 'custom-ringtone';
const LS_KEY = 'blink-sound-settings';

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function extensionOf(name = '') {
  const match = /\.([a-z0-9]+)$/i.exec(name);
  return match ? match[1].toLowerCase() : '';
}

/** Returns { ok, error?, mime? }. Accepts empty/octet-stream MIME types because Android pickers send them. */
export function validateAudioFile(file) {
  if (!file) return { ok: false, error: 'No file selected.' };
  const extension = extensionOf(file.name);
  const typeLooksAudio = typeof file.type === 'string' && file.type.startsWith('audio/');
  const typeUnknown = !file.type || file.type === 'application/octet-stream';
  const list = ALLOWED_EXTENSIONS.join(', ').toUpperCase();
  if (extension && !ALLOWED_EXTENSIONS.includes(extension)) {
    return { ok: false, error: `".${extension}" files are not supported. Please choose ${list}.` };
  }
  if (!extension && !typeLooksAudio) return { ok: false, error: `Unsupported file. Please choose ${list}.` };
  if (!typeLooksAudio && !typeUnknown) return { ok: false, error: 'That does not look like an audio file.' };
  if (file.size === 0) return { ok: false, error: 'This file is empty.' };
  if (file.size > MAX_CUSTOM_BYTES) {
    return { ok: false, error: `File is too large (${formatBytes(file.size)}). Maximum is ${formatBytes(MAX_CUSTOM_BYTES)}.` };
  }
  return { ok: true, mime: typeLooksAudio ? file.type : MIME_BY_EXTENSION[extension] };
}

// ---------- IndexedDB helpers (each returns a rejected promise if IDB is unavailable) ----------
function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
    let request;
    try { request = indexedDB.open(DB_NAME, 1); } catch (error) { reject(error); return; }
    request.onupgradeneeded = () => { request.result.createObjectStore(STORE); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
}

async function withStore(mode, run) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const result = run(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(result && 'result' in result ? result.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
    });
  } finally {
    db.close();
  }
}

const idbGet = (key) => withStore('readonly', (store) => store.get(key));
const idbSet = (key, value) => withStore('readwrite', (store) => store.put(value, key));
const idbDelete = (key) => withStore('readwrite', (store) => store.delete(key));

function readLocalSettings() {
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function writeLocalSettings(settings) {
  try { window.localStorage.setItem(LS_KEY, JSON.stringify(settings)); } catch { /* storage denied */ }
}

function sanitise(raw) {
  const merged = { ...DEFAULT_SOUND_SETTINGS, ...(raw || {}) };
  delete merged.restTuneId; // older versions had a separate rest tune
  merged.enabled = merged.enabled !== false;
  merged.volume = Math.max(0, Math.min(1, Number(merged.volume)));
  if (!Number.isFinite(merged.volume)) merged.volume = DEFAULT_SOUND_SETTINGS.volume;
  return merged;
}

/** Loads everything on app start. Never throws. */
export async function loadSoundState() {
  let idbSettings = null;
  let customRecord = null;
  let persistence = 'indexeddb';
  try {
    idbSettings = await idbGet(SETTINGS_KEY);
    customRecord = await idbGet(CUSTOM_KEY);
  } catch (error) {
    persistence = 'localstorage';
    console.warn('[Blink audio] IndexedDB unavailable, using localStorage for settings only:', error.message);
  }
  const settings = sanitise(idbSettings || readLocalSettings());
  let custom = null;
  if (customRecord && customRecord.data) {
    custom = {
      blob: new Blob([customRecord.data], { type: customRecord.type || 'audio/mpeg' }),
      name: customRecord.name, size: customRecord.size, type: customRecord.type,
    };
  } else if (settings.ringtoneId === 'custom') {
    settings.ringtoneId = DEFAULT_SOUND_SETTINGS.ringtoneId; // the file is gone; do not point at it
  }
  return { settings, custom, persistence };
}

export async function saveSoundSettings(settings) {
  writeLocalSettings(settings);
  try { await idbSet(SETTINGS_KEY, settings); return true; } catch (error) {
    console.warn('[Blink audio] could not save settings to IndexedDB:', error.message);
    return false;
  }
}

/** Stores the file as raw bytes (more robust than storing a Blob in old WebViews). */
export async function saveCustomRingtone(file, mime) {
  const data = await (file.arrayBuffer ? file.arrayBuffer() : new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  }));
  await idbSet(CUSTOM_KEY, { name: file.name, size: file.size, type: mime, data, savedAt: Date.now() });
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch { /* optional */ }
  return { blob: new Blob([data], { type: mime }), name: file.name, size: file.size, type: mime };
}

export async function removeCustomRingtone() {
  try { await idbDelete(CUSTOM_KEY); } catch (error) { console.warn('[Blink audio] could not remove custom ringtone:', error.message); }
}
