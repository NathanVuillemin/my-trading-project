# Trading Desk

Nathan's own layer on top of what he already receives. Market Context and his coach's briefs give him
the data; this desk holds what he does with it: his weekly scorecard and pairs, his if/then lines, kill
switches, key levels, daily notes, ideas, and a review of whether his calls were right.

**Rule: the desk shows no data he is sent elsewhere.** The one thing it reads is a small live price file,
used only to hold his own entries against the market.

Live: `/my-trading-project/desk/`. Preview locally: `npm run desk`, then http://localhost:8787/desk/
(pages fetch JSON, so file:// won't work). Deploys with the rest of `dashboard/` via `whale-flow.yml`
(daily, or a manual run; a push alone does not publish).

## Pages
| Page | File | Holds |
|---|---|---|
| Today | `index.html` | This week's confirmed pairs against live prices (last, today, week, 1 month, with or against his call, a live TradingView mini chart, his events, levels and kill switches for the pair); every currency's score against its move; the seven-question daily read with links; the three-line daily note |
| Scorecard | `scorecard.html` | The weekly build: his read per currency, his call, score, ranking, pair proposals, week-ahead events with if/then |
| Kill Switches | `kill-switches.html` | Conditions that change or end a bias |
| Key Levels | `levels.html` | His own levels, sorted by distance from the live price |
| Ideas | `ideas.html` | Inbox for ideas from podcasts, videos, calls: open, kept or dropped |
| Review | `review.html` | Each saved week graded from prices: pairs by their move in his direction, currency calls by the currency against the other seven |

All pages are thin shells (`<body data-page="…">`); `assets/desk.js` draws the nav and one renderer per page.

## Data
Everything Nathan types is one JSON file per domain in `data/`, committed through the GitHub contents API.
| File | Holds | Key fields |
|---|---|---|
| `scorecard-index.json` | Weeks with a scorecard, newest first | `weeks[{monday, pairs[{pair, dir}], scores{CCY: n}}]` |
| `scorecard-<monday>.json` | One weekly build, named by the Monday of the trading week | `monday, updated, active[CCY], currencies{CCY: {growth{level,dir}, inflation{level,dir}, labour{level,dir}, sentence, lean, priced12m, weekChange, call (tooLittle/aboutRight/tooMuch), strong, crowded, rank1m}}, pairs[{pair, dir, diff}], events[{id, date, currency, event, ifThen}]` |
| `daily-notes.json` | The three lines per day | `days{YYYY-MM-DD: {story, ifThen, biasCheck, done[1-7], saved}}` |
| `killswitches.json` | Kill switches | `kinds{}, effects{}, killSwitches[{id, currency, kind, condition, now, effect, status (armed/near/fired), firedOn, by, created, edited}]` |
| `levels.json` | Key levels | `note, families{}, types{key: {family, desc}}, statuses{}, levels[{id, instrument, level, type, side, who, evidence, status, lastTouch, created, edited}]` |
| `ideas.json` | Ideas | `ideas[{id, date, source, text, status (open/kept/dropped)}]` |
| `correlations.json` | Not used by any page. Still written daily by `scripts/correlations.mjs` until Nathan decides whether to keep that job | |

## Live prices
`scripts/desk-live.mjs` pulls the seven USD pairs from Yahoo Finance (keyless), derives all 28 crosses and a
basket move per currency (each currency against the other seven, averaged), and writes one file:
`asOf, priceTime, week{monday, ref, prevClose, monthRef}, pairs{PAIR: {last, dayPct, wtdPct, m1Pct, typicalPct, x, hi20, lo20}},
currencies{CCY: {dayPct, wtdPct, m1Pct, rankDay, rankWtd, rankM1}}, history{dates[], usd{CCY: []}}` (three months of daily
closes, used by Review).

`.github/workflows/desk-live.yml` runs it every 15 minutes while FX trades and force-pushes the file to the
`desk-live` branch (a single commit, replaced each run, so main's history stays clean). Pages read it from
`raw.githubusercontent.com/…/desk-live/live.json` and re-read it every minute; a pill shows its age.
GitHub can start scheduled runs late and its CDN caches for a few minutes, so "live" here means minutes, not ticks.
The TradingView mini charts on Today are the only tick-live element.
Local: `npm run desk:live` writes `data/live.json` (git-ignored), which the local preview also reads.

## Saving
Pages are static, so saves go straight to the repo. Nathan pastes a fine-grained token (this repo only,
Contents read and write) once per device on any page; it stays in that browser's localStorage and is sent only
to api.github.com. Each save re-reads the file and applies one change, so a commit made in between is never
overwritten; a file that does not exist yet is created. Without a token pages are read-only. Pages read the
repo's current file, not the deployed copy, so a save shows at once.

The links to his coach's briefs used by the daily checklist are private: they are pasted once per device and
kept in localStorage, never in the repo.

## Local test mode
Add `?store=local` to any desk address: every save goes to this browser's localStorage instead of GitHub (a
banner shows it; the flag lasts for the browser session). `?store=github` switches back. Use it for trying
pages and for testing changes: without it, with a token connected, a save commits to main even from `npm run desk`.

## Scorecard rules
One card per trading week; a build done on Saturday or Sunday belongs to the coming Monday. Score per currency:
the call gives the sign (too little priced = +1, about right = 0, too much priced = -1), "strong" doubles it,
crowded positioning pulls it one notch towards zero. Pairs are every two active currencies with different
scores, widest gap first; highest against lowest is marked. Nathan confirms two or three.

## Review rules
A week is measured from the last daily close before its Monday to its Friday close (or the latest price while
it runs). A call counts as right when price moved more than 0.05% its way. Direction only: it does not grade
entries or exits.
