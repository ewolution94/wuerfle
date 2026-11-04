import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
// What Würfle hands Dashboard (public/ewo.config.json), checked with Folio's own rules, and the
// order a setting is decided in: this device's own choice, then Dashboard's default, then the
// built-in one (src/lib/defaults.ts, and public/boot.js before first paint).
import { checkManifest, resolve } from '../vendor/ewo/elements/config-core.js';
import { choiceFor, languageFor, soundsOn } from '../src/lib/defaults.ts';

const manifest = JSON.parse(readFileSync(new URL('../public/ewo.config.json', import.meta.url), 'utf8'));

test('the manifest is one Dashboard takes: the family’s language (German here) and sounds', () => {
  const { ok, problems, manifest: checked } = checkManifest(manifest);
  assert.deepEqual(problems, []);
  assert.ok(ok);
  assert.equal(checked.app, 'wuerfle');
  assert.deepEqual(Object.keys(checked.settings), ['lang', 'sounds']);
});

test('with nothing set in Dashboard: German and no sounds, the page as it ships', () => {
  const { values, sources } = resolve(manifest, {});
  assert.deepEqual(values, { lang: 'de', sounds: false });
  assert.deepEqual(sources, { lang: 'own', sounds: 'built-in' });
  assert.equal(choiceFor(null, () => 'en'), 'system');
  assert.equal(languageFor(null, values.lang, () => 'en'), 'de');
  assert.equal(soundsOn(null, values.sounds), false);
});

test('Dashboard’s values reach the page: one set for Würfle, the family’s sounds; the family’s language doesn’t', () => {
  // Würfle speaks German first: its own default comes before the family's language.
  assert.deepEqual(resolve(manifest, { family: { lang: 'en', sounds: true } }).values, { lang: 'de', sounds: true });
  assert.deepEqual(resolve(manifest, { family: { lang: 'en' }, app: { lang: 'en' } }).values, { lang: 'en', sounds: false });
  assert.deepEqual(resolve(manifest, { family: { sounds: true }, app: { sounds: false } }).values, { lang: 'de', sounds: false });
});

test('the device’s own choice beats Dashboard’s default, which beats the built-in one', () => {
  // QA's `ewo:lang` = `en` is this device's own choice, so it keeps winning.
  const browser = () => 'en';
  assert.equal(languageFor('en', 'de', browser), 'en');
  assert.equal(languageFor('de', 'en', browser), 'de');
  // Default saves nothing: Dashboard's, else German.
  assert.equal(languageFor(null, 'en', () => 'de'), 'en');
  // An older pick of System, saved as 'system', follows the browser as before, whatever Dashboard says.
  assert.equal(choiceFor('system', browser), 'en');
  assert.equal(languageFor('system', 'de', browser), 'en');
  // Dashboard's `system` is no default: German, as built in.
  assert.equal(languageFor(null, 'system', browser), 'de');
  assert.equal(languageFor(null, undefined, browser), 'de');
  assert.equal(languageFor('nonsense', 'fr', browser), 'de');
  assert.equal(soundsOn('off', true), false);
  assert.equal(soundsOn('on', false), true);
  assert.equal(soundsOn(null, true), true);
  assert.equal(soundsOn(null, false), false);
  assert.equal(soundsOn(null, undefined), false);
  assert.equal(soundsOn(null, 'yes'), false);
});

/** public/boot.js against a stub page: the language it applies before first paint. */
function boot({ saved, config, languages = ['de-DE'], blocked = false }) {
  const root = { lang: 'de', dataset: {}, classList: { add() {}, remove() {} }, style: { setProperty() {} } };
  const document = {
    documentElement: root,
    getElementById: (id) => (id === 'ewo-config' && config ? { textContent: JSON.stringify(config) } : null),
    querySelectorAll: () => [],
    addEventListener() {},
  };
  const localStorage = {
    getItem: (key) => {
      if (blocked) throw new Error('blocked');
      return key === 'ewo:lang' && saved ? saved : null;
    },
  };
  vm.runInNewContext(readFileSync(new URL('../public/boot.js', import.meta.url), 'utf8'), {
    document,
    localStorage,
    matchMedia: () => ({ matches: false }),
    navigator: { languages, language: languages[0] },
    location: { search: '' },
    screen: {},
    innerHeight: 800,
    innerWidth: 400,
    addEventListener() {},
    setTimeout() {},
  });
  return root.lang;
}

test('before first paint: the saved language, else Dashboard’s, else German', () => {
  assert.equal(boot({}), 'de');
  assert.equal(boot({ languages: ['en-US'] }), 'de');
  assert.equal(boot({ config: { lang: 'de', sounds: false } }), 'de');
  assert.equal(boot({ config: { lang: 'en' } }), 'en');
  assert.equal(boot({ config: { lang: 'system' }, languages: ['en-US'] }), 'de');
  assert.equal(boot({ saved: 'en', config: { lang: 'de' } }), 'en');
  assert.equal(boot({ saved: 'de', config: { lang: 'en' } }), 'de');
  assert.equal(boot({ saved: 'system', config: { lang: 'de' }, languages: ['en-US'] }), 'en');
  assert.equal(boot({ saved: 'system', languages: ['fr-FR', 'de-AT'] }), 'de');
  assert.equal(boot({ blocked: true, config: { lang: 'en' } }), 'en');
});
