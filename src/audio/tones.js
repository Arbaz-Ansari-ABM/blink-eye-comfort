// Original, royalty-free ringtones synthesised from scratch (no samples, no external URLs).
// Each tone is rendered as ONE seamless loop cell. Tails are wrapped around the end of the
// cell (circular synthesis), so looping the cell has no click and no gap.
// The AudioManager loops the cell until the 20 s limit, and stops it mid-loop if needed,
// which handles the "last partial loop" without ever stretching or pitch-shifting.

export const TONE_SAMPLE_RATE = 44100;
export const RINGTONE_SECONDS = 20;

export const BUILT_IN_RINGTONES = [
  { id: 'gentle-chime', name: 'Gentle Chime', description: 'Soft rising four-note chime', loopSeconds: 4 },
  { id: 'soft-bell', name: 'Soft Bell', description: 'Warm bell strike, slow repeat', loopSeconds: 5 },
  { id: 'digital-pulse', name: 'Digital Pulse', description: 'Clean triple pulse', loopSeconds: 2 },
  { id: 'wind-chimes', name: 'Wind Chimes', description: 'Airy, drifting high chimes', loopSeconds: 6 },
  { id: 'music-box', name: 'Music Box', description: 'Tiny plucked lullaby', loopSeconds: 4 },
  { id: 'calm-marimba', name: 'Calm Marimba', description: 'Warm wooden marimba notes', loopSeconds: 4 },
];

// Adds a decaying partial into `data`, wrapping past the end back to the start.
function addPartial(data, startSec, freq, amp, tau, sr, attack = 0.004) {
  const n = data.length;
  const start = Math.round(startSec * sr);
  const length = Math.min(n * 2, Math.round(tau * 7 * sr)); // ~7 time constants is inaudible
  const attackSamples = Math.max(1, Math.round(attack * sr));
  const w = 2 * Math.PI * freq / sr;
  for (let i = 0; i < length; i += 1) {
    const env = Math.exp(-i / (tau * sr)) * Math.min(1, i / attackSamples);
    data[(start + i) % n] += Math.sin(w * i) * amp * env;
  }
}

function normalise(data, peak = 0.7) {
  let max = 0;
  for (let i = 0; i < data.length; i += 1) max = Math.max(max, Math.abs(data[i]));
  if (max === 0) return data;
  const gain = peak / max;
  for (let i = 0; i < data.length; i += 1) data[i] *= gain;
  return data;
}

function renderGentleChime(sr) {
  const data = new Float32Array(Math.round(4 * sr));
  const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
  notes.forEach((freq, index) => {
    const at = index * 0.45;
    addPartial(data, at, freq, 0.5, 0.55, sr);
    addPartial(data, at, freq * 2, 0.16, 0.3, sr);
    addPartial(data, at, freq * 3.01, 0.06, 0.18, sr);
  });
  return normalise(data);
}

function renderSoftBell(sr) {
  const data = new Float32Array(Math.round(5 * sr));
  // Classic bell partial ratios with different decay times (higher partials die faster).
  const partials = [
    [0.5, 0.35, 1.8], [1, 0.5, 1.5], [1.19, 0.25, 1.1], [1.56, 0.18, 0.8],
    [2, 0.22, 0.7], [2.74, 0.12, 0.45], [3.76, 0.08, 0.3],
  ];
  [0, 2.5].forEach((at) => {
    partials.forEach(([ratio, amp, tau]) => addPartial(data, at, 440 * ratio, amp, tau, sr, 0.003));
  });
  return normalise(data);
}

function renderDigitalPulse(sr) {
  const data = new Float32Array(Math.round(2 * sr));
  const pulse = (at, freq) => {
    const length = Math.round(0.11 * sr);
    const start = Math.round(at * sr);
    const fade = Math.round(0.012 * sr);
    for (let i = 0; i < length; i += 1) {
      const t = i / sr;
      // Sine with a touch of 3rd harmonic: digital but not harsh.
      const s = Math.sin(2 * Math.PI * freq * t) + 0.25 * Math.sin(2 * Math.PI * freq * 3 * t);
      const env = Math.min(1, i / fade, (length - i) / fade);
      data[(start + i) % data.length] += s * env;
    }
  };
  pulse(0, 880);
  pulse(0.22, 880);
  pulse(0.44, 1174.66); // D6
  return normalise(data, 0.6);
}

function renderWindChimes(sr) {
  const data = new Float32Array(Math.round(6 * sr));
  // Pentatonic notes at uneven times so it feels like a breeze, not a sequence.
  const notes = [[0, 1318.5], [0.55, 1568], [1.15, 1760], [1.9, 2093], [2.6, 1568], [3.5, 1975], [4.3, 1318.5], [5.0, 1760]];
  notes.forEach(([at, freq]) => {
    addPartial(data, at, freq, 0.45, 0.8, sr, 0.003);
    addPartial(data, at, freq * 2.76, 0.12, 0.35, sr, 0.003);
  });
  return normalise(data, 0.65);
}

function renderMusicBox(sr) {
  const data = new Float32Array(Math.round(4 * sr));
  const melody = [1046.5, 1318.5, 1568, 1318.5, 1046.5, 784, 1046.5, 1318.5]; // C6 E6 G6 E6 C6 G5 C6 E6
  melody.forEach((freq, i) => {
    addPartial(data, i * 0.5, freq, 0.5, 0.32, sr, 0.002);
    addPartial(data, i * 0.5, freq * 2, 0.18, 0.18, sr, 0.002);
    addPartial(data, i * 0.5, freq * 4.1, 0.05, 0.08, sr, 0.002);
  });
  return normalise(data, 0.65);
}

function renderCalmMarimba(sr) {
  const data = new Float32Array(Math.round(4 * sr));
  const melody = [440, 523.25, 659.25, 880, 659.25, 523.25, 440, 329.63]; // A4 C5 E5 A5 E5 C5 A4 E4
  melody.forEach((freq, i) => {
    addPartial(data, i * 0.5, freq, 0.6, 0.28, sr, 0.003);
    addPartial(data, i * 0.5, freq * 4, 0.22, 0.07, sr, 0.003); // woody attack partial
  });
  return normalise(data, 0.7);
}

const RENDERERS = {
  'gentle-chime': renderGentleChime,
  'soft-bell': renderSoftBell,
  'digital-pulse': renderDigitalPulse,
  'wind-chimes': renderWindChimes,
  'music-box': renderMusicBox,
  'calm-marimba': renderCalmMarimba,
};

export function isBuiltInRingtone(id) {
  return Object.prototype.hasOwnProperty.call(RENDERERS, id);
}

export function renderTone(id, sampleRate = TONE_SAMPLE_RATE) {
  const render = RENDERERS[id];
  if (!render) throw new Error(`Unknown built-in ringtone: ${id}`);
  return render(sampleRate);
}

// 16-bit PCM mono WAV. WAV/PCM is the most reliable format for Android WebView, so it is
// used for the HTMLAudio fallback path.
export function encodeWav(samples, sampleRate = TONE_SAMPLE_RATE) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset, text) => { for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i)); };
  write(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}
