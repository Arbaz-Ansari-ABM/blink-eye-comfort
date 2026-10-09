import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Bell, BookOpen, ChevronLeft, ChevronRight, Coffee, Dumbbell, Eye, HelpCircle, Home, Pause, Play, Repeat2, RotateCcw, Shuffle, Sparkles, Volume2, X } from 'lucide-react';
import './styles.css';

const FOCUS_SECONDS = 20 * 60;
const REST_SECONDS = 20;
const TIMER_STORAGE_KEY = 'blink-timer-state';
const REMINDER_TRACK_KEY = 'blink-reminder-track';

function requestNotifications() {
  try {
    if ('Notification' in window && Notification.permission === 'default') {
      const result = Notification.requestPermission();
      result?.catch?.(() => undefined);
    }
  } catch {
    // Some mobile browsers expose Notification without supporting permission requests.
  }
}

// Android Chrome throws on `new Notification()`; notifications must go through the service worker.
function notify(title, body) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistration()
        .then((registration) => {
          if (registration) return registration.showNotification(title, { body });
          return new Notification(title, { body });
        })
        .catch(() => undefined);
      return;
    }
    new Notification(title, { body });
  } catch {
    // Notifications are optional; never let them break the timer.
  }
}

// Mobile browsers cap the number of AudioContexts and start them suspended,
// so share one context and resume it from a user gesture.
let sharedAudioContext = null;

function getAudioContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!sharedAudioContext || sharedAudioContext.state === 'closed') {
    try {
      sharedAudioContext = new AudioContextClass();
    } catch {
      return null;
    }
  }
  return sharedAudioContext;
}

function unlockAudio() {
  const context = getAudioContext();
  if (context?.state === 'suspended') context.resume().catch(() => undefined);
}

function playReminderBeep() {
  const context = getAudioContext();
  if (!context) return;
  try {
    if (context.state === 'suspended') context.resume().catch(() => undefined);
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, context.currentTime);
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.16, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.5);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.55);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
  } catch {
    // Ignore audio failures so the timer keeps working.
  }
}

function formatTime(total) {
  const minutes = Math.floor(total / 60).toString().padStart(2, '0');
  const seconds = (total % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function App() {
  const [timerState] = useState(() => {
    try {
      const saved = window.localStorage.getItem(TIMER_STORAGE_KEY);
      const parsed = saved ? JSON.parse(saved) : null;
      if (!parsed || typeof parsed !== 'object') return null;
      // A session that ended while the tab was closed restarts fresh instead of firing reminders on load.
      if ((parsed.phase === 'focus' || parsed.phase === 'rest') && (!parsed.endsAt || parsed.endsAt <= Date.now())) {
        return { completed: Number(parsed.completed) || 0, lastRest: parsed.lastRest };
      }
      return parsed;
    } catch {
      return null;
    }
  });
  const [savedReminderTrack] = useState(() => {
    try {
      return window.localStorage.getItem(REMINDER_TRACK_KEY) || 'iphone-style-beep';
    } catch {
      return 'iphone-style-beep';
    }
  });
  const [phase, setPhase] = useState(timerState?.phase || 'stopped');
  const [secondsLeft, setSecondsLeft] = useState(timerState?.secondsLeft || FOCUS_SECONDS);
  const [completed, setCompleted] = useState(timerState?.completed ?? 0);
  const [lastRest, setLastRest] = useState(timerState?.lastRest || 'Not yet today');
  const [endsAt, setEndsAt] = useState(timerState?.endsAt || null);
  const [screenTime, setScreenTime] = useState(timerState?.screenTime || 0);
  const [startedAt, setStartedAt] = useState(timerState?.startedAt || null);
  const [notice, setNotice] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  const [showJournal, setShowJournal] = useState(false);
  const [showSound, setShowSound] = useState(false);
  const [uploadedTracks, setUploadedTracks] = useState([]);
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0);
  const [musicPlaying, setMusicPlaying] = useState(false);
  const [musicProgress, setMusicProgress] = useState(0);
  const [musicVolume, setMusicVolume] = useState(0.8);
  const [musicMuted, setMusicMuted] = useState(false);
  const [repeatTrack, setRepeatTrack] = useState(false);
  const [shuffleTracks, setShuffleTracks] = useState(false);
  const [reminderTrackId, setReminderTrackId] = useState(savedReminderTrack);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const alertRef = useRef(null);
  const reminderAudioRef = useRef(null);
  const beepIntervalRef = useRef(null);
  const menuToggleRef = useRef(null);
  const audioInputRef = useRef(null);
  const headerRef = useRef(null);
  const uploadedTracksRef = useRef([]);

  const isRest = phase === 'rest';
  const isRunning = phase === 'focus' || phase === 'rest';
  const duration = isRest ? REST_SECONDS : FOCUS_SECONDS;
  const progress = Math.max(0, Math.min(1, 1 - secondsLeft / duration));
  const circumference = 2 * Math.PI * 142;
  const nextReminder = useMemo(() => {
    if (!isRunning) return 'Ready when you are';
    const date = new Date(Date.now() + secondsLeft * 1000);
    return `Next reminder · ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  }, [isRunning, secondsLeft]);
  const tracks = useMemo(() => [
    { id: 'iphone-style-beep', name: 'iPhone-style beep', src: '/iphone-style-beep.wav' },
    { id: 'blink-reminder', name: 'Blink reminder', src: '/eyes.mp3' },
    ...uploadedTracks,
  ], [uploadedTracks]);
  const currentTrack = tracks[currentTrackIndex] || tracks[0];
  const reminderTrack = tracks.find((track) => track.id === reminderTrackId) || tracks[0];

  useEffect(() => {
    if (phase === 'rest' && !endsAt) {
      setEndsAt(Date.now() + Math.max(secondsLeft, 1) * 1000);
    }
  }, [phase, endsAt, secondsLeft]);

  useEffect(() => {
    if (!isRunning || !endsAt) return undefined;
    const updateRemaining = () => {
      const remaining = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining === 0) {
        setEndsAt(null);
      }
    };
    updateRemaining();
    const timer = window.setInterval(updateRemaining, 1000);
    return () => window.clearInterval(timer);
  }, [isRunning, endsAt]);

  useEffect(() => {
    if (!isRunning || !startedAt) return undefined;
    const updateScreenTime = () => setScreenTime(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    updateScreenTime();
    const timer = window.setInterval(updateScreenTime, 1000);
    return () => window.clearInterval(timer);
  }, [isRunning]);

  useEffect(() => {
    if (!isRunning || secondsLeft > 0) return undefined;
    if (phase === 'focus') {
      setPhase('rest');
      setSecondsLeft(REST_SECONDS);
      setEndsAt(Date.now() + REST_SECONDS * 1000);
      setNotice('Focus complete. Time to let your eyes travel across the room.');
      playReminderBeep();
      const reminderAudio = reminderAudioRef.current;
      if (reminderAudio) {
        reminderAudio.currentTime = 0;
        reminderAudio.loop = false;
        reminderAudio.play().catch(() => undefined);
      }
      playReminderBeep();
      beepIntervalRef.current = window.setInterval(playReminderBeep, 1000);
      notify('Time to rest your eyes', 'Look 20 feet away for 20 seconds.');
      return undefined;
    }
    setCompleted((count) => count + 1);
    setLastRest(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
    setPhase('focus');
    setSecondsLeft(FOCUS_SECONDS);
    setEndsAt(Date.now() + FOCUS_SECONDS * 1000);
    setNotice('Rest complete. A fresh focus rhythm has begun.');
    reminderAudioRef.current?.pause();
    notify('Focus time resumed', 'Your eyes are ready for another 20-minute cycle.');
    return undefined;
  }, [isRunning, phase, secondsLeft]);

  useEffect(() => {
    if (phase === 'rest') return undefined;
    if (beepIntervalRef.current) {
      window.clearInterval(beepIntervalRef.current);
      beepIntervalRef.current = null;
    }
    return undefined;
  }, [phase]);

  useEffect(() => {
    try {
      window.localStorage.setItem(TIMER_STORAGE_KEY, JSON.stringify({
        phase, secondsLeft, completed, lastRest, endsAt, screenTime, startedAt,
      }));
    } catch {
      // Storage can be unavailable (e.g. private browsing); the timer still works.
    }
  }, [phase, secondsLeft, completed, lastRest, endsAt, screenTime, startedAt]);

  useEffect(() => {
    if (!isRunning || !('wakeLock' in navigator)) return undefined;
    let wakeLock = null;
    let cancelled = false;
    const requestWakeLock = () => {
      if (document.visibilityState !== 'visible') return;
      navigator.wakeLock.request('screen')
        .then((lock) => {
          if (cancelled) lock.release().catch(() => undefined);
          else wakeLock = lock;
        })
        .catch(() => undefined);
    };
    requestWakeLock();
    document.addEventListener('visibilitychange', requestWakeLock);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', requestWakeLock);
      wakeLock?.release().catch(() => undefined);
    };
  }, [isRunning]);

  useEffect(() => {
    if (!notice) return undefined;
    const timeout = window.setTimeout(() => setNotice(''), 3000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    uploadedTracksRef.current = uploadedTracks;
  }, [uploadedTracks]);

  useEffect(() => {
    try {
      window.localStorage.setItem(REMINDER_TRACK_KEY, reminderTrackId);
    } catch {
      setNotice('Reminder selection could not be saved.');
    }
  }, [reminderTrackId]);

  useEffect(() => () => {
    uploadedTracksRef.current.forEach((track) => URL.revokeObjectURL(track.src));
  }, []);

  useEffect(() => {
    const audio = reminderAudioRef.current;
    if (!audio) return undefined;
    const updateProgress = () => setMusicProgress(audio.duration ? audio.currentTime / audio.duration : 0);
    const handleEnded = () => {
      if (repeatTrack) {
        audio.currentTime = 0;
        audio.play().catch(() => setMusicPlaying(false));
        return;
      }
      setMusicPlaying(false);
      if (tracks.length > 1) {
        const nextIndex = shuffleTracks
          ? Math.floor(Math.random() * tracks.length)
          : (currentTrackIndex + 1) % tracks.length;
        setCurrentTrackIndex(nextIndex);
      }
    };
    audio.addEventListener('timeupdate', updateProgress);
    audio.addEventListener('ended', handleEnded);
    audio.volume = musicVolume;
    return () => {
      audio.removeEventListener('timeupdate', updateProgress);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [currentTrackIndex, musicVolume, repeatTrack, shuffleTracks, tracks.length]);

  useEffect(() => {
    const audio = reminderAudioRef.current;
    if (!audio || !musicPlaying) return undefined;
    audio.play().catch(() => setMusicPlaying(false));
    return undefined;
  }, [currentTrackIndex, musicPlaying]);

  useEffect(() => {
    if (!mobileMenuOpen) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') closeMobileMenu();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [mobileMenuOpen]);

  useEffect(() => {
    document.body.classList.toggle('menu-open', mobileMenuOpen);
    return () => document.body.classList.remove('menu-open');
  }, [mobileMenuOpen]);

  useEffect(() => {
    if (!mobileMenuOpen) return undefined;
    const closeOnOutsideClick = (event) => {
      if (!headerRef.current?.contains(event.target)) closeMobileMenu();
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick);
  }, [mobileMenuOpen]);

  const closeMobileMenu = () => {
    setMobileMenuOpen(false);
    menuToggleRef.current?.focus();
  };

  const showTimer = (event) => {
    event?.preventDefault();
    setShowHelp(false);
    setShowJournal(false);
    setShowSound(false);
  };

  const closeContentView = () => {
    setShowHelp(false);
    setShowJournal(false);
    setShowSound(false);
  };

  const handleAudioUpload = (event) => {
    const files = Array.from(event.target.files || []);
    const audioFiles = files.filter((file) => file.type.startsWith('audio/'));
    if (!audioFiles.length) {
      setNotice('Please choose one or more audio files.');
      event.target.value = '';
      return;
    }
    setUploadedTracks((current) => [...current, ...audioFiles.map((file) => ({
      id: `upload-${window.crypto?.randomUUID?.() || Date.now()}-${file.name}`,
      name: file.name,
      src: URL.createObjectURL(file),
    }))]);
    setNotice(`${audioFiles.length} track${audioFiles.length > 1 ? 's' : ''} added.`);
    event.target.value = '';
  };

  const toggleMusic = () => {
    const audio = reminderAudioRef.current;
    if (!audio) return;
    unlockAudio();
    if (musicPlaying) {
      audio.pause();
      setMusicPlaying(false);
      return;
    }
    audio.play().then(() => setMusicPlaying(true)).catch(() => setNotice('Tap again to start the sound.'));
  };

  const selectTrack = (index) => {
    setCurrentTrackIndex(index);
    setMusicProgress(0);
    setMusicPlaying(true);
  };

  const changeTrack = (direction) => {
    if (tracks.length < 2) return;
    selectTrack((currentTrackIndex + direction + tracks.length) % tracks.length);
  };

  const removeTrack = (index) => {
    if (index < 2) return;
    const track = uploadedTracks[index - 2];
    URL.revokeObjectURL(track.src);
    setUploadedTracks((current) => current.filter((_, itemIndex) => itemIndex !== index - 2));
    if (track.id === reminderTrackId) {
      setReminderTrackId('iphone-style-beep');
    }
    setCurrentTrackIndex((current) => (current >= index ? Math.max(0, current - 1) : current));
  };

  const setAsReminder = (track) => {
    setReminderTrackId(track.id);
    setNotice(`${track.name} is now your reminder ringtone.`);
  };

  const start = () => {
    const nextDuration = phase === 'rest' ? REST_SECONDS : phase === 'paused' ? secondsLeft : FOCUS_SECONDS;
    if (phase === 'stopped') {
      setSecondsLeft(nextDuration);
      setScreenTime(0);
      setStartedAt(Date.now());
    }
    setEndsAt(Date.now() + nextDuration * 1000);
    setPhase(phase === 'rest' ? 'rest' : 'focus');
    setNotice('Blink is running. We’ll nudge you when it’s time to look away.');
    requestNotifications();
    unlockAudio();
    // Prime the reminder audio during this tap so Android allows it to play later.
    const reminderAudio = reminderAudioRef.current;
    if (reminderAudio && reminderAudio.paused && !musicPlaying) {
      reminderAudio.muted = true;
      reminderAudio.play()
        .then(() => {
          reminderAudio.pause();
          reminderAudio.currentTime = 0;
          reminderAudio.muted = musicMuted;
        })
        .catch(() => { reminderAudio.muted = musicMuted; });
    }
  };

  const stop = () => {
    setPhase('paused');
    setEndsAt(null);
    if (beepIntervalRef.current) {
      window.clearInterval(beepIntervalRef.current);
      beepIntervalRef.current = null;
    }
    reminderAudioRef.current?.pause();
    setNotice('Session paused. Your next focus cycle is ready to begin.');
  };

  const reset = () => {
    setPhase('stopped');
    setSecondsLeft(FOCUS_SECONDS);
    setEndsAt(null);
    setScreenTime(0);
    setStartedAt(null);
    if (beepIntervalRef.current) {
      window.clearInterval(beepIntervalRef.current);
      beepIntervalRef.current = null;
    }
    reminderAudioRef.current?.pause();
    setNotice('Timer reset.');
  };

  return (
    <div className={`app-shell ${isRest ? 'rest-mode' : ''}`}>
      <audio ref={reminderAudioRef} preload="auto" src={reminderTrack.src} aria-hidden="true" />
      <header className="site-header" ref={headerRef}>
        <a className="wordmark" href="/" aria-label="Blink home"><span className="wordmark-dot" />blink</a>
        <div className="signature" aria-label="Twenty twenty twenty rule">20<span>—</span>20<span>—</span>20</div>
        <div className="header-actions">
          <button className={`icon-button sound-icon-button ${showSound ? 'active' : ''}`} aria-label="Open focus music" title="Focus music" onClick={() => { setShowSound((value) => !value); setShowHelp(false); setShowJournal(false); }}><Volume2 size={18} /></button>
          <button className={`icon-button ${showHelp ? 'active' : ''}`} aria-label="Open how Blink works" title="How Blink works" onClick={() => { setShowHelp((value) => !value); setShowJournal(false); setShowSound(false); }}><HelpCircle size={18} /></button>
          <button className={`icon-button eye-icon-button ${showJournal ? 'active' : ''}`} aria-label="Open eye comfort journal" title="Eye comfort journal" onClick={() => { setShowJournal((value) => !value); setShowHelp(false); setShowSound(false); }}><span className="iris-mark"><Eye size={19} /></span></button>
          <button
            className={`menu-toggle ${mobileMenuOpen ? 'is-open' : ''}`}
            type="button"
            ref={menuToggleRef}
            aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-navigation"
            onClick={() => setMobileMenuOpen((value) => !value)}
          >
            <span className="menu-bars" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          </button>
        </div>
        <nav id="mobile-navigation" className={`mobile-nav ${mobileMenuOpen ? 'is-open' : ''}`} aria-label="Mobile navigation" aria-hidden={!mobileMenuOpen}>
          <div className="mobile-icon-nav">
            <button type="button" aria-label="Open focus music" title="Focus music" tabIndex={mobileMenuOpen ? 0 : -1} onClick={() => { setShowSound(true); setShowHelp(false); setShowJournal(false); closeMobileMenu(); }}><Volume2 size={18} /></button>
            <button type="button" aria-label="Open how Blink works" title="How Blink works" tabIndex={mobileMenuOpen ? 0 : -1} onClick={() => { setShowHelp(true); setShowJournal(false); setShowSound(false); closeMobileMenu(); }}><HelpCircle size={18} /></button>
            <button type="button" aria-label="Open eye comfort journal" title="Eye comfort journal" tabIndex={mobileMenuOpen ? 0 : -1} onClick={() => { setShowJournal(true); setShowHelp(false); setShowSound(false); closeMobileMenu(); }}><span className="iris-mark"><Eye size={18} /></span></button>
          </div>
        </nav>
      </header>

      <main>
        <section className="intro" aria-labelledby="page-title">
          <div>
            <p className="eyebrow">Vision care <span>/</span> daily rhythm</p>
            <h1 id="page-title">Give your eyes<br /><em>a well-deserved break.</em></h1>
          </div>
          <p className="intro-copy">A gentle, beautifully timed pause for the way you work.<br className="desktop-break" /> Blink keeps the 20-20-20 rule close, without getting in your way.</p>
        </section>

        {notice && <div className="live-notice" role="status" aria-live="polite" tabIndex="-1" ref={alertRef}><Sparkles size={16} />{notice}</div>}
        {isRest && <div className="rest-overlay" role="alertdialog" aria-labelledby="rest-title" aria-describedby="rest-description">
          <div className="rest-overlay-card">
            <div className="rest-overlay-eye" aria-hidden="true"><Eye size={42} /></div>
            <p className="eyebrow">20-second eye reset</p>
            <h2 id="rest-title">Look 20 meters away.</h2>
            <p id="rest-description">Let your gaze leave the screen. Soften your eyes, blink slowly, and look at something across the room.</p>
            <div className="rest-countdown"><strong>{formatTime(secondsLeft)}</strong><span>remaining</span></div>
            <p className="rest-overlay-note">Your focus session will continue automatically.</p>
          </div>
        </div>}

        {!showJournal && !showHelp && !showSound && <section id="timer" className="dashboard-grid">
          <article className={`timer-card ${isRest ? 'timer-card-rest' : ''}`}>
            <div className="timer-card-top">
              <div>
                <p className="phase-kicker">{isRest ? 'Your eyes are up next' : phase === 'stopped' ? 'A small reset, whenever you’re ready' : phase === 'paused' ? 'Your rhythm is paused' : 'In your focus flow'}</p>
                <h2>{isRest ? 'Look 20 feet away' : 'Stay with the moment'}</h2>
              </div>
              <span className={`phase-badge ${isRest ? 'teal' : ''}`}><span className="badge-dot" />{isRest ? 'Look away' : phase === 'stopped' ? 'Ready' : phase === 'paused' ? 'Paused' : 'Focus'}</span>
            </div>

            <div className="timer-center">
              <div className="timer-ring" style={{ '--progress': `${progress * 100}%` }}>
                <svg viewBox="0 0 320 320" aria-hidden="true">
                  <circle className="ring-track" cx="160" cy="160" r="142" />
                  <circle className="ring-progress" cx="160" cy="160" r="142" style={{ strokeDasharray: circumference, strokeDashoffset: circumference * (1 - progress) }} />
                </svg>
                <div className="timer-readout">
                  <span className="timer-label">{isRest ? 'REST' : 'FOCUS'}</span>
                  <strong>{formatTime(secondsLeft)}</strong>
                  <span className="timer-caption">{isRest ? 'breathe + soften' : phase === 'stopped' ? '20-minute focus' : phase === 'paused' ? 'ready to resume' : 'until your next pause'}</span>
                </div>
              </div>
            </div>

            <p className="timer-instruction">{isRest ? <>Let your gaze land on something <strong>across the room.</strong><br />About 6 meters is perfect.</> : <>We’ll let you know when it’s time<br className="desktop-break" /> to give your eyes some distance.</>}</p>

            <div className="timer-controls">
              <button className="primary-button" onClick={isRunning ? stop : start}><span>{isRunning ? <Pause size={17} /> : <Play size={17} fill="currentColor" />}</span>{isRunning ? 'Pause session' : phase === 'paused' ? 'Resume session' : 'Start session'}</button>
              <button className="secondary-button" onClick={reset} aria-label="Reset timer"><RotateCcw size={16} /> Reset</button>
            </div>
            <div className="timer-meta"><span>{nextReminder}</span><button className={`sound-meta ${showSound ? 'active' : ''}`} type="button" onClick={() => { setShowSound(true); setShowHelp(false); setShowJournal(false); }}><Volume2 size={14} /> Sound on</button></div>
            {isRunning && <div className="screen-time"><span>Screen time</span><strong>{formatTime(screenTime)}</strong></div>}
          </article>

          <aside className="side-rail">
            <div className="shortcut-panel" aria-label="Quick actions">
              <div className="shortcut-heading"><p className="eyebrow">Quick actions</p><span>Tap to make space</span></div>
              <div className="shortcut-grid">
                <button type="button" className="shortcut-card shortcut-focus" onClick={isRunning ? stop : start}><span className="shortcut-icon"><Eye size={17} /></span><strong>{isRunning ? 'Pause focus' : 'Focus mode'}</strong><small>{isRunning ? 'Take a pause' : 'Start a session'}</small></button>
                <button type="button" className="shortcut-card shortcut-rest" onClick={() => { setShowHelp(true); setShowJournal(false); setShowSound(false); }}><span className="shortcut-icon"><Coffee size={17} /></span><strong>Break mode</strong><small>Try a 20 sec reset</small></button>
                <button type="button" className="shortcut-card shortcut-sound" onClick={() => { setShowSound(true); setShowHelp(false); setShowJournal(false); }}><span className="shortcut-icon"><Bell size={17} /></span><strong>Reminders</strong><small>Sound is on</small></button>
                <button type="button" className="shortcut-card shortcut-exercise" onClick={() => { setShowJournal(true); setShowHelp(false); setShowSound(false); }}><span className="shortcut-icon"><Dumbbell size={17} /></span><strong>Eye exercises</strong><small>Gentle guidance</small></button>
              </div>
            </div>
            <div className="rule-panel">
              <div className="panel-heading"><div><p className="eyebrow">The simple rule</p><h2>20—20—20</h2></div><span className="leaf-mark">✦</span></div>
              <ol className="rule-list">
                <li><span>01</span><div><strong>Every 20 minutes</strong><small>Look up from your screen.</small></div></li>
                <li><span>02</span><div><strong>At least 20 feet</strong><small>Let your focus stretch.</small></div></li>
                <li><span>03</span><div><strong>For 20 seconds</strong><small>Give your eyes a true pause.</small></div></li>
              </ol>
            </div>
            <div className="rested-panel">
              <div className="rested-head"><div><p className="eyebrow">Daily progress</p><h3>Eyes rested</h3></div><span className="rested-count">{completed}<small> cycles</small></span></div>
              <div className="cycle-row" aria-label={`${completed} completed rest cycles`}>
                {[0, 1, 2, 3, 4, 5].map((item) => <span key={item} className={item < completed ? 'cycle done' : 'cycle'}>{item < completed ? '✓' : '·'}</span>)}
              </div>
              <p className="last-rest">Last pause <strong>{lastRest}</strong></p>
            </div>
          </aside>
        </section>}
        {showJournal && <section className="journal content-view" aria-labelledby="journal-title">
          <button type="button" className="content-back-button" aria-label="Back to timer" title="Back to timer" onClick={closeContentView}><ChevronLeft size={18} /><span>Back</span></button>
          <div className="journal-intro">
            <p className="eyebrow">The eye comfort journal</p>
            <h2 id="journal-title">Better screen days<br /><em>start with small pauses.</em></h2>
            <p>Eye comfort is less about a perfect setup and more about giving your visual system regular chances to soften, blink, and change distance.</p>
          </div>
          <div className="journal-grid">
            <article className="journal-feature"><div className="eye-illustration" aria-hidden="true"><Eye size={58} /></div><p className="eyebrow">01 / The simple science</p><h3>Why the 20-20-20 rhythm works</h3><p>Long stretches of near-focus can leave eyes feeling dry and tired. A short distance change gives your focus muscles a different job and creates a repeatable recovery cue.</p></article>
            <article className="journal-card"><p className="eyebrow">02 / Your workspace</p><h3>Make comfort easier to remember</h3><p>Keep your screen about an arm’s length away, reduce glare, and place the top edge near eye level. The best routine is the one your desk quietly supports.</p></article>
            <article className="journal-card coral-card"><p className="eyebrow">03 / A 90-second reset</p><h3>Soften your gaze</h3><p>Look across the room, blink slowly five times, drop your shoulders, and take one unhurried breath before returning to the next task.</p></article>
          </div>
        </section>}
        {showHelp && <section className="journal info-page content-view" aria-labelledby="help-title">
          <button type="button" className="content-back-button" aria-label="Back to timer" title="Back to timer" onClick={closeContentView}><ChevronLeft size={18} /><span>Back</span></button>
          <div className="journal-intro">
            <p className="eyebrow">The Blink method</p>
            <h2 id="help-title">A better rhythm<br /><em>for screen days.</em></h2>
            <p>Blink follows the 20-20-20 rule and turns it into a calm, repeatable habit that fits around your work.</p>
          </div>
          <div className="journal-grid">
            <article className="journal-feature"><div className="eye-illustration" aria-hidden="true"><HelpCircle size={58} /></div><p className="eyebrow">01 / Start</p><h3>Begin a focus session</h3><p>Choose Start session and keep working. Blink quietly tracks your rhythm until it is time to look away.</p></article>
            <article className="journal-card"><p className="eyebrow">02 / Pause</p><h3>Let your eyes travel</h3><p>Every 20 minutes, look at something around 20 feet away for 20 seconds. Soften your gaze and blink slowly.</p></article>
            <article className="journal-card coral-card"><p className="eyebrow">03 / Repeat</p><h3>Return refreshed</h3><p>Your next focus cycle starts automatically after the rest period, so healthy pauses become part of your day.</p></article>
          </div>
        </section>}
        {showSound && <section className="journal info-page content-view" aria-labelledby="sound-title">
          <button type="button" className="content-back-button" aria-label="Back to timer" title="Back to timer" onClick={closeContentView}><ChevronLeft size={18} /><span>Back</span></button>
          <div className="sound-picker" aria-label="Reminder sound">
            <div className="music-player">
              <div className="music-player-heading"><Volume2 size={19} /><strong>{currentTrack.name}</strong></div>
              <input className="music-progress" type="range" min="0" max="1" step="0.01" value={musicProgress} aria-label="Music progress" onChange={(event) => { const audio = reminderAudioRef.current; if (audio?.duration) { audio.currentTime = Number(event.target.value) * audio.duration; setMusicProgress(Number(event.target.value)); } }} />
              <div className="music-controls">
                <button type="button" aria-label="Previous track" onClick={() => changeTrack(-1)}><ChevronLeft size={18} /></button>
                <button type="button" className="sound-preview" aria-label={musicPlaying ? 'Pause music' : 'Play music'} onClick={toggleMusic}>{musicPlaying ? <Pause size={25} /> : <Play size={25} fill="currentColor" />}</button>
                <button type="button" aria-label="Next track" onClick={() => changeTrack(1)}><ChevronRight size={18} /></button>
              </div>
              <div className="music-options">
                <button type="button" aria-label={musicMuted ? 'Unmute music' : 'Mute music'} onClick={() => { setMusicMuted((value) => !value); if (reminderAudioRef.current) reminderAudioRef.current.muted = !musicMuted; }}><Volume2 size={15} /></button>
                <label className="music-volume"><input type="range" min="0" max="1" step="0.01" value={musicVolume} aria-label="Music volume" onChange={(event) => { const value = Number(event.target.value); setMusicVolume(value); if (reminderAudioRef.current) reminderAudioRef.current.volume = value; }} /></label>
                <button type="button" className={repeatTrack ? 'selected' : ''} aria-label="Toggle repeat" onClick={() => setRepeatTrack((value) => !value)}><Repeat2 size={15} /></button>
                <button type="button" className={shuffleTracks ? 'selected' : ''} aria-label="Toggle shuffle" onClick={() => setShuffleTracks((value) => !value)}><Shuffle size={15} /></button>
              </div>
            </div>
            <input ref={audioInputRef} className="sr-only" type="file" accept="audio/*" multiple onChange={handleAudioUpload} />
            <button type="button" className="upload-icon-button" aria-label="Upload ringtone" title="Upload ringtone" onClick={() => audioInputRef.current?.click()}><span>+</span></button>
          </div>
          <div className="track-list" aria-label="Available music">
            {tracks.map((track, index) => <div className={`track-item ${index === currentTrackIndex ? 'active' : ''}`} key={track.id}><button type="button" className="track-select" onClick={() => selectTrack(index)}><span>{index + 1}</span><strong>{track.name}</strong><small>{index === currentTrackIndex && musicPlaying ? 'Playing' : 'Select track'}</small></button><button type="button" className={`set-reminder ${track.id === reminderTrack.id ? 'selected' : ''}`} aria-label={`Set ${track.name} as reminder ringtone`} aria-pressed={track.id === reminderTrack.id} onClick={() => setAsReminder(track)}>{track.id === reminderTrack.id ? 'Reminder' : 'Set reminder'}</button>{index > 1 && <button type="button" className="track-remove" aria-label={`Remove ${track.name}`} onClick={() => removeTrack(index)}><X size={15} /></button>}</div>)}
          </div>
        </section>}
      </main>
      <nav className="mobile-bottom-nav" aria-label="Quick navigation">
        <a href="#timer" onClick={showTimer}><Home size={18} /><span>Home</span></a>
        <button type="button" onClick={() => { setShowJournal(true); setShowHelp(false); setShowSound(false); }}><BookOpen size={18} /><span>Journal</span></button>
        <button type="button" onClick={() => { setShowHelp(true); setShowJournal(false); setShowSound(false); }}><HelpCircle size={18} /><span>Learn</span></button>
      </nav>

      <footer><span>Made for the long-haul screen days.</span><span>Developed by Arbaz Ahmad Ansari · © 2026 Blink. All rights reserved.</span><span>This is a gentle reminder, not medical advice.</span></footer>
    </div>
  );
}

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    // Clear saved state so a bad saved session can't crash the app on every open.
    try {
      window.localStorage.removeItem(TIMER_STORAGE_KEY);
    } catch {
      // Storage unavailable; nothing to clear.
    }
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="app-shell" style={{ display: 'grid', placeItems: 'center', textAlign: 'center', padding: 24 }}>
        <div>
          <p>Something went wrong. Your timer has been reset.</p>
          <button type="button" className="primary-button" onClick={() => window.location.reload()}>Reload Blink</button>
        </div>
      </div>
    );
  }
}

createRoot(document.getElementById('root')).render(<ErrorBoundary><App /></ErrorBoundary>);
