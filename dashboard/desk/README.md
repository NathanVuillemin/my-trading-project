# Trading Desk

Multi-page bias dashboard. Hub (morning brief) + Weekly Recap, Bias, Key Levels, Kill Switches,
Drivers, Review, with a top nav bar. The Weekly Recap is the Sunday read: one overview plus one tab per economy. Market Context covers raw data (calendar, flow, news, positioning, notes); this desk
holds Nathan's own bias, what changes it, and whether it was right.

**Status: architecture only. Every JSON file is mock (`"mock": true` shows a banner).** Live pipelines
later overwrite the same files in the same shape; the pages don't change.

Preview locally: `npm run desk`, then open http://localhost:8787/desk/ (pages fetch JSON, so file:// won't work).
Deploys with the rest of `dashboard/` via `whale-flow.yml` (live at `/my-trading-project/desk/`).

## Files
- `index.html`, `weekly-recap.html`, `bias.html`, `levels.html`, `kill-switches.html`,
  `drivers.html`, `review.html`: thin shells, `<body data-page="…">`.
- `assets/desk.js`: nav bar + one renderer per page. `assets/desk.css`: styles.
- `data/*.json`: one file per page domain. `data/recaps/`: one file per Sunday + `index.json` (newest first).

## Data shapes
| File | Holds | Key fields | Live source (later) |
|---|---|---|---|
| `brief.json` | Morning brief | `date, regime, headline, bullets[], focus[{pair,direction,why}], avoid[]` | morning-debrief agent |
| `bias.json` | Bias per currency + gold | `code, cb, nextMeeting, net, structural (-2..+2), conviction (1-5), status (ACTIVE/FROZEN/EXPIRED), growth, inflation, cbPath{expectedBp, pricedBp}, thesis, driver{name,status}, positioning, invalidation, killSwitches[], reviewed, expires` | Nathan's input (shared store TBD); `pricedBp` from OIS / Market Context |
| `killswitches.json` | What kills or changes a bias | `id, currency, kind (data/cb/pricing/driver/price/expiry), condition, now, effect (flip/downgrade/upgrade/freeze/flat), status (armed/near/fired), firedOn` | kill-switch checker over data releases (external calendar) + drivers |
| `drivers.json` | Driver layer | `currency, driver, symbol, measure, move1m, corr20, corr60, effect (supports/neutral/conflict), secondOrder` | TradingView pull + rolling correlation |
| `levels.json` | Key levels (draft layout) | `note, families{key: label}, types{key: {family, desc}}, statuses{key: desc}, levels[{id, instrument, level, type, who, side, evidence, price, status (untested/defended/broken/reference/historical), lastTouch, source}]`. Families: hand (intervention, options, positioning, flow, cb-floor), cost (avwap, volume-profile), reference (period-open), macro (rate-spread, exporter-pain, yield-cap, fixing-peg) | manual + COT / flow / TradingView later |
| `indicators.json` | Indicator catalog (Economy Read Chain) | `layers, rates[], performance[], economies{CODE: {cb{name,url}, releases{inflation[],growth[],labour[]}, themes{...}}}` each {name, unit, impact, source}. impact `up` = a rise supports the currency, `down` = a fall does | hand-kept; live jobs fetch exactly this list |
| `recaps/index.json` | Recap archive | `recaps[{sunday, week, file, headline}]`, newest first | written by the Sunday recap job |
| `recaps/<sunday>.json` | One weekly recap | `sunday, week, period{start,end}, process{status, steps[{id,label}]}, overview{headline, globalScare, riskMood, bullets[], killSwitchesFired[], nextWeekTop[]}, economies[{code, name, cb, regime{growth,inflation}, scare (inflation/growth/both/neither), verdict, releases{inflation[],growth[],labour[]}, themes{inflation[],growth[],labour[]} each {name, unit, impact (up/down), latest, prior, expected, trend[6], source}, rates{y2{level,chgBp}, y10{level,chgBp}, policy, statement{nextMove, conviction, url}}, performance{rank, of, spread2yPolicyBp}, centralBank{stance, pricedStartBp, pricedEndBp, myPathBp, nextMeeting}, week{currencyPct, takeaways[], biasChange}, nextWeek[], process{stepId: read}}]` | Sunday recap agent, following Nathan's method (to define) |
| `history.json` | Bias change log | `date, currency, layer (net/structural/status), from, to, kind, killSwitch, reason, grade1w, grade4w` | written on each bias change; grader fills grades |

Rules baked into the pages: pair bias = base net − quote net (28 pairs, market-convention order);
pairs flagged when either side has a driver conflict or is frozen/expired; correlation is "strong" at |r| ≥ 0.5 (60d).

Regime quadrant (computed from growth / inflation direction; "flat" counts as neither up nor down):
inflation up + growth not down = Overheating (inflation scare); inflation up + growth down = Stagflation (both);
inflation not up + growth down = Slowdown (growth scare); otherwise Goldilocks (no scare).

## Economy Read Chain (weekly recap economy tabs)
Each economy is read in a fixed order: **Releases** (days) → **Themes** (weeks) → **Rates & Yields** (months) →
**Performance**. The indicator list per currency lives in `data/indicators.json`. Colour on each print = impact on
the currency, not the economy: green = supportive / hawkish, red = negative / dovish (falling inflation is red,
falling jobless claims green).

No calendar page: Nathan uses a separate economic calendar (Events page removed 2026-11-09). The old V5 model board link was removed from the nav at the same time.
