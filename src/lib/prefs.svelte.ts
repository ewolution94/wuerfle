// What this device prefers, kept on it: whether the block marks the box a good player would write
// (off by default). Kept in localStorage; blocked storage means the default. (Shaking to roll is gone
// since 2026-10-20, the user: "i feel better removing it entirely".)

const HINT = 'wuerfle:hint';

function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function keep(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // not kept
  }
}

export const prefs = $state({
  hint: read(HINT) === 'on',
});

export function setHint(on: boolean) {
  prefs.hint = on;
  keep(HINT, on ? 'on' : 'off');
}
