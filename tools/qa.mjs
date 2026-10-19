// Würfle QA: a host and a guest (and bots) play a whole match through the page, as people would: a
// flick across the table (or the button), now and then a die kept with a tap, now and then the rolls
// ended early with Write (the table folds down), then the best box in pencil, chosen and written with
// its bubble or a second tap; screenshots of each new stage, page overflow and console checks, and
// the jump check: the band, the dice, the throw button, the players and the total keep their place
// and size every frame, apart from the table folding down or opening (learnings/projects/stichle.md,
// "the table never moves"). Not part of CI: Playwright is borrowed from Folio's checkout next door
// (the workspace's `folio/node_modules`, WebKit installed).
//
//   npm run build && node server/server.mjs --port 6611        (or the wuerfle-prod preview)
//   node tools/qa.mjs [base] [outdir]          W=390 H=844 GAMES=1 BOTS=1 PEOPLE=2 by default
//   AUDIT=1 node tools/qa.mjs …                every shot also checks that text sits in the middle of its box
//   W=1440 H=900 BROWSER=chromium node tools/qa.mjs …   the wide layout, in Chromium too
//   SOLO=1 node tools/qa.mjs …                 a game alone instead (the rules in the page)
import { chromium, webkit } from '../../folio/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';
import { textAudit } from './text-audit.mjs';

const BASE = process.argv[2] ?? 'http://localhost:6611';
const OUT = process.argv[3] ?? '/tmp/wuerfle-qa/';
const W = Number(process.env.W ?? 390), H = Number(process.env.H ?? 844);
const LANG = process.env.LANG_UI ?? 'de';
const PEOPLE = Number(process.env.PEOPLE ?? 2);
const BOTS = Number(process.env.BOTS ?? 1);
const GAMES = Number(process.env.GAMES ?? 1);
const AUDIT = process.env.AUDIT ? Number(process.env.AUDIT) : 0;
const SOLO = Boolean(process.env.SOLO);
mkdirSync(OUT, { recursive: true });

const problems = [];
const say = (...a) => console.log(...a);
const browser = await (process.env.BROWSER === 'chromium' ? chromium : webkit).launch();

async function person(name) {
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
  await context.addInitScript(([lang]) => {
    try {
      localStorage.setItem('ewo:lang', lang);
      localStorage.setItem('wuerfle:guide', '1');
    } catch {}
    // Every frame: where the table's fixed parts are. Any change while playing is a jump.
    const watched = ['.table .band', '.table .tray', '.table .actions', '.table .who', '.table .sheet-wrap', '.table .grand'];
    const last = new Map();
    window.__jumps = [];
    // Folding down or opening moves everything below the band, on purpose: not a jump.
    let folded = null;
    let calmAt = 0;
    const tick = () => {
      const now = performance.now();
      const f = document.querySelector('.table')?.classList.contains('folded') ?? null;
      if (f !== folded) {
        folded = f;
        calmAt = now + 700;
      }
      if (now < calmAt) {
        last.clear();
        requestAnimationFrame(tick);
        return;
      }
      for (const sel of watched) {
        const el = document.querySelector(sel);
        if (!el) {
          last.delete(sel);
          continue;
        }
        const r = el.getBoundingClientRect();
        const box = [r.left, r.top, r.width, r.height].map((v) => Math.round(v));
        const was = last.get(sel);
        if (was && box.some((v, i) => Math.abs(v - was[i]) > 1)) window.__jumps.push({ sel, from: was, to: box, hint: document.querySelector('.hint')?.textContent ?? '' });
        last.set(sel, box);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [LANG]);
  const page = await context.newPage();
  page.on('console', (m) => m.type() === 'error' && problems.push(`${name} console: ${m.text().slice(0, 200)}`));
  page.on('pageerror', (e) => problems.push(`${name} page error: ${e.message}`));
  return { name, context, page };
}

let shots = 0;
async function shot(p, label) {
  const file = `${OUT}${String(++shots).padStart(2, '0')}-${p.name}-${label}.png`;
  await p.page.screenshot({ path: file });
  const overflow = await p.page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  if (overflow > 0) problems.push(`${p.name} ${label}: the page is ${overflow}px too wide`);
  if (AUDIT) {
    // Not centred on purpose: the total written on its double rule, the final table's heads on theirs.
    const rows = await p.page.evaluate(textAudit, { min: AUDIT, skip: ['.grand', '.final thead th'] });
    for (const r of rows) problems.push(`${p.name} ${label}: "${r.text}" in ${r.where} sits ${r.off}px off (font bias ${r.bias})`);
  }
}

async function setName(p, name) {
  const input = p.page.locator('input[autocomplete="nickname"]');
  await input.fill(name);
}

// ---- the table ------------------------------------------------------------------------------

/** One turn of whoever's page this is, if it's theirs: throw (a flick or the button), keep, write. */
async function playTurn(p, n) {
  const page = p.page;
  const box = await page.locator('.table canvas').boundingBox();
  const throwOnce = async (k) => {
    // As a person would: wait until the table takes a throw (the last one has landed here too) and
    // has opened again after the last box (a flick needs the open table; the button opens it).
    await page.waitForSelector('.throw[aria-disabled="false"]', { timeout: 10_000 });
    const open = await page.waitForSelector('.table:not(.folded)', { timeout: 2500 }).then(() => true, () => false);
    // Opening takes 0.44 s; a flick before then lands below the table.
    if (open) await page.waitForTimeout(500);
    if (open && k % 2 === 0 && box) {
      // A flick: press, move up and to the side quickly, let go.
      await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.75);
      await page.mouse.down();
      for (let s = 1; s <= 6; s++) {
        await page.mouse.move(box.x + box.width * (0.4 + s * 0.04), box.y + box.height * (0.75 - s * 0.07));
        await page.waitForTimeout(16);
      }
      await page.mouse.up();
    } else await page.locator('.throw').click();
    // The throw hides the pencil until the dice have landed on the server's numbers.
    await page.waitForFunction(() => !document.querySelector('.cand'), null, { timeout: 3000 }).catch(() => {});
    await page.waitForSelector('.cand', { timeout: 10_000 });
  };
  await throwOnce(n);
  // Now and then a second throw, keeping the first die.
  if (n % 3 === 1) {
    await page.locator('.table canvas').focus();
    await page.keyboard.press('1');
    await page.waitForTimeout(400);
    if ((await page.locator('.throw[aria-disabled="false"]').count()) > 0) await throwOnce(n + 1);
  }
  // Now and then the rolls end early: Write folds the table down to the block (on a phone; a wide
  // screen has the block beside the dice and no fold, so a box is just picked).
  if (n % 3 === 0 && (await page.locator('.fold').count()) > 0 && (await page.locator('.throw[aria-disabled="false"]').count()) > 0) {
    await page.locator('.fold').click();
    await page.waitForSelector('.table.folded');
    await page.waitForTimeout(500);
    if (!stages.has('early')) {
      stages.add('early');
      await shot(p, 'early-write');
    }
  }
  const cands = await page.locator('.cand').evaluateAll((els) => els.map((e, i) => ({ i, n: Number(e.textContent) })));
  const best = cands.sort((a, b) => b.n - a.n)[0];
  await page.locator('.cand').nth(best.i).click();
  if (n % 4 === 2) {
    // A second tap on the chosen box writes it.
    await page.locator('.cand.chosen').click();
    return;
  }
  await page.waitForSelector('.confirm.ready');
  if (!stages.has('bubble')) {
    stages.add('bubble');
    await page.waitForTimeout(450);
    await shot(p, 'bubble');
  }
  await page.locator('.confirm .ok').click();
}
const stages = new Set();

async function whoseTurn(p) {
  return p.page.evaluate(() => document.querySelector('.hint')?.textContent ?? '');
}

async function playMatch(people, label) {
  const started = Date.now();
  let turns = 0;
  let quiet = Date.now();
  const firstShots = new Set();
  while (Date.now() - started < 20 * 60_000) {
    const over = await people[0].page.locator('.final').count();
    if (over) break;
    let moved = false;
    for (const p of people) {
      const hint = await whoseTurn(p);
      if (/^(Du bist dran|Your turn)/.test(hint)) {
        try {
          await playTurn(p, turns++);
        } catch (error) {
          await shot(p, `${label}-stuck`);
          problems.push(`${p.name} ${label}: turn ${turns} stuck (${String(error.message).split('\n')[0]}); the page says “${await whoseTurn(p)}”`);
          return;
        }
        moved = true;
        quiet = Date.now();
        if (!firstShots.has(p.name)) {
          firstShots.add(p.name);
          await p.page.waitForTimeout(300);
          await shot(p, `${label}-first-turn`);
        }
      }
    }
    if (!moved) await people[0].page.waitForTimeout(250);
    if (Date.now() - quiet > 45_000) {
      problems.push(`${label}: nothing moved for 45 s; pages say ${JSON.stringify(await Promise.all(people.map(whoseTurn)))}`);
      break;
    }
  }
  say(`${label}: ${turns} turns by people in ${Math.round((Date.now() - started) / 1000)} s`);
  for (const p of people) {
    const jumps = await p.page.evaluate(() => window.__jumps);
    for (const j of jumps.slice(0, 8)) problems.push(`${p.name} ${label}: ${j.sel} moved ${JSON.stringify(j.from)} → ${JSON.stringify(j.to)} (hint “${j.hint}”)`);
    await shot(p, `${label}-end`);
  }
}

// ---- run --------------------------------------------------------------------------------------

if (SOLO) {
  const me = await person('solo');
  await me.page.goto(BASE);
  await setName(me, 'Solo');
  await shot(me, 'home');
  await me.page.locator('.home .btn.primary').click();
  await me.page.waitForSelector('.table canvas');
  await me.page.waitForTimeout(800);
  await shot(me, 'table');
  await playMatch([me], 'solo');
} else {
  const host = await person('host');
  await host.page.goto(BASE);
  await setName(host, 'Anna');
  await shot(host, 'home');
  await host.page.locator('.btn.cobalt', { hasText: /Neuer Tisch|New table/ }).click();
  await host.page.waitForSelector('.lobby');
  const code = (await host.page.locator('.lobby .code').textContent()).trim();
  const people = [host];
  for (let i = 1; i < PEOPLE; i++) {
    const guest = await person(`guest${i}`);
    await guest.page.goto(`${BASE}/${code}`);
    await setName(guest, `Gast ${i}`);
    await guest.page.locator('form .btn.primary').click();
    await guest.page.waitForSelector('.lobby');
    people.push(guest);
  }
  for (let i = 0; i < BOTS; i++) {
    await host.page.locator('.btn', { hasText: /Bot dazu|Add a bot/ }).click();
    await host.page.waitForTimeout(250);
  }
  if (GAMES > 1) {
    await host.page.locator('ewo-segmented').first().evaluate((el, n) => {
      el.value = String(n);
      el.dispatchEvent(new CustomEvent('change', { detail: { value: String(n) }, bubbles: true }));
    }, GAMES);
    await host.page.waitForTimeout(400);
  }
  await shot(host, 'lobby');
  if (people[1]) await shot(people[1], 'lobby');
  await host.page.locator('.go .btn.primary').click();
  await host.page.waitForSelector('.table canvas');
  await host.page.waitForTimeout(800);
  await shot(host, 'table');
  await playMatch(people, 'match');
}

await browser.close();
say(problems.length ? `PROBLEMS (${problems.length}):\n- ${problems.join('\n- ')}` : 'No problems.');
process.exit(problems.length ? 1 : 0);
