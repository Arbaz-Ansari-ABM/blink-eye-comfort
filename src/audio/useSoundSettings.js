import { useCallback, useEffect, useRef, useState } from 'react';
import { CUSTOM_RINGTONE_ID } from './AudioManager.js';
import {
  DEFAULT_SOUND_SETTINGS, loadSoundState, removeCustomRingtone, saveCustomRingtone, saveSoundSettings, validateAudioFile,
} from './soundStore.js';

/**
 * Owns the persisted sound preferences and keeps the AudioManager in sync with them.
 * `custom` is metadata only ({ name, size }); the audio bytes live in IndexedDB and inside the manager.
 */
export function useSoundSettings(audio) {
  const [settings, setSettings] = useState(DEFAULT_SOUND_SETTINGS);
  const [custom, setCustom] = useState(null);
  const [ready, setReady] = useState(false);
  const [persistence, setPersistence] = useState('unknown');
  const [status, setStatus] = useState({ kind: 'idle', message: '' });
  const settingsRef = useRef(settings);
  const saveTimer = useRef(null);

  useEffect(() => {
    let cancelled = false;
    loadSoundState().then((loaded) => {
      if (cancelled) return;
      settingsRef.current = loaded.settings;
      setSettings(loaded.settings);
      setPersistence(loaded.persistence);
      audio.setSettings(loaded.settings);
      if (loaded.custom) {
        audio.setCustomRingtone(loaded.custom.blob);
        setCustom({ name: loaded.custom.name, size: loaded.custom.size });
      }
      audio.preload();
      setReady(true);
    });
    return () => { cancelled = true; clearTimeout(saveTimer.current); };
  }, [audio]);

  const update = useCallback((patch, { immediate = true } = {}) => {
    const next = { ...settingsRef.current, ...patch };
    settingsRef.current = next;
    setSettings(next);
    audio.setSettings(patch);
    clearTimeout(saveTimer.current);
    if (immediate) saveSoundSettings(next);
    else saveTimer.current = setTimeout(() => saveSoundSettings(settingsRef.current), 250); // slider drags
  }, [audio]);

  const chooseCustomFile = useCallback(async (file) => {
    const check = validateAudioFile(file);
    if (!check.ok) { setStatus({ kind: 'error', message: check.error }); return false; }
    setStatus({ kind: 'busy', message: 'Checking the file…' });
    try {
      const probe = await audio.probe(file);
      if (!probe.ok) { setStatus({ kind: 'error', message: probe.reason || 'This file cannot be played on this device.' }); return false; }
      const saved = await saveCustomRingtone(file, check.mime);
      audio.setCustomRingtone(saved.blob);
      setCustom({ name: saved.name, size: saved.size });
      update({ ringtoneId: CUSTOM_RINGTONE_ID });
      setStatus({ kind: 'ok', message: 'Saved on this device and selected.' });
      return true;
    } catch (error) {
      console.error('[Blink audio] saving the custom ringtone failed', error);
      setStatus({ kind: 'error', message: 'Could not save the file on this device (storage unavailable).' });
      return false;
    }
  }, [audio, update]);

  const removeCustom = useCallback(async () => {
    audio.setCustomRingtone(null);
    await removeCustomRingtone();
    setCustom(null);
    if (settingsRef.current.ringtoneId === CUSTOM_RINGTONE_ID) update({ ringtoneId: DEFAULT_SOUND_SETTINGS.ringtoneId });
    setStatus({ kind: 'ok', message: 'Custom ringtone removed.' });
  }, [audio, update]);

  return { settings, custom, ready, persistence, status, update, chooseCustomFile, removeCustom };
}
