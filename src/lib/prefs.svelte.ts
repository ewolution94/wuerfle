// What this device prefers, kept on it: whether shaking the phone throws the dice (on by default;
// iOS asks for motion once, on the first tap at the table), and whether the block marks the box a
// good player would write (off by default). Kept in localStorage; blocked storage means the defaults.

const SHAKE = 'wuerfle:shake';
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
  shake: read(SHAKE) !== 'off',
  hint: read(HINT) === 'on',
});

export function setShake(on: boolean) {
  prefs.shake = on;
  keep(SHAKE, on ? 'on' : 'off');
}

export function setHint(on: boolean) {
  prefs.hint = on;
  keep(HINT, on ? 'on' : 'off');
}
