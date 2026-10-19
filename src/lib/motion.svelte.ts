// Shaking the phone: its devicemotion events, for the table. On the iPhone (Safari, and Chrome too,
// which runs on the same engine) motion comes only after asking, and the ask only counts from a tap.
// A flick isn't one, and a refusal without a tap is silent: the first version asked on the first
// touch at the table, which was usually a flick, so iOS never showed its prompt (the user's iPhone
// test, 2026-10-19). So the table first asks without a tap (a browser that needs none answers at once,
// and one that was answered before says so), and only where that needs a tap does the chip on the
// table ask, from its own tap; the switch in Settings asks too. Once allowed, later visits pick motion
// up on their own or on the next tap.

import { prefs, setShake } from './prefs.svelte';

const KEY = 'wuerfle:motion';
type Answer = 'granted' | 'denied';

function read(): Answer | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'granted' || v === 'denied' ? v : null;
  } catch {
    return null;
  }
}
function keep(answer: Answer) {
  try {
    localStorage.setItem(KEY, answer);
  } catch {
    // not kept: the chip asks again next time
  }
}

type Asking = { requestPermission?: () => Promise<string> };
const asks = typeof DeviceMotionEvent !== 'undefined' && typeof (DeviceMotionEvent as unknown as Asking).requestPermission === 'function';

export const motion = $state({
  /** This browser asks before it gives motion (the iPhone). */
  asks,
  /** What this device answered last time, if it was asked. */
  answer: read(),
  /** Motion events are coming in. */
  live: false,
  /** The ask without a tap is under way (no chip meanwhile). */
  trying: false,
});

let handler: ((e: DeviceMotionEvent) => void) | null = null;
const onmotion = (e: DeviceMotionEvent) => handler?.(e);

function start() {
  if (motion.live || typeof DeviceMotionEvent === 'undefined') return;
  addEventListener('devicemotion', onmotion);
  motion.live = true;
}
function stop() {
  removeEventListener('devicemotion', onmotion);
  motion.live = false;
}

/**
 * iOS's ask: its prompt, or straight yes once allowed. 'unasked' when this didn't come from a tap
 * (nothing changes then; the next tap may ask).
 */
async function request(): Promise<Answer | 'unasked'> {
  if (!asks) {
    start();
    return 'granted';
  }
  try {
    const answer = (await (DeviceMotionEvent as unknown as Required<Asking>).requestPermission()) === 'granted' ? 'granted' : 'denied';
    motion.answer = answer;
    keep(answer);
    if (answer === 'granted') start();
    return answer;
  } catch {
    return 'unasked';
  }
}

/**
 * The table's handler for the shaking; motion starts where nothing needs asking, or where this device
 * said yes before (then without a tap if iOS still remembers, else on the next tap anywhere).
 */
export function shakeWith(fn: (e: DeviceMotionEvent) => void) {
  handler = fn;
  const nextTap = () => void request();
  if (prefs.shake && motion.answer !== 'denied') {
    motion.trying = true;
    void request().then((r) => {
      motion.trying = false;
      // Allowed before but iOS wants a tap again: the next one anywhere.
      if (r === 'unasked' && motion.answer === 'granted' && handler === fn) addEventListener('click', nextTap, { once: true, capture: true });
    });
  }
  return () => {
    if (handler === fn) handler = null;
    removeEventListener('click', nextTap, { capture: true });
    stop();
  };
}

/** Shaking on or off, from a tap (the chip, the switch): on asks iOS. The answer, or 'unasked'. */
export async function setShaking(on: boolean): Promise<Answer | 'unasked'> {
  if (!on) {
    setShake(false);
    stop();
    return 'denied';
  }
  setShake(true);
  const r = await request();
  // A no from the phone: the switch shows it.
  if (r === 'denied') {
    setShake(false);
    stop();
  }
  return r;
}

/** The chip on the table: shaking is on, this phone asks, and it hasn't been asked yet. */
export const shouldAsk = () => prefs.shake && motion.asks && !motion.live && !motion.trying && motion.answer === null;
