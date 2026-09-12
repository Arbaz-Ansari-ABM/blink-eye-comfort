import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Eye, HelpCircle, Pause, Play, RotateCcw, Sparkles, Volume2 } from 'lucide-react';
import './styles.css';

const FOCUS_SECONDS = 20 * 60;
const REST_SECONDS = 20;
const TIMER_STORAGE_KEY = 'blink-timer-state';

function requestNotifications() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

function notify(title, body) {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, { body });
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
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [phase, setPhase] = useState(timerState?.phase || 'stopped');
  const [secondsLeft, setSecondsLeft] = useState(timerState?.secondsLeft || FOCUS_SECONDS);
  const [completed, setCompleted] = useState(timerState?.completed ?? 0);
  const [lastRest, setLastRest] = useState(timerState?.lastRest || 'Not yet today');
  const [endsAt, setEndsAt] = useState(timerState?.endsAt || null);
  const [screenTime, setScreenTime] = useState(timerState?.screenTime || 0);
  const [startedAt, setStartedAt] = useState(timerState?.startedAt || null);
  const [demoMode, setDemoMode] = useState(false);
  const [notice, setNotice] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  const [showJournal, setShowJournal] = useState(false);
  const alertRef = useRef(null);

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

  useEffect(() => {
    if (!isRunning || !endsAt) return undefined;
    const updateRemaining = () => {
      const remaining = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining === 0) setEndsAt(null);
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
  }, [isRunning, startedAt]);

  useEffect(() => {
    if (!isRunning || secondsLeft > 0) return undefined;
    if (phase === 'focus') {
      setPhase('rest');
      setSecondsLeft(REST_SECONDS);
      setEndsAt(Date.now() + REST_SECONDS * 1000);
      setNotice('Focus complete. Time to let your eyes travel across the room.');
      notify('Time to rest your eyes', 'Look 20 feet away for 20 seconds.');
      return undefined;
    }
    setCompleted((count) => count + 1);
    setLastRest(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
    setPhase('focus');
    setSecondsLeft(FOCUS_SECONDS);
    setEndsAt(Date.now() + FOCUS_SECONDS * 1000);
    setNotice('Rest complete. A fresh focus rhythm has begun.');
    notify('Focus time resumed', 'Your eyes are ready for another 20-minute cycle.');
    return undefined;
  }, [isRunning, phase, secondsLeft]);

  useEffect(() => {
    window.localStorage.setItem(TIMER_STORAGE_KEY, JSON.stringify({
      phase, secondsLeft, completed, lastRest, endsAt, screenTime, startedAt,
    }));
  }, [phase, secondsLeft, completed, lastRest, endsAt, screenTime, startedAt]);

  useEffect(() => {
    if (!notice) return undefined;
    const timeout = window.setTimeout(() => setNotice(''), 3000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const start = () => {
    const nextDuration = phase === 'rest' ? REST_SECONDS : FOCUS_SECONDS;
    if (phase === 'stopped') {
      setSecondsLeft(nextDuration);
      setScreenTime(0);
      setStartedAt(Date.now());
    }
    setEndsAt(Date.now() + nextDuration * 1000);
    setPhase(phase === 'rest' ? 'rest' : 'focus');
    setNotice('Blink is running. We’ll nudge you when it’s time to look away.');
    requestNotifications();
  };

  const stop = () => {
    setPhase('stopped');
    setSecondsLeft(FOCUS_SECONDS);
    setEndsAt(null);
    setStartedAt(null);
    setNotice('Session paused. Your next focus cycle is ready to begin.');
  };

  const previewRest = () => {
    setDemoMode((value) => !value);
    setPhase('rest');
    setSecondsLeft(REST_SECONDS);
    setEndsAt(null);
    setNotice('Preview mode: here’s what your eye rest will feel like.');
  };

  const reset = () => {
    setPhase('stopped');
    setSecondsLeft(FOCUS_SECONDS);
    setEndsAt(null);
    setScreenTime(0);
    setStartedAt(null);
    setNotice('Timer reset.');
  };

  return (
    <div className={`app-shell ${isRest ? 'rest-mode' : ''}`}>
      <header className="site-header">
        <a className="wordmark" href="/" aria-label="Blink home"><span className="wordmark-dot" />blink</a>
        <div className="signature" aria-label="Twenty twenty twenty rule">20<span>—</span>20<span>—</span>20</div>
        <div className="header-actions">
          <button className="icon-button" aria-label="How Blink works" onClick={() => setShowHelp((value) => !value)}><HelpCircle size={18} /></button>
          <button className={`icon-button ${showJournal ? 'active' : ''}`} aria-label="Open eye comfort journal" title="Eye comfort journal" onClick={() => setShowJournal((value) => !value)}><Eye size={18} /></button>
        </div>
      </header>

      <main>
        <section className="intro" aria-labelledby="page-title">
          <div>
            <p className="eyebrow">Vision care <span>/</span> daily rhythm</p>
            <h1 id="page-title">Give your eyes<br /><em>a better rhythm.</em></h1>
          </div>
          <p className="intro-copy">A gentle, beautifully timed pause for the way you work.<br className="desktop-break" /> Blink keeps the 20-20-20 rule close, without getting in your way.</p>
        </section>

        {showHelp && <div className="help-popover" role="dialog"><strong>How it works</strong><span>Every 20 minutes, Blink invites you to look 20 feet away for 20 seconds.</span></div>}
        {notice && <div className="live-notice" role="status" aria-live="polite" tabIndex="-1" ref={alertRef}><Sparkles size={16} />{notice}</div>}

        {!showJournal && <section className="dashboard-grid">
          <article className={`timer-card ${isRest ? 'timer-card-rest' : ''}`}>
            <div className="timer-card-top"><div><p className="phase-kicker">{isRest ? 'Your eyes are up next' : phase === 'stopped' ? 'A small reset, whenever you’re ready' : 'In your focus flow'}</p><h2>{isRest ? 'Look 20 feet away' : 'Stay with the moment'}</h2></div><span className={`phase-badge ${isRest ? 'teal' : ''}`}><span className="badge-dot" />{isRest ? 'Look away' : phase === 'stopped' ? 'Ready' : 'Focus'}</span></div>
            <div className="timer-center"><div className="timer-ring"><svg viewBox="0 0 320 320" aria-hidden="true"><circle className="ring-track" cx="160" cy="160" r="142" /><circle className="ring-progress" cx="160" cy="160" r="142" style={{ strokeDasharray: circumference, strokeDashoffset: circumference * (1 - progress) }} /></svg><div className="timer-readout"><span className="timer-label">{isRest ? 'REST' : 'FOCUS'}</span><strong>{formatTime(secondsLeft)}</strong><span className="timer-caption">{isRest ? 'breathe + soften' : phase === 'stopped' ? '20 minutes' : 'until your next pause'}</span></div></div></div>
            <p className="timer-instruction">{isRest ? <>Let your gaze land on something <strong>across the room.</strong><br />About 6 meters is perfect.</> : <>We’ll let you know when it’s time<br className="desktop-break" /> to give your eyes some distance.</>}</p>
            <div className="timer-controls"><button className="primary-button" onClick={isRunning ? stop : start}><span>{isRunning ? <Pause size={17} /> : <Play size={17} fill="currentColor" />}</span>{isRunning ? 'Stop session' : 'Start session'}</button><button className="secondary-button" onClick={reset} aria-label="Reset timer"><RotateCcw size={16} /> Reset</button></div>
            <div className="timer-meta"><span>{nextReminder}</span><span className="sound-meta"><Volume2 size={14} /> Sound on</span></div>
            {isRunning && <div className="screen-time"><span>Screen time</span><strong>{formatTime(screenTime)}</strong></div>}
          </article>
          <aside className="side-rail"><div className="rule-panel"><div className="panel-heading"><div><p className="eyebrow">The simple rule</p><h2>20—20—20</h2></div><span className="leaf-mark">✦</span></div><ol className="rule-list"><li><span>01</span><div><strong>Every 20 minutes</strong><small>Look up from your screen.</small></div></li><li><span>02</span><div><strong>At least 20 feet</strong><small>Let your focus stretch.</small></div></li><li><span>03</span><div><strong>For 20 seconds</strong><small>Give your eyes a true pause.</small></div></li></ol></div><div className="rested-panel"><div className="rested-head"><div><p className="eyebrow">Today’s rhythm</p><h3>Eyes rested</h3></div><span className="rested-count">{completed}<small> cycles</small></span></div><div className="cycle-row" aria-label={`${completed} completed rest cycles`}>{[0, 1, 2, 3, 4, 5].map((item) => <span key={item} className={item < completed ? 'cycle done' : 'cycle'}>{item < completed ? '✓' : '·'}</span>)}</div><p className="last-rest">Last pause <strong>{lastRest}</strong></p></div><button className={`preview-button ${demoMode ? 'active' : ''}`} onClick={previewRest}><Sparkles size={15} /> {demoMode ? 'Previewing rest state' : 'Preview a rest state'}</button></aside>
        </section>}
        {showJournal && <section className="journal" aria-labelledby="journal-title"><div className="journal-intro"><p className="eyebrow">The eye comfort journal</p><h2 id="journal-title">Better screen days<br /><em>start with small pauses.</em></h2><p>Eye comfort is less about a perfect setup and more about giving your visual system regular chances to soften, blink, and change distance.</p></div><div className="journal-grid"><article className="journal-feature"><div className="eye-illustration" aria-hidden="true"><Eye size={58} /></div><p className="eyebrow">01 / The simple science</p><h3>Why the 20-20-20 rhythm works</h3><p>Long stretches of near-focus can leave eyes feeling dry and tired. A short distance change gives your focus muscles a different job and creates a repeatable recovery cue.</p></article><article className="journal-card"><p className="eyebrow">02 / Your workspace</p><h3>Make comfort easier to remember</h3><p>Keep your screen about an arm’s length away, reduce glare, and place the top edge near eye level. The best routine is the one your desk quietly supports.</p></article><article className="journal-card coral-card"><p className="eyebrow">03 / A 90-second reset</p><h3>Soften your gaze</h3><p>Look across the room, blink slowly five times, drop your shoulders, and take one unhurried breath before returning to the next task.</p></article></div></section>}
      </main>

      <footer><span>Made for the long-haul screen days.</span><span>Developed by Arbaz Ahmad Ansari · © 2026 Blink. All rights reserved.</span><span>This is a gentle reminder, not medical advice.</span></footer>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
