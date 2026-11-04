import { useCallback, useEffect, useRef, useState } from 'react';

export const FOCUS_SECONDS = 20 * 60;
export const REST_SECONDS = 20;
const STORAGE_KEY = 'blink-timer-state';
const TICK_MS = 250;
const AWAY_RESET_MS = 5 * 60 * 1000;

const dayKey = (timestamp) => new Date(timestamp).toISOString().slice(0, 10);
const emptyDaily = () => ({});

const timeLabel = () => new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

function loadInitial(now = Date.now()) {
  const base = {
    phase: 'stopped', pausedFrom: null, pausedAt: null, secondsLeft: FOCUS_SECONDS, endsAt: null,
    completed: 0, totalCompletedBreaks: 0, lastRest: 'Not yet today', screenTime: 0, startedAt: null,
    breakStartAt: null, lastActiveAt: now, hiddenPaused: false, daily: emptyDaily(), weekly: {},
  };
  let saved = null;
  try { saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY)); } catch { saved = null; }
  if (!saved || typeof saved !== 'object') return base;
  const state = { ...base };
  Object.keys(base).forEach((key) => { if (saved[key] !== undefined && saved[key] !== null) state[key] = saved[key]; });
  if (!['stopped', 'focus', 'rest', 'paused'].includes(state.phase)) return base;
  if (state.phase === 'focus' || state.phase === 'rest') {
    const awayFor = now - (state.lastActiveAt || now);
    if (awayFor >= AWAY_RESET_MS) {
      return { ...base, completed: state.completed, totalCompletedBreaks: state.totalCompletedBreaks, lastRest: state.lastRest, daily: state.daily, weekly: state.weekly };
    }
    state.pausedFrom = state.phase;
    state.phase = 'paused';
    state.pausedAt = now;
    state.endsAt = null;
    state.hiddenPaused = true;
    state.secondsLeft = Math.max(1, state.secondsLeft);
  }
  if (state.hiddenPaused && state.pausedAt && now - state.pausedAt >= AWAY_RESET_MS) {
    return { ...base, completed: state.completed, totalCompletedBreaks: state.totalCompletedBreaks, lastRest: state.lastRest, daily: state.daily, weekly: state.weekly };
  }
  if (state.phase === 'paused' && !state.pausedFrom) state.pausedFrom = 'focus';
  if (!state.daily || typeof state.daily !== 'object') state.daily = emptyDaily();
  if (!state.weekly || typeof state.weekly !== 'object') state.weekly = {};
  return state;
}

/**
 * Focus/rest timer.
 *  - Timestamp based: remaining time is always (endsAt - Date.now()), so throttled or
 *    suspended timers (background tab, WebView) never make it drift.
 *  - Phase transitions run exactly once per phase (guarded by `handledRef`).
 *  - The selected ringtone plays only while the 20 s rest runs, and is stopped the moment it ends.
 * onEvent(type): 'started' | 'resumed' | 'paused' | 'reset' | 'focus-complete' | 'rest-complete'
 */
export function useRestTimer({ audio, onEvent, pauseWhenHidden = true }) {
  const [state, setState] = useState(() => loadInitial());
  const stateRef = useRef(state);
  const handledRef = useRef(null);
  const wakeLockRef = useRef(null);
  const hiddenPauseTimerRef = useRef(null);
  const lastTickAtRef = useRef(typeof performance !== 'undefined' ? performance.now() : Date.now());
  const eventRef = useRef(onEvent);
  eventRef.current = onEvent;

  const commit = useCallback((patch) => {
    const nextState = { ...stateRef.current, ...patch };
    stateRef.current = nextState;
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState)); } catch { /* storage denied */ }
    setState(nextState);
  }, []);

  const emit = useCallback((type) => {
    try { if (eventRef.current) eventRef.current(type); } catch (error) { console.error('[Blink timer] event handler failed', error); }
  }, []);

  const tick = useCallback(() => {
    const s = stateRef.current;
    if (s.phase !== 'focus' && s.phase !== 'rest') return;
    const now = Date.now();
    lastTickAtRef.current = typeof performance !== 'undefined' ? performance.now() : now;
    const remainingMs = s.endsAt - now;
    const screenTime = s.startedAt ? Math.max(0, Math.floor((now - s.startedAt) / 1000)) : s.screenTime;
    if (remainingMs > 0) {
      const secondsLeft = Math.ceil(remainingMs / 1000);
      if (secondsLeft !== s.secondsLeft || screenTime !== s.screenTime) commit({ secondsLeft, screenTime, lastActiveAt: now });
      return;
    }
    if (handledRef.current === s.endsAt) return; // already handled this phase end
    handledRef.current = s.endsAt;

    if (s.phase === 'focus') {
      commit({ phase: 'rest', secondsLeft: REST_SECONDS, endsAt: now + REST_SECONDS * 1000, breakStartAt: now, screenTime });
      audio.startRestTune({ totalSec: REST_SECONDS, elapsedSec: 0 });
      emit('focus-complete');
      return;
    }
    // Rest finished: the ringtone only plays during the rest, so it stops right now.
    audio.stopRestTune();
    const key = dayKey(now);
    const daily = { ...s.daily, [key]: (s.daily[key] || 0) + 1 };
    commit({
      phase: 'focus', secondsLeft: FOCUS_SECONDS, endsAt: now + FOCUS_SECONDS * 1000,
      completed: s.completed + 1, totalCompletedBreaks: (s.totalCompletedBreaks || s.completed) + 1,
      daily, lastRest: timeLabel(), screenTime, breakStartAt: null, lastActiveAt: now,
    });
    emit('rest-complete');
  }, [audio, commit, emit]);

  const isRunning = state.phase === 'focus' || state.phase === 'rest';
  const isRest = state.phase === 'rest';

  useEffect(() => {
    if (isRunning) tick();
    const timer = isRunning ? window.setInterval(tick, TICK_MS) : null;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (hiddenPauseTimerRef.current) {
        window.clearTimeout(hiddenPauseTimerRef.current);
        hiddenPauseTimerRef.current = null;
      }
      const current = stateRef.current;
      const now = Date.now();
      const awayFor = now - (current.pausedAt || current.lastActiveAt || now);
      if (current.hiddenPaused && awayFor >= AWAY_RESET_MS) {
        audio.stopAll();
        handledRef.current = null;
        commit({
          phase: 'stopped', pausedFrom: null, pausedAt: null, secondsLeft: FOCUS_SECONDS,
          endsAt: null, startedAt: null, screenTime: 0,
          breakStartAt: null, lastActiveAt: now, hiddenPaused: false,
        });
        emit('reset');
      } else if (current.hiddenPaused) {
        const phase = current.pausedFrom || 'focus';
        const remaining = Math.max(1, current.secondsLeft);
        commit({
          phase, endsAt: now + remaining * 1000, pausedFrom: null, pausedAt: null,
          hiddenPaused: false, lastActiveAt: now,
          startedAt: current.startedAt ? current.startedAt + awayFor : now,
        });
        if (phase === 'rest') {
          audio.startRestTune({ totalSec: REST_SECONDS, elapsedSec: REST_SECONDS - remaining });
        }
        emit('resumed');
      } else {
        commit({ lastActiveAt: Date.now() });
        tick();
      }
    };
    const onHidden = () => {
      if (document.visibilityState !== 'hidden') return;
      const current = stateRef.current;
      if (!pauseWhenHidden || (current.phase !== 'focus' && current.phase !== 'rest')) return;
      if (hiddenPauseTimerRef.current) window.clearTimeout(hiddenPauseTimerRef.current);
      hiddenPauseTimerRef.current = window.setTimeout(() => {
        hiddenPauseTimerRef.current = null;
        if (document.visibilityState !== 'hidden') return;
        const latest = stateRef.current;
        if (latest.phase !== 'focus' && latest.phase !== 'rest') return;
        const now = Date.now();
        const remaining = Math.max(1, Math.ceil((latest.endsAt - now) / 1000));
        audio.stopAll();
        commit({
          phase: 'paused', pausedFrom: latest.phase, pausedAt: now, secondsLeft: remaining,
          endsAt: null, hiddenPaused: true, lastActiveAt: now,
        });
        emit('paused');
      }, 1500);
    };
    const onPageHide = () => {
      const current = stateRef.current;
      if (!pauseWhenHidden || (current.phase !== 'focus' && current.phase !== 'rest')) return;
      if (hiddenPauseTimerRef.current) {
        window.clearTimeout(hiddenPauseTimerRef.current);
        hiddenPauseTimerRef.current = null;
      }
      commit({ lastActiveAt: Date.now() });
    };
    document.addEventListener('visibilitychange', onVisible);
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onVisible);
    if (document.visibilityState === 'visible') onVisible();
    return () => {
      window.clearInterval(timer);
      if (hiddenPauseTimerRef.current) window.clearTimeout(hiddenPauseTimerRef.current);
      document.removeEventListener('visibilitychange', onVisible);
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onVisible);
    };
  }, [audio, isRunning, pauseWhenHidden, tick]);

  useEffect(() => {
    let cancelled = false;
    const release = async () => {
      if (wakeLockRef.current) {
        try { await wakeLockRef.current.release(); } catch (error) { console.warn('[Blink] wake lock release failed', error); }
        wakeLockRef.current = null;
      }
    };
    const acquire = async () => {
      if (cancelled || stateRef.current.phase !== 'rest' || document.visibilityState !== 'visible') return;
      if (!('wakeLock' in navigator) || !navigator.wakeLock?.request) return;
      try {
        wakeLockRef.current = await navigator.wakeLock.request('screen');
        wakeLockRef.current.addEventListener?.('release', () => { wakeLockRef.current = null; });
      } catch (error) { console.warn('[Blink] screen wake lock unavailable', error); }
    };
    if (isRest) acquire(); else release();
    const onVisible = () => { if (document.visibilityState === 'visible' && stateRef.current.phase === 'rest') acquire(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { cancelled = true; document.removeEventListener('visibilitychange', onVisible); release(); };
  }, [isRest]);

  // If the app is reopened in the middle of a rest, the rest tune continues from where it should be.
  useEffect(() => {
    const s = stateRef.current;
    if (s.phase === 'rest' && s.endsAt) {
      const left = Math.max(0, Math.ceil((s.endsAt - Date.now()) / 1000));
      audio.startRestTune({ totalSec: REST_SECONDS, elapsedSec: REST_SECONDS - left });
    }
    return () => audio.stopAll();
  }, [audio]);

  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* storage denied */ }
  }, [state]);

  const start = useCallback(() => {
    audio.unlock(); // runs inside the tap, which is what unlocks audio on mobile / WebView
    const s = stateRef.current;
    if (s.phase === 'focus' || s.phase === 'rest') return;
    const now = Date.now();
    lastTickAtRef.current = typeof performance !== 'undefined' ? performance.now() : now;
    audio.stopRingtone();
    handledRef.current = null;
    if (s.phase === 'paused') {
      const phase = s.pausedFrom || 'focus';
      const remaining = Math.max(1, s.secondsLeft);
      const shift = s.pausedAt ? now - s.pausedAt : 0;
      commit({
        phase, secondsLeft: remaining, endsAt: now + remaining * 1000, pausedFrom: null, pausedAt: null,
        startedAt: s.startedAt ? s.startedAt + shift : now, lastActiveAt: now, hiddenPaused: false,
      });
      if (phase === 'rest') audio.startRestTune({ totalSec: REST_SECONDS, elapsedSec: REST_SECONDS - remaining });
      emit('resumed');
      return;
    }
    commit({
      phase: 'focus', secondsLeft: FOCUS_SECONDS, endsAt: now + FOCUS_SECONDS * 1000,
      startedAt: now, screenTime: 0, pausedFrom: null, pausedAt: null, lastActiveAt: now, hiddenPaused: false,
    });
    emit('started');
  }, [audio, commit, emit]);

  const pause = useCallback(() => {
    const s = stateRef.current;
    if (s.phase !== 'focus' && s.phase !== 'rest') return;
    const remaining = Math.max(1, Math.ceil((s.endsAt - Date.now()) / 1000));
    audio.stopAll();
    commit({ phase: 'paused', pausedFrom: s.phase, secondsLeft: remaining, endsAt: null, pausedAt: Date.now(), lastActiveAt: Date.now(), hiddenPaused: false });
    emit('paused');
  }, [audio, commit, emit]);

  const reset = useCallback(() => {
    audio.stopAll();
    handledRef.current = null;
    commit({
      phase: 'stopped', pausedFrom: null, pausedAt: null, secondsLeft: FOCUS_SECONDS, endsAt: null, screenTime: 0, startedAt: null,
      breakStartAt: null, lastActiveAt: Date.now(), hiddenPaused: false,
    });
    emit('reset');
  }, [audio, commit, emit]);

  const stopSound = useCallback(() => {
    audio.stopRestTune();
    audio.stopRingtone();
  }, [audio]);

  return {
    ...state, isRunning, isRest: state.phase === 'rest', start, pause, reset, stopSound,
  };
}
