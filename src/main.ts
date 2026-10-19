import './app.css';
// The faces, Latin only (German included): Young Serif for the name, the buttons and the numbers,
// Karla for everything else (look C's type, the user's pick of 2026-10-19).
import '@fontsource/young-serif/latin-400.css';
import '@fontsource/karla/latin-400.css';
import '@fontsource/karla/latin-500.css';
import '@fontsource/karla/latin-600.css';
import '@fontsource/karla/latin-700.css';
import './lib/scrolling';
// Folio's shared elements (vendor/ewo); each defines itself once.
import '../vendor/ewo/elements/settings-button.js';
import '../vendor/ewo/elements/sheet.js';
import '../vendor/ewo/elements/guide.js';
import '../vendor/ewo/elements/segmented.js';
import '../vendor/ewo/elements/switch.js';
import '../vendor/ewo/elements/emblem.js';
import '../vendor/ewo/elements/emblem-maker.js';
import '../vendor/ewo/elements/connection.js';

import { mount } from 'svelte';
import App from './App.svelte';
// Every tap answers on a phone, the games' lively way (Folio's pressFeedback,
// development/plans/mobile-touch.md).
import { pressFeedback } from '../vendor/ewo/elements/press.js';
// A wait for the server shows at the control that asked (Folio's track() via src/lib/waits.ts):
// Würfle's working mark is a little die turning over (app.css).
import { configureWaiting } from '../vendor/ewo/elements/waiting.js';

pressFeedback({ preset: 'lively' });
configureWaiting({
  mark: '<svg class="die" viewBox="0 0 20 20" aria-hidden="true"><rect x="2" y="2" width="16" height="16" rx="4" /><circle cx="6.5" cy="6.5" r="1.6" /><circle cx="13.5" cy="13.5" r="1.6" /><circle cx="10" cy="10" r="1.6" /></svg>',
});

function start() {
  mount(App, { target: document.getElementById('app')! });
  requestAnimationFrame(() => dispatchEvent(new Event('splash:ready')));
}

// Installed, the app opens on the splash screen (index.html, switched on by public/boot.js; written by
// development/plans/splash-rollout). iOS fades its launch image into the page as soon as the page has
// laid out, so the splash has to be on screen before the app's first render takes the main thread, or
// the fade goes through a blank white web view. It lifts a frame after the app has mounted.
if (document.documentElement.classList.contains('splash')) {
  let started = false;
  const once = () => {
    if (started) return;
    started = true;
    start();
  };
  requestAnimationFrame(() => setTimeout(once));
  setTimeout(once, 100);
} else {
  start();
}

/**
 * The offline shell (see public/sw.js). Production only: a worker in front of the dev server would
 * cache the modules Vite is trying to hot-replace.
 */
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
