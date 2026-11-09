# Trading Desk

Multi-page bias dashboard. Hub (morning brief) + Bias, Events, Key Levels, Triggers, Drivers, Review,
with a top nav bar. Market Context covers raw data (calendar, flow, news, positioning, notes); this desk
holds Nathan's own bias, what changes it, and whether it was right.

**Status: architecture only. Every JSON file is mock (`"mock": true` shows a banner).** Live pipelines
later overwrite the same files in the same shape; the pages don't change.

Preview locally: `npm run desk`, then open http://localhost:8787/desk/ (pages fetch JSON, so file:// won't work).
Deploys with the rest of `dashboard/` via `whale-flow.yml` (live at `/my-trading-project/desk/`).

## Files
- `index.html … review.html`: thin shells, `<body data-page="…">`.
- `assets/desk.js`: nav bar + one renderer per page. `assets/desk.css`: styles.
- `data/*.json`: one file per page domain.

## Data shapes
| File | Holds | Key fields | Live source (later) |
|---|---|---|---|
| `brief.json` | Morning brief | `date, regime, headline, bullets[], focus[{pair,direction,why}], avoid[]` | morning-debrief agent |
| `bias.json` | Bias per currency + gold | `code, cb, nextMeeting, net, structural (-2..+2), conviction (1-5), status (ACTIVE/FROZEN/EXPIRED), growth, inflation, cbPath{expectedBp, pricedBp}, thesis, driver{name,status}, positioning, invalidation, triggers[], reviewed, expires` | Nathan's input (shared store TBD); `pricedBp` from OIS / Market Context |
| `events.json` | Releases | `id, asset (currency; commodity later), currency, time (UTC), type, name, impact, previous, forecast, actual, surprise, affects{CCY: note}, trigger?, source{name,url}` | calendar puller; `source.url` = official release page |
| `triggers.json` | What changes a bias | `id, currency, kind (data/cb/pricing/driver/price/expiry), condition, now, effect (flip/downgrade/upgrade/freeze/flat), status (armed/near/fired), firedOn, event?` | trigger checker over events + drivers |
| `drivers.json` | Driver layer | `currency, driver, symbol, measure, move1m, corr20, corr60, effect (supports/neutral/conflict), secondOrder` | TradingView pull + rolling correlation |
| `levels.json` | Key levels (draft layout) | `instrument, level, type, who, side, evidence, price, status, lastTouch, source` | manual + COT / flow later |
| `history.json` | Bias change log | `date, currency, layer (net/structural/status), from, to, kind, trigger, reason, grade1w, grade4w` | written on each bias change; grader fills grades |

Rules baked into the pages: pair bias = base net − quote net (28 pairs, market-convention order);
pairs flagged when either side has a driver conflict or is frozen/expired; correlation is "strong" at |r| ≥ 0.5 (60d).
