# Würfle

The classic five-dice game for the afternoon meeting, alone or at a table with friends, at
<https://wuerfle.ewolution.cloud>. Five cobalt glass dice you throw with a flick across the table or a
button; the paper block with one column per game, one to six games in a row
as it's played in Germany. German first, English beside it. Young Serif and Karla. Part of the ewolution family (Stichle,
Stammtisch, CDNMS, Kritzle and Vollmond are its siblings).

The name is the app's own: "würfeln" with the family's Swabian -le. The five-alike box is called
Würfle too, so the app never uses the trademarked names of the boxed games.

## How it works

- **Alone:** the rules and the bots run in the page (`server/rules.mjs` and `server/bots.mjs` are
  plain ESM the page imports as they are), so a game alone needs no server and plays offline once the
  service worker has the page. Up to three bots can join. The game is kept on the device as it goes
  (`wuerfle:solo`); finished games alone go into a small record (`wuerfle:record`) the start page
  shows.
- **With friends:** a table with a four-letter code (rooms in memory, `server/rooms.mjs`), a lobby
  with the order of play, one to eight at the table and anyone else watching, bots in three ranks to
  fill seats. The host picks the games (one to six), the rules, the clock and the bots' rank. One
  Server-Sent Events stream per page carries the room (`server/api.mjs`); moves are JSON posts.
- **The dice** (`src/lib/dice.ts`): three.js draws them, cannon-es throws them. Every throw is played
  through before it's shown: when the dice leave a hand, the physics runs to the end in a few
  milliseconds and is recorded, then the recording plays. So the page knows which face of each die
  lands on top before anyone sees it, and swaps two pairs of opposite faces so it lands on the number
  the server rolled (opposite faces still add up to seven). The thrower's page sends where its dice
  left the hand (the "fling"); every other page replays the same throw from there. The server never
  takes a number from a page.
- **Keeping:** a tap puts a die on the rail at the top; everyone sees it there before the next throw
  (the `hold` action). Bots do the same, so their keeps show for a moment before they throw.
- **The table folds** (on a phone, `src/components/Table.svelte`): open, it takes all the room above the
  throw, with only the players' totals below; it folds down to a strip of the five dice when the block
  is wanted: Write (Eintragen) beside Roll after any throw, a tap on a player's name, or by itself
  after the third throw. It opens again for the next turn, or with Table (Tisch) or Roll. Folded, the
  dice line up on the rail's row (`DiceTable.fold`); the canvas keeps the open table's height and the
  tray clips it, so the drawing never resizes. On a tall table the view keeps its width (the dice their
  size) and sees deeper. A wide screen has the block beside the dice and never folds.
- **The page holds still while playing:** the document doesn't scroll or bounce, a touchmove on the
  table is claimed (iOS otherwise pulled the whole app), except in the block and the players' row,
  and a drag on the folded strip opens the table.
- **Safe keeping:** a press that starts on a die only keeps it, however long, unless it drags 28 px; a
  hand let go before it has travelled 40 px puts the dice back instead of throwing them. A safe zone
  in front of the rail's bar keeps a die against the back wall from reaching over it.
- **Pencil marks** (a device setting, Settings → "Plus und Minus oben", off by default): each written
  upper box shows, small beside its centred number, how far it is above or below three of its number
  ("+4", "−3"), and the upper sum shows where the column stands for the 63, as the user pencilled them
  on the paper block. Where a column is too narrow for that (six games on a phone), the mark sits
  small in the cell's top corner.
- **Writing:** a tap on a box in pencil chooses it; the gold ✓ bubble beside it, or a second tap,
  writes it (a crossed-out box shows its line, no 0). A tap elsewhere in the block, ×, or the next
  throw lets it go.
- **The clock** (off, 60 s or 25 s a decision): when it runs out, a bot plays the rest of the turn.
  Someone who closed the page has their turn played after 12 s.

## The rules

As in Schmidt Spiele's current leaflet (checked against it and Hasbro's, 2026-10-19,
`development/plans/wuerfle.md`):

- Thirteen rounds a game; up to three throws a turn, keeping any dice between throws (a kept die may
  be thrown again later in the same turn). After any throw a box is written; after the third it must
  be.
- Upper: ones to sixes, the sum of that face; **35 bonus at 63 or more**.
- Lower: three and four of a kind (the sum of all five), full house 25 (three and two of different
  numbers: five alike is not a full house), small straight 30 (four in a row), large straight 40,
  Würfle 50 (five alike), chance (the sum).
- **Three variants**, the host's choice:
  - `meister` (the default, Schmidt's championship rules): any box may be crossed out at any time.
    Each further five-alike scores +50, but only into a box it really fits (its upper box, three or
    four of a kind, chance), never full house or the straights.
  - `basis` (Schmidt's basic rules): a box may be crossed out only when the roll fits no open box.
    Each further five-alike: +50, and any open box at its highest value.
  - `joker` (Hasbro's): any box any time. Each further five-alike: +100 if the Würfle box holds 50,
    and the joker placement either way: its upper box first, else any lower box at full value
    (full house 25, straights 30 and 40), else 0 in an upper box.
- **The house rule "any column"** (`rules.free`, with two games or more; the user's family plays it):
  every column is open from the start and a roll may go into any open box of any column; the match
  is one run of 13 rounds per column and ends with every column full. The variants apply per column
  (the five-alike's extra, the joker), and the basic rule's crossing out looks at every column. Off
  by default; the switch is under the games, alone and in the lobby.

The bots: the apprentice keeps the most common face and writes the most points; the journeyman (the
default) weighs each box's points against what it's likely worth later and minds the bonus; the
master looks ahead over every keep and every outcome of the remaining throws with the journeyman's
judgement at the end, within 150 ms a decision. Solo averages over 2000 games: about 195, 227 and
244 points (`node tools/ladder.mjs 2000`).

## Commands

```bash
npm install
npm run dev          # the whole app on one port (6610): the table server runs inside Vite
npm test             # the rules, the bots and the rooms (node:test)
npm run check        # svelte-check
npm run build && npm start -- --port 6611    # the production server with the built page
node tools/qa.mjs http://localhost:6611      # a host, a guest and a bot play a match in WebKit, 390 px
node tools/ladder.mjs 2000 [variant]         # the bots' ranks over many solo games
```

The QA script borrows Playwright from Folio's checkout next door (`../folio/node_modules`).

## Deploy (NAS)

This mirrors Stichle and Stammtisch:

- `ci.yml` runs the typecheck, the tests and the build, then smoke-tests the production server: the
  page and its headers, a table with a guest and a bot, the first throw on the guest's stream with
  its fling, a box refused before the throw and written after.
- `docker-publish.yml` gates on `ci.yml`, then pushes `ghcr.io/ewolution94/wuerfle:latest` for
  amd64 and arm64.
- The shared Watchtower picks the image up. A push to `release` is the whole deploy, and it ends any
  table in progress (games alone carry on in their pages).
- The NAS runs `deploy/portainer-stack.yml`, on the port the workspace's registry holds for it, with
  the health check in Würfle's slot (every 754 s, `plans/nas-load.md`).
- The stack joins the external Docker network `ewolution`, where Census listens as `census:4901`.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` / `--port` | `8080` | Listen port |
| `HOST` | `0.0.0.0` | Listen address |
| `WUERFLE_CENSUS` | off | Census's ingest origin, `http://census:4901` on the NAS |
| `WUERFLE_MASTER_MS` | `150` | The master bot's time per decision (for the ladder) |

## Project layout

```
server/
  server.mjs     the production server: /healthz, the API, the built page, the Census forwarder
  api.mjs        the rooms over HTTP and SSE
  rooms.mjs      tables with a code, seats, the host, bots, the clock, the throws and keeps
  rules.mjs      the game as a pure state machine (also run by the page for games alone)
  bots.mjs       the three ranks
  census.mjs     forwards /_e and /_e.js to Census
src/
  App.svelte     the routes: the start, /solo, /KXPT
  components/    Home, Join, Lobby, Game (a room), SoloGame, Table, ScoreBlock, Final, Settings, Guide …
  lib/dice.ts    the dice: three.js and cannon-es, recorded throws, the relabelling, the hand
  lib/match.ts   what the table shows (a MatchView) and asks (a Driver), for a room or a game alone
  lib/solo.svelte.ts   a game alone in the page; lib/remote.ts the room's driver
tests/           rules, bots, rooms
tools/           qa.mjs, ladder.mjs, text-audit.mjs
vendor/ewo/      Folio's tokens and elements (`npm run vendor -- wuerfle` in folio); don't edit here
```
