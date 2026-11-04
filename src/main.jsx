import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { Bell, BookOpen, BarChart3, ChevronLeft, Dumbbell, ChevronDown, Coffee, Download, Eye, HelpCircle, Home, Pause, Play, RotateCcw, Settings, ShieldCheck, Smartphone, Sparkles, Square, Volume2, VolumeX } from 'lucide-react';
import './styles.css';
import { audioManager } from './audio/AudioManager.js';
import { FOCUS_SECONDS, REST_SECONDS, useRestTimer } from './audio/useRestTimer.js';
import { useSoundSettings } from './audio/useSoundSettings.js';
const SoundSettings = lazy(() => import('./audio/SoundSettings.jsx'));

function requestNotifications() {
  if ('Notification' in window && typeof Notification.requestPermission === 'function' && Notification.permission === 'default') {
    // Small delay so the user's tap gesture has settled and the dialog
    // feels intentional rather than an instant pop-up.
    setTimeout(() => Notification.requestPermission(), 600);
  }
}

function notify(title, body) {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, {
      body,
      silent: false,
      renotify: true,
      requireInteraction: true,
      tag: 'blink-break-alert',
    });
  }
}

function formatTime(total) {
  const minutes = Math.floor(total / 60).toString().padStart(2, '0');
  const seconds = (total % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function getFocusableElements(container) {
  return Array.from(container?.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  ) || []).filter((element) => element.getClientRects().length > 0);
}

const SETTINGS_KEY = 'blink-working-settings';
const DEFAULT_WORK_SETTINGS = {
  enabled: true, autoPause: true, start: '09:00', end: '18:00',
  days: [1, 2, 3, 4, 5], pauseWhenHidden: true,
};

function readWorkSettings() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(SETTINGS_KEY));
    return { ...DEFAULT_WORK_SETTINGS, ...(saved || {}) };
  } catch { return DEFAULT_WORK_SETTINGS; }
}

function WeeklyStats({ daily = {}, completed = 0 }) {
  const today = new Date();
  const monday = new Date(today);
  const offset = (today.getDay() + 6) % 7;
  monday.setDate(today.getDate() - offset);
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday); date.setDate(monday.getDate() + index);
    return {
      label: date.toLocaleDateString([], { weekday: 'short' }),
      count: daily[date.toISOString().slice(0, 10)] || 0,
      isToday: index === offset,
    };
  });
  const total = days.reduce((sum, day) => sum + day.count, 0);
  const max = Math.max(1, ...days.map((day) => day.count));
  // Keep the streak consecutive: today counts when active; otherwise use the
  // most recent completed day and stop at the first day without a break.
  let streak = 0;
  let streakIndex = days[offset].count ? offset : offset - 1;
  while (streakIndex >= 0 && days[streakIndex].count) {
    streak += 1;
    streakIndex -= 1;
  }
  return <section className="stats-panel" aria-labelledby="stats-title">
    <div className="panel-heading">
      <div>
        <p className="eyebrow">This week <span className="eyebrow-rule" aria-hidden="true" /></p>
        <h2 id="stats-title">Your eye-care rhythm</h2>
        <p className="stats-subtitle">A quiet view of the breaks that keep your focus sustainable.</p>
      </div>
      <span className="stats-icon" aria-hidden="true"><BarChart3 size={19} /></span>
    </div>
    <div className="stats-summary">
      <div><strong>{completed}</strong><span>All-time breaks</span></div>
      <div><strong>{total}</strong><span>This week</span></div>
      <div><strong>{streak}</strong><span>Day streak</span></div>
    </div>
    <div className="chart-heading"><span>Breaks by day</span><span>Mon — Sun</span></div>
    <div className="bar-chart" aria-label="Completed breaks Monday to Sunday">
      <div className="chart-baseline" aria-hidden="true" />
      {days.map((day) => <div className={`bar-column${day.isToday ? ' is-today' : ''}`} key={day.label}>
        <span className="bar-value">{day.count}</span>
        <div className="bar-track"><i style={{ height: `${day.count ? Math.max(5, day.count / max * 100) : 0}%` }} /></div>
        <small>{day.label}</small>
      </div>)}
    </div>
  </section>;
}

function WorkSettings({ settings, onChange, onClose }) {
  const toggleDay = (day) => onChange({ days: settings.days.includes(day) ? settings.days.filter((item) => item !== day) : [...settings.days, day].sort() });
  return <section className="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title">
    <div className="panel-heading"><div><p className="eyebrow">Personal rhythm</p><h2 id="settings-title">Working hours</h2></div><button className="ss-close" type="button" onClick={onClose} aria-label="Close settings">×</button></div>
    <p className="settings-copy">Set your office timing</p>
    <label className="settings-switch"><span><strong>Working schedule</strong><small>Pause reminders outside your schedule</small></span><input type="checkbox" checked={settings.enabled} onChange={(event) => onChange({ enabled: event.target.checked })} /></label>
    <div className="time-grid"><label>Work starts<input type="time" value={settings.start} onChange={(event) => onChange({ start: event.target.value })} /></label><label>Work ends<input type="time" value={settings.end} onChange={(event) => onChange({ end: event.target.value })} /></label></div>
    <fieldset className="day-picker"><legend>Working days</legend>{[['M',1],['T',2],['W',3],['T',4],['F',5],['S',6],['S',0]].map(([label, day]) => <button key={`${label}-${day}`} type="button" className={settings.days.includes(day) ? 'selected' : ''} onClick={() => toggleDay(day)} aria-pressed={settings.days.includes(day)}>{label}</button>)}</fieldset>
  </section>;
}

function App() {
  const sound = useSoundSettings(audioManager);
  const audioState = useSyncExternalStore(audioManager.subscribe, audioManager.getSnapshot);
  const [notice, setNotice] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  const [showJournal, setShowJournal] = useState(false);
  const [showSound, setShowSound] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [workSettings, setWorkSettings] = useState(readWorkSettings);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const alertRef = useRef(null);
  const restDialogRef = useRef(null);
  const restReturnFocusRef = useRef(null);
  const menuToggleRef = useRef(null);
  const soundDialogRef = useRef(null);
  const soundReturnFocusRef = useRef(null);
  const helpDialogRef = useRef(null);
  const journalDialogRef = useRef(null);
  const helpReturnFocusRef = useRef(null);
  const journalReturnFocusRef = useRef(null);
  const headerRef = useRef(null);

  const handleTimerEvent = useCallback((type) => {
    if (type === 'started') setNotice('Blink is running. We’ll nudge you when it’s time to look away.');
    if (type === 'resumed') setNotice('Session resumed.');
    if (type === 'paused') setNotice('Session paused. Your next focus cycle is ready to begin.');
    if (type === 'reset' || type === 'paused') {
      if (navigator.vibrate) navigator.vibrate(0);
    }
    if (type === 'focus-complete') {
      setNotice('Focus complete. Time to let your eyes travel across the room.');
      if (sound.settings.enabled && navigator.vibrate) navigator.vibrate([180, 90, 180]);
      notify('Time to rest your eyes', 'Look 20 feet away for 20 seconds.');
    }
    if (type === 'rest-complete') {
      if (navigator.vibrate) navigator.vibrate(0);
      setNotice('Rest complete. A fresh focus rhythm has begun.');
      notify('Focus time resumed', 'Your eyes are ready for another 20-minute cycle.');
    }
  }, [sound.settings.enabled]);

  const {
    phase, pausedFrom, secondsLeft, completed, daily, lastRest, screenTime, isRunning, isRest, start, pause, reset, stopSound,
  } = useRestTimer({ audio: audioManager, onEvent: handleTimerEvent, pauseWhenHidden: true });
  const restOverlayActive = isRest || (phase === 'paused' && pausedFrom === 'rest');

  useEffect(() => {
    try { window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(workSettings)); } catch (error) { console.warn('[Blink] settings could not be saved', error); }
  }, [workSettings]);

  useEffect(() => {
    const handler = (event) => { event.preventDefault(); setInstallPrompt(event); };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleStart = () => {
    requestNotifications();
    audioManager.armForAlerts?.();
    start();
  };
  const duration = isRest ? REST_SECONDS : FOCUS_SECONDS;
  const progress = Math.max(0, Math.min(1, 1 - secondsLeft / duration));
  const circumference = 2 * Math.PI * 142;
  const soundLabel = sound.settings.enabled ? 'Sound on' : 'Sound off';
  const nextReminder = useMemo(() => {
    if (!isRunning) return 'Ready when you are';
    const date = new Date(Date.now() + secondsLeft * 1000);
    return `Next reminder · ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  }, [isRunning, secondsLeft]);

  useEffect(() => {
    if (!restOverlayActive) return undefined;
    const onKeyDown = (event) => {
      if (event.key.toLowerCase() !== 'm' || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
      event.preventDefault();
      const nextEnabled = !sound.settings.enabled;
      sound.update({ enabled: nextEnabled });
      if (nextEnabled) {
        audioManager.startRestTune({ totalSec: REST_SECONDS, elapsedSec: REST_SECONDS - secondsLeft });
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [restOverlayActive, secondsLeft, sound]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return undefined;
    if (restOverlayActive) {
      try {
        if ('MediaMetadata' in window) {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: 'Blink eye rest',
            artist: 'Look away for 20 seconds',
            album: 'Blink 20-20-20',
          });
        }
        navigator.mediaSession.playbackState = isRest ? 'playing' : 'paused';
        navigator.mediaSession.setActionHandler?.('pause', pause);
        navigator.mediaSession.setActionHandler?.('play', start);
        navigator.mediaSession.setActionHandler?.('stop', pause);
      } catch (error) {
        console.warn('[Blink] Media Session controls unavailable', error);
      }
    } else {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = 'none';
    }
    return () => {
      try {
        navigator.mediaSession.setActionHandler?.('pause', null);
        navigator.mediaSession.setActionHandler?.('play', null);
        navigator.mediaSession.setActionHandler?.('stop', null);
      } catch (error) {
        console.warn('[Blink] Media Session cleanup failed', error);
      }
    };
  }, [isRest, pause, restOverlayActive, start]);

  const toggleBreakSound = () => {
    const nextEnabled = !sound.settings.enabled;
    sound.update({ enabled: nextEnabled });
    if (nextEnabled) {
      audioManager.startRestTune({ totalSec: REST_SECONDS, elapsedSec: REST_SECONDS - secondsLeft });
    }
  };

  useEffect(() => {
    if (!notice) return undefined;
    const timeout = window.setTimeout(() => setNotice(''), 3000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    if (audioState.blocked) setNotice('Sound is waiting for a tap. Tap anywhere to enable it.');
  }, [audioState.blocked]);

  useEffect(() => {
    if (!restOverlayActive) {
      const returnFocus = restReturnFocusRef.current;
      if (returnFocus && typeof returnFocus.focus === 'function') returnFocus.focus();
      restReturnFocusRef.current = null;
      return undefined;
    }
    restReturnFocusRef.current = document.activeElement;
    const focusFrame = window.requestAnimationFrame(() => restDialogRef.current?.focus());
    const trapFocus = (event) => {
      if (event.key !== 'Tab') return;
      event.preventDefault();
      restDialogRef.current?.focus();
    };
    document.addEventListener('keydown', trapFocus);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', trapFocus);
    };
  }, [restOverlayActive]);

  useEffect(() => {
    if (!mobileMenuOpen) return undefined;
    const focusFrame = window.requestAnimationFrame(() => {
      getFocusableElements(document.getElementById('mobile-navigation'))[0]?.focus();
    });
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') closeMobileMenu();
    };
    const trapFocus = (event) => {
      if (event.key !== 'Tab') return;
      const focusable = getFocusableElements(document.getElementById('mobile-navigation'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    window.addEventListener('keydown', trapFocus);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('keydown', trapFocus);
    };
  }, [mobileMenuOpen]);

  useEffect(() => {
    if (!showSound) {
      const returnFocus = soundReturnFocusRef.current;
      if (returnFocus && typeof returnFocus.focus === 'function') returnFocus.focus();
      soundReturnFocusRef.current = null;
      return undefined;
    }
    soundReturnFocusRef.current = document.activeElement;
    const focusFrame = window.requestAnimationFrame(() => soundDialogRef.current?.focus());
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') closeContentView();
    };
    const trapFocus = (event) => {
      if (event.key !== 'Tab') return;
      const focusable = getFocusableElements(soundDialogRef.current);
      if (!focusable.length) {
        event.preventDefault();
        soundDialogRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === soundDialogRef.current) {
        event.preventDefault();
        last.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    window.addEventListener('keydown', trapFocus);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('keydown', trapFocus);
    };
  }, [showSound]);

  useEffect(() => {
    if (!showHelp) {
      const returnFocus = helpReturnFocusRef.current;
      if (returnFocus && typeof returnFocus.focus === 'function') returnFocus.focus();
      helpReturnFocusRef.current = null;
      return undefined;
    }
    helpReturnFocusRef.current = document.activeElement;
    const focusFrame = window.requestAnimationFrame(() => helpDialogRef.current?.focus());
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') closeContentView();
    };
    const trapFocus = (event) => {
      if (event.key !== 'Tab') return;
      const focusable = getFocusableElements(helpDialogRef.current);
      if (!focusable.length) {
        event.preventDefault();
        helpDialogRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === helpDialogRef.current) {
        event.preventDefault();
        last.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    window.addEventListener('keydown', trapFocus);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('keydown', trapFocus);
    };
  }, [showHelp]);


  useEffect(() => {
    if (!showJournal) {
      const returnFocus = journalReturnFocusRef.current;
      if (returnFocus && typeof returnFocus.focus === 'function') returnFocus.focus();
      journalReturnFocusRef.current = null;
      return undefined;
    }
    journalReturnFocusRef.current = document.activeElement;
    const focusFrame = window.requestAnimationFrame(() => journalDialogRef.current?.focus());
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') closeContentView();
    };
    const trapFocus = (event) => {
      if (event.key !== 'Tab') return;
      const focusable = getFocusableElements(journalDialogRef.current);
      if (!focusable.length) {
        event.preventDefault();
        journalDialogRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === journalDialogRef.current) {
        event.preventDefault();
        last.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    window.addEventListener('keydown', trapFocus);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('keydown', trapFocus);
    };
  }, [showJournal]);

  useEffect(() => {
    document.body.classList.toggle('menu-open', mobileMenuOpen || showSound || showHelp || showJournal || showSettings);
    return () => {
      document.body.classList.remove('menu-open');
    };
  }, [mobileMenuOpen, showSound, showHelp, showJournal]);

  useEffect(() => {
    if (!mobileMenuOpen) return undefined;
    const closeOnOutsideClick = (event) => {
      const clickedHeader = headerRef.current?.contains(event.target);
      const clickedNavigation = document.getElementById('mobile-navigation')?.contains(event.target);
      if (!clickedHeader && !clickedNavigation) closeMobileMenu();
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

  const scrollToPwa = (event) => {
    event.preventDefault();
    closeContentView(); // the PWA section is hidden while a panel is open
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      const target = document.getElementById('get-pwa');
      if (!target) return;
      const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
      target.focus({ preventScroll: true });
    }));
  };

  return (
    <div className={`app-shell ${isRest ? 'rest-mode' : ''}`}>
      <header className="site-header" ref={headerRef}>
        <a className="wordmark" href="/" aria-label="Blink home"><span className="wordmark-dot" />blink</a>
        <div className="signature" aria-label="Twenty twenty twenty rule">20<span>—</span>20<span>—</span>20</div>
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
        <div className="header-actions">
          <button className={`icon-button sound-icon-button ${showSound ? 'active' : ''}`} aria-label="Open sound settings" title="Sound settings" onClick={() => { setShowSound((value) => !value); setShowHelp(false); setShowJournal(false); }}><Volume2 size={18} /></button>
          <button className={`icon-button ${showHelp ? 'active' : ''}`} aria-label="Open how Blink works" title="How Blink works" onClick={() => { setShowHelp((value) => !value); setShowJournal(false); setShowSound(false); }}><HelpCircle size={18} /></button>
          <button className={`icon-button eye-icon-button ${showJournal ? 'active' : ''}`} aria-label="Open eye comfort journal" title="Eye comfort journal" onClick={() => { setShowJournal((value) => !value); setShowHelp(false); setShowSound(false); setShowSettings(false); }}><span className="iris-mark"><Eye size={19} /></span></button>
          <button className={`icon-button ${showSettings ? 'active' : ''}`} aria-label="Open working hours settings" title="Working hours" onClick={() => { setShowSettings((value) => !value); setShowHelp(false); setShowJournal(false); setShowSound(false); }}><Settings size={18} /></button>
        </div>
      </header>
      <nav id="mobile-navigation" className={`mobile-nav ${mobileMenuOpen ? 'is-open' : ''}`} aria-label="Mobile navigation" aria-hidden={!mobileMenuOpen}>
        <button className="mobile-nav-backdrop" type="button" aria-label="Close navigation menu" tabIndex={mobileMenuOpen ? 0 : -1} onClick={closeMobileMenu} />
        <div className="mobile-icon-nav">
          <button type="button" aria-label="Open sound settings" title="Sound settings" tabIndex={mobileMenuOpen ? 0 : -1} onClick={() => { setShowSound(true); setShowHelp(false); setShowJournal(false); closeMobileMenu(); }}><Volume2 size={18} /><span className="mobile-nav-label">Sound</span></button>
          <button type="button" aria-label="Open how Blink works" title="How Blink works" tabIndex={mobileMenuOpen ? 0 : -1} onClick={() => { setShowHelp(true); setShowJournal(false); setShowSound(false); closeMobileMenu(); }}><HelpCircle size={18} /><span className="mobile-nav-label">Learn</span></button>
          <button type="button" aria-label="Open eye comfort journal" title="Eye comfort journal" tabIndex={mobileMenuOpen ? 0 : -1} onClick={() => { setShowJournal(true); setShowHelp(false); setShowSound(false); closeMobileMenu(); }}><span className="iris-mark"><Eye size={18} /></span><span className="mobile-nav-label">Journal</span></button>
        </div>
      </nav>

      <main>
        <section className="intro" aria-labelledby="page-title">
          <div>
            <p className="eyebrow">Vision care <span>/</span> daily rhythm</p>
            <h1 id="page-title">Give your eyes<br /><em>a well-deserved break.</em></h1>
          </div>
          <div className="intro-side">
            <a className="apk-callout" href="#get-pwa" onClick={scrollToPwa} aria-label="Scroll down to learn about the Blink PWA">
              <span className="apk-callout-icon" aria-hidden="true"><Smartphone size={20} /></span>
              <span className="apk-callout-copy"><strong>Scroll down to explore the PWA</strong><small>Install Blink on your device</small></span>
              <span className="apk-callout-go" aria-hidden="true"><ChevronDown size={18} /></span>
            </a>
            <p className="intro-copy">A gentle, beautifully timed pause for the way you work.<br className="desktop-break" /> Blink keeps the 20-20-20 rule close, without getting in your way.</p>
          </div>
        </section>

        {notice && <div className="live-notice" role="status" aria-live="polite" tabIndex="-1" ref={alertRef}><Sparkles size={16} />{notice}</div>}
        {restOverlayActive && <div className="rest-overlay" role="alertdialog" aria-modal="true" aria-labelledby="rest-title" aria-describedby="rest-description">
          <div className="rest-overlay-card" ref={restDialogRef} tabIndex="-1">
            <div className="rest-overlay-eye" aria-hidden="true"><Eye size={42} /></div>
            <p className="eyebrow">20-second eye reset</p>
            <h2 id="rest-title">Look 20 meters away.</h2>
            <p id="rest-description">Let your gaze leave the screen. Soften your eyes, blink slowly, and look at something across the room.</p>
            <div className="rest-countdown"><strong>{formatTime(secondsLeft)}</strong><span>{isRest ? 'remaining' : 'paused'}</span></div>
            <div className="rest-overlay-actions"><button type="button" className="primary-button" onClick={isRest ? pause : start}>{isRest ? <><Pause size={17} /> Pause</> : <><Play size={17} /> Resume</>}</button>{isRest && <button type="button" className="secondary-button rest-sound-stop" onClick={stopSound} aria-label="Stop ringing music" title="Stop ringing music"><VolumeX size={17} /> Stop music</button>}<button type="button" className="secondary-button rest-sound-toggle" onClick={toggleBreakSound} aria-label={sound.settings.enabled ? 'Mute music' : 'Unmute music'} title={sound.settings.enabled ? 'Mute music (M)' : 'Unmute music (M)'}>{sound.settings.enabled ? <Volume2 size={17} /> : <VolumeX size={17} />}</button></div>
            <p className="rest-overlay-note">Your focus session will continue automatically.</p>
          </div>
        </div>}

        {!showJournal && !showHelp && !showSound && !showSettings && (
          <>
            <section id="timer" className="dashboard-grid">
          <article className={`timer-card ${isRest ? 'timer-card-rest' : ''}`}>
            <div className="timer-card-top">
              <div>
                <p className="phase-kicker">{isRest ? 'Your eyes are up next' : phase === 'stopped' ? 'A small reset, whenever you’re ready' : phase === 'paused' ? 'Your rhythm is paused' : 'In your focus flow'}</p>
                <h2>{isRest ? 'Look 20 feet away' : 'Stay with the moment'}</h2>
              </div>
              <span className={`phase-badge ${isRest ? 'teal' : phase === 'paused' ? 'paused' : ''}`}><span className="badge-dot" />{isRest ? 'Look away' : phase === 'stopped' ? 'Ready' : phase === 'paused' ? 'Paused' : 'Focus'}</span><span className={`timer-status ${isRunning ? 'is-running' : ''}`}><span className="badge-dot" />{isRunning ? 'Running' : 'Paused'}</span>
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
              <button className="primary-button" onClick={isRunning ? pause : handleStart}><span>{isRunning ? <Pause size={17} /> : <Play size={17} fill="currentColor" />}</span>{isRunning ? 'Pause session' : phase === 'paused' ? 'Resume session' : 'Start session'}</button>
              <button className="secondary-button" onClick={reset} aria-label="Reset timer"><RotateCcw size={16} /> Reset</button>
            </div>
            <div className="timer-meta"><span>{nextReminder}</span><button className={`sound-meta ${showSound ? 'active' : ''}`} type="button" onClick={() => { setShowSound(true); setShowHelp(false); setShowJournal(false); }}><Volume2 size={14} /> {soundLabel}</button></div>
            {isRunning && <div className="screen-time"><span>Screen time</span><strong>{formatTime(screenTime)}</strong></div>}
          </article>

          <aside className="side-rail">
            <div className="shortcut-panel" aria-label="Quick actions">
              <div className="shortcut-heading"><p className="eyebrow">Quick actions</p><span>Tap to make space</span></div>
              <div className="shortcut-grid">
                <button type="button" className="shortcut-card shortcut-focus" onClick={isRunning ? pause : handleStart}><span className="shortcut-icon"><Eye size={17} /></span><strong>{isRunning ? 'Pause focus' : 'Focus mode'}</strong><small>{isRunning ? 'Take a pause' : 'Start a session'}</small></button>
                <button type="button" className="shortcut-card shortcut-rest" onClick={() => { setShowHelp(true); setShowJournal(false); setShowSound(false); }}><span className="shortcut-icon"><Coffee size={17} /></span><strong>Break mode</strong><small>Try a 20 sec reset</small></button>
                <button type="button" className="shortcut-card shortcut-sound" onClick={() => { setShowSound(true); setShowHelp(false); setShowJournal(false); }}><span className="shortcut-icon"><Bell size={17} /></span><strong>Reminders</strong><small>{sound.settings.enabled ? 'Sound is on' : 'Sound is off'}</small></button>
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
        </section>
        <WeeklyStats daily={daily} completed={completed} />
          </>
        )}
        {showSettings && <WorkSettings settings={workSettings} onChange={(patch) => setWorkSettings((current) => ({ ...current, ...patch }))} onClose={() => setShowSettings(false)} />}

        {/* The hero callout scrolls here to explain the installable PWA. */}
        {!showJournal && !showHelp && !showSound && (
        <section id="get-pwa" className="app-download-section" aria-labelledby="pwa-title" tabIndex={-1}>
          <div className="download-card">
            <div className="download-content">
              <p className="eyebrow">Progressive Web App (PWA) <span>/</span> Installable web app</p>
              <div className="apk-identity">
                <span className="apk-icon" aria-hidden="true"><Eye size={26} /></span>
                <div><strong>Blink</strong><small>20—20—20 eye-care timer</small></div>
                
              </div>
              <div><strong>What is PWA?</strong><br /><small> PWA (Progressive Web App) is a website that can be installed and used like a native mobile app, without downloading it from the Play Store.</small></div><br />
              <h2 id="pwa-title">Use Blink as a PWA</h2>
              <p className="download-copy">Install Blink directly from your browser for a focused, app-like experience. Your timer and settings stay on this device.</p>
              <div className="download-actions">
                <span className="download-badge">
                  <Smartphone size={14} className="badge-icon" />
                  <span>Install from browser</span>
                </span>
                <span className="download-badge">APK coming soon</span>
              </div>
              <dl className="apk-facts">
                <div><dt>Works on</dt><dd>Desktop & mobile</dd></div>
                <div><dt>Offline</dt><dd>App shell cached</dd></div>
                <div><dt>Data</dt><dd>Stays on device</dd></div>
              </dl>
            </div>
            <div className="download-visual" aria-hidden="true">
              <div className="phone-mockup">
                <div className="phone-screen">
                  <span className="phone-dot" />
                  <div className="phone-eye"><Eye size={28} /></div>
                  <span className="phone-title">Blink</span>
                  <span className="phone-subtitle">20 — 20 — 20</span>
                </div>
              </div>
            </div>
          </div>
          <div className="apk-guide">
            <div className="apk-steps-card">
              <p className="eyebrow">How to install the PWA</p>
              <ol className="apk-steps">
                <li><span>1</span><div><strong>Open Blink in a supported browser</strong><small>Use the deployed HTTPS website in Chrome, Edge, Safari, or another browser with PWA support.</small></div></li>
                <li><span>2</span><div><strong>Choose Install or Add to Home Screen</strong><small>Use your browser’s install option to add Blink to your desktop or home screen.</small></div></li>
                <li><span>3</span><div><strong>Open Blink like an app</strong><small>The standalone window keeps the timer focused and the app shell remains available offline after the first load.</small></div></li>
              </ol>
            </div>
            <aside className="apk-note">
              <ShieldCheck size={22} aria-hidden="true" />
              <div>
                <strong>A calm, private install</strong>
                <p>Blink’s PWA uses the browser’s standard install flow. No app-store download is needed, and your timer settings remain stored locally on this device.</p>
              </div>
            </aside>
          </div>
        </section>
        )}
        {showJournal && <section className="journal content-view sound-view" ref={journalDialogRef} tabIndex="-1" role="dialog" aria-modal="true" aria-labelledby="journal-title">
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
        {showHelp && <section className="journal info-page content-view sound-view" ref={helpDialogRef} tabIndex="-1" role="dialog" aria-modal="true" aria-labelledby="help-title">
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
        <button className={`drawer-backdrop ${showSound || showHelp || showJournal || showSettings ? 'is-open' : ''}`} type="button" aria-hidden={!showSound && !showHelp && !showJournal && !showSettings} tabIndex={(showSound || showHelp || showJournal || showSettings) ? 0 : -1} aria-label="Close panel" onClick={() => { closeContentView(); setShowSettings(false); }} />
        {showSound && (
          <Suspense fallback={null}>
            <SoundSettings audio={audioManager} sound={sound} onClose={closeContentView} sectionRef={soundDialogRef} />
          </Suspense>
        )}
      </main>
      <nav className="mobile-bottom-nav" aria-label="Quick navigation">
        <a href="#timer" onClick={showTimer}><Home size={18} /><span>Home</span></a>
        <button type="button" onClick={() => { setShowJournal(true); setShowHelp(false); setShowSound(false); }}><BookOpen size={18} /><span>Journal</span></button>
        <button type="button" onClick={() => { setShowHelp(true); setShowJournal(false); setShowSound(false); }}><HelpCircle size={18} /><span>Learn</span></button>
      </nav>

      {!showJournal && !showHelp && !showSound && !showSettings && <footer><span>Made for the long-haul screen days. · Developed by Arbaz Ahmad Ansari · © 2026 Blink.</span>{installPrompt && <button className="install-button" type="button" onClick={async () => { installPrompt.prompt(); await installPrompt.userChoice; setInstallPrompt(null); }}><Download size={15} /> Install Blink</button>}</footer>}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.error('[Blink] Service worker registration failed', error);
    });
  });
}
