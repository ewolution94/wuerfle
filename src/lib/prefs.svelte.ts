// What this device prefers, kept on it: whether the block marks the box a good player would write,
// and whether its upper boxes carry the little "+4" and "−3" against three of each (both off by
// default; the marks are the user's own habit from the paper block, 2026-10-20). Kept in
// localStorage; blocked storage means the defaults. (Shaking to roll is gone
// since 2026-10-20, the user: "i feel better removing it entirely".)

const HINT = 'wuerfle:hint';
const MARKS = 'wuerfle:marks';

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
  marks: read(MARKS) === 'on',
});

export function setMarks(on: boolean) {
  prefs.marks = on;
  keep(MARKS, on ? 'on' : 'off');
}

export function setHint(on: boolean) {
  prefs.hint = on;
  keep(HINT, on ? 'on' : 'off');
}
