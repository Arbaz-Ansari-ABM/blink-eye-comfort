import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Check, Music2, Play, Square, Trash2, Upload, Volume2, VolumeX, X } from 'lucide-react';
import {
  BUILT_IN_RINGTONES, CUSTOM_RINGTONE_ID, RINGTONE_SECONDS,
} from './AudioManager.js';
import { ALLOWED_EXTENSIONS, MAX_CUSTOM_BYTES, formatBytes } from './soundStore.js';

const ENGINE_LABEL = { webaudio: 'Web Audio', html: 'HTML audio (fallback)', none: 'not used yet' };

function PreviewButton({ label, playing, secondsLeft, onPlay, onStop }) {
  return (
    <button
      type="button"
      className={`ss-preview ${playing ? 'is-playing' : ''}`}
      aria-label={playing ? `Stop preview of ${label}` : `Play preview of ${label}`}
      onClick={playing ? onStop : onPlay}
    >
      {playing ? <Square size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
      <span>{playing ? `Stop · ${secondsLeft}s` : 'Preview'}</span>
    </button>
  );
}

/**
 * Sound Settings panel. Rendered inside the existing "sound view" drawer/panel shell, so it
 * keeps the dialog behaviour (focus trap, Escape, backdrop) that App already provides.
 */
export default function SoundSettings({ audio, sound, onClose, sectionRef }) {
  const snapshot = useSyncExternalStore(audio.subscribe, audio.getSnapshot);
  const { settings, custom, status, persistence } = sound;
  const fileInputRef = useRef(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!snapshot.previewId) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [snapshot.previewId]);

  const previewLeft = Math.max(0, Math.ceil((snapshot.previewEndsAt - now) / 1000));
  const isPreviewing = (id) => snapshot.previewId === id;
  const ringtones = [
    ...BUILT_IN_RINGTONES,
    ...(custom ? [{ id: CUSTOM_RINGTONE_ID, name: custom.name, description: `Your file · ${formatBytes(custom.size)}` }] : []),
  ];
  const volumePercent = Math.round(settings.volume * 100);
  const testing = isPreviewing(settings.ringtoneId);

  const onFile = async (event) => {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (file) await sound.chooseCustomFile(file);
  };

  return (
    <section
      className="journal info-page content-view sound-view sound-settings"
      ref={sectionRef}
      tabIndex="-1"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sound-title"
    >
      <div className="ss-head">
        <div>
          <p className="eyebrow">Sound</p>
          <h2 id="sound-title">Sound settings</h2>
          <p className="ss-sub">Pick the ringtone that plays during your 20-second rest.</p>
        </div>
        <button type="button" className="ss-close" aria-label="Close sound settings" onClick={onClose}><X size={18} /></button>
      </div>

      {snapshot.blocked && (
        <p className="ss-alert" role="status">Your device is holding the sound back. Tap anywhere to let it play.</p>
      )}

      <div className="ss-card">
        <div className="ss-row-main">
          <span className="ss-icon">{settings.enabled ? <Volume2 size={18} /> : <VolumeX size={18} />}</span>
          <div className="ss-grow">
            <strong>Sound</strong>
            <small>{settings.enabled ? 'Rest ringtone is on' : 'Timer sounds are muted'}</small>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={settings.enabled}
            aria-label="Sound on or off"
            className={`ss-switch ${settings.enabled ? 'is-on' : ''}`}
            onClick={() => sound.update({ enabled: !settings.enabled })}
          ><span /></button>
        </div>

        <label className="ss-volume">
          <span>Volume</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={settings.volume}
            aria-label="Volume"
            aria-valuetext={`${volumePercent} percent`}
            onChange={(event) => sound.update({ volume: Number(event.target.value) }, { immediate: false })}
          />
          <output>{volumePercent}%</output>
        </label>

        <button
          type="button"
          className="ss-test"
          onClick={() => (testing ? audio.stopPreview() : audio.previewRingtone(settings.ringtoneId))}
        >
          {testing ? <Square size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
          {testing ? `Stop test · ${previewLeft}s` : 'Test ringtone'}
        </button>
      </div>

      <div className="ss-card">
        <div className="ss-card-title">
          <p className="eyebrow">During the {RINGTONE_SECONDS}-second rest</p>
          <h3>Rest ringtone</h3>
          <small>Rings only while the {RINGTONE_SECONDS}-second rest runs, then stops by itself. Short sounds loop; long ones are cut at {RINGTONE_SECONDS}s.</small>
        </div>
        <div className="ss-list" role="radiogroup" aria-label="Rest ringtone">
          {ringtones.map((tone) => {
            const selected = settings.ringtoneId === tone.id;
            return (
              <div className={`ss-item ${selected ? 'is-selected' : ''}`} key={tone.id}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className="ss-select"
                  onClick={() => sound.update({ ringtoneId: tone.id })}
                >
                  <span className="ss-radio">{selected && <Check size={12} strokeWidth={3} />}</span>
                  <span className="ss-grow"><strong>{tone.name}</strong><small>{tone.description}</small></span>
                  {selected && <span className="ss-pill">Selected</span>}
                </button>
                <PreviewButton
                  label={tone.name}
                  playing={isPreviewing(tone.id)}
                  secondsLeft={previewLeft}
                  onPlay={() => audio.previewRingtone(tone.id)}
                  onStop={() => audio.stopPreview()}
                />
              </div>
            );
          })}
        </div>
      </div>

      <div className="ss-card">
        <div className="ss-card-title">
          <p className="eyebrow">Your own sound</p>
          <h3>Custom ringtone</h3>
          <small>
            {ALLOWED_EXTENSIONS.join(', ').toUpperCase()} · up to {formatBytes(MAX_CUSTOM_BYTES)}. Stays on this device and is never uploaded.
          </small>
        </div>
        <input
          ref={fileInputRef}
          className="sr-only"
          type="file"
          accept="audio/*,.mp3,.wav,.aac,.m4a,.ogg"
          onChange={onFile}
          aria-label="Choose a ringtone file"
        />
        <div className="ss-custom">
          {custom ? (
            <div className="ss-file"><Music2 size={16} /><span className="ss-grow"><strong>{custom.name}</strong><small>{formatBytes(custom.size)}</small></span></div>
          ) : (
            <p className="ss-empty">No custom ringtone yet.</p>
          )}
          <div className="ss-actions">
            <button type="button" className="ss-button" onClick={() => fileInputRef.current && fileInputRef.current.click()} disabled={status.kind === 'busy'}>
              <Upload size={15} /> {custom ? 'Replace file' : 'Choose file'}
            </button>
            {custom && (
              <button type="button" className="ss-button ss-danger" onClick={sound.removeCustom}><Trash2 size={15} /> Remove</button>
            )}
          </div>
        </div>
        {status.message && <p className={`ss-status is-${status.kind}`} role={status.kind === 'error' ? 'alert' : 'status'}>{status.message}</p>}
      </div>

      {import.meta.env.DEV && <p className="ss-foot">
        Audio engine: {ENGINE_LABEL[snapshot.engine] || snapshot.engine} · {snapshot.ctxState}
        {persistence === 'localstorage' ? ' · settings saved in basic storage' : ''}
        {snapshot.lastError ? ` · last issue: ${snapshot.lastError}` : ''}
      </p>}
    </section>
  );
}
