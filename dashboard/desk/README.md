# Trading Desk

Multi-page bias dashboard. Hub (morning brief) + Weekly Recap, Bias, Events, Key Levels, Kill Switches,
Drivers, Review, with a top nav bar. The Weekly Recap is the Sunday read: one overview plus one tab per economy. Market Context covers raw data (calendar, flow, news, positioning, notes); this desk
holds Nathan's own bias, what changes it, and whether it was right.

**Status: architecture only. Every JSON file is mock (`"mock": true` shows a banner).** Live pipelines
later overwrite the same files in the same shape; the pages don't change.

Preview locally: `npm run desk`, then open http://localhost:8787/desk/ (pages fetch JSON, so file:// won't work).
Deploys with the rest of `dashboard/` via `whale-flow.yml` (live at `/my-trading-project/desk/`).

## Files
- `index.html`, `weekly-recap.html`, `bias.html`, `events.html`, `levels.html`, `kill-switches.html`,
  `drivers.html`, `review.html`: thin shells, `<body data-page="…">`.
- `assets/desk.js`: nav bar + one renderer per page. `assets/desk.css`: styles.
- `data/*.json`: one file per page domain. `data/recaps/`: one file per Sunday + `index.json` (newest first).

## Data shapes
| File | Holds | Key fields | Live source (later) |
|---|---|---|---|
| `brief.json` | Morning brief | `date, regime, headline, bullets[], focus[{pair,direction,why}], avoid[]` | morning-debrief agent |
| `bias.json` | Bias per currency + gold | `code, cb, nextMeeting, net, structural (-2..+2), conviction (1-5), status (ACTIVE/FROZEN/EXPIRED), growth, inflation, cbPath{expectedBp, pricedBp}, thesis, driver{name,status}, positioning, invalidation, killSwitches[], reviewed, expires` | Nathan's input (shared store TBD); `pricedBp` from OIS / Market Context |
| `events.json` | Releases | `id, asset (currency; commodity later), currency, time (UTC), type, name, impact, previous, forecast, actual, surprise, affects{CCY: note}, killSwitch?, source{name,url}` | calendar puller; `source.url` = official release page |
| `killswitches.json` | What kills or changes a bias | `id, currency, kind (data/cb/pricing/driver/price/expiry), condition, now, effect (flip/downgrade/upgrade/freeze/flat), status (armed/near/fired), firedOn, event?` | kill-switch checker over events + drivers |
| `drivers.json` | Driver layer | `currency, driver, symbol, measure, move1m, corr20, corr60, effect (supports/neutral/conflict), secondOrder` | TradingView pull + rolling correlation |
| `levels.json` | Key levels (draft layout) | `instrument, level, type, who, side, evidence, price, status, lastTouch, source` | manual + COT / flow later |
| `recaps/index.json` | Recap archive | `recaps[{sunday, week, file, headline}]`, newest first | written by the Sunday recap job |
| `recaps/<sunday>.json` | One weekly recap | `sunday, week, period{start,end}, process{status, steps[{id,label}]}, overview{headline, globalScare, riskMood, bullets[], killSwitchesFired[], nextWeekTop[]}, economies[{code, name, cb, regime{growth,inflation}, scare (inflation/growth/both/neither), verdict, indicators{growth[],inflation[],labour[]} each {name, unit, latest, prior, expected, trend[6], source}, centralBank{stance, pricedStartBp, pricedEndBp, myPathBp, nextMeeting}, week{currencyPct, takeaways[], biasChange}, nextWeek[], process{stepId: read}}]` | Sunday recap agent, following Nathan's method (to define) |
| `history.json` | Bias change log | `date, currency, layer (net/structural/status), from, to, kind, killSwitch, reason, grade1w, grade4w` | written on each bias change; grader fills grades |

Rules baked into the pages: pair bias = base net − quote net (28 pairs, market-convention order);
pairs flagged when either side has a driver conflict or is frozen/expired; correlation is "strong" at |r| ≥ 0.5 (60d).

Regime quadrant (computed from growth / inflation direction; "flat" counts as neither up nor down):
inflation up + growth not down = Overheating (inflation scare); inflation up + growth down = Stagflation (both);
inflation not up + growth down = Slowdown (growth scare); otherwise Goldilocks (no scare).
