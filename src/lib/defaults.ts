// The order a family setting is decided in (Dashboard, plans/dashboard.md in the workspace): this
// device's own choice, then Dashboard's default (#ewo-config: Würfle's own, or the family's where
// Würfle has none), then the built-in one, which is today's. public/boot.js does the same for the
// language before first paint. No Svelte and no DOM here, so the tests load it as it is.

export type Lang = 'de' | 'en';
/** `system` is the first choice, Default: nothing picked on this device. */
export type LangChoice = Lang | 'system';

/** Würfle speaks German first, like Stichle and Stammtisch: its players are the German-speaking afternoon meeting. */
export const BUILT_IN_LANG: Lang = 'de';

const isLang = (value: unknown): value is Lang => value === 'de' || value === 'en';

/**
 * The language pill's choice from what this device saved under `ewo:lang`: Deutsch or English, or
 * Default when it saved nothing. An older pick of System (saved as 'system' before Default took its
 * place) stays this device's own: the browser's language, as before.
 */
export const choiceFor = (saved: unknown, browser: () => Lang): LangChoice =>
  isLang(saved) ? saved : saved === 'system' ? browser() : 'system';

/** The language to show: this device's own, else Dashboard's, else German. Dashboard's `system` sets none. */
export function languageFor(saved: unknown, dashboard: unknown, browser: () => Lang): Lang {
  const choice = choiceFor(saved, browser);
  if (choice !== 'system') return choice;
  return isLang(dashboard) ? dashboard : BUILT_IN_LANG;
}

/** Sounds: switched on or off on this device, else Dashboard's, else off. */
export const soundsOn = (own: unknown, dashboard: unknown): boolean => (own === 'on' ? true : own === 'off' ? false : dashboard === true);
