# Drivers page: who is driving, and when it stops (design)

Date: 2026-11-17. Status: approved direction, written for the build.

## Intent

Nathan wants to know which outside force is moving a market right now, and to see the moment it lets go.
Example: gold rises because the dollar weakens; while gold and the dollar move tightly against each other,
he reads gold through the dollar. When that link loosens, the dollar has stopped driving gold and he drops
it from his read. Same for oil and CAD during a Middle East escalation. He supplies the news reason himself;
the desk tells him whether the link is still in control, how unusual today is against its normal, and how
the link has behaved before in the kind of market we are in now.

Drivers are not only asset against asset. Each economy has real-world drivers (New Zealand: dairy exports;
Australia: iron ore, copper, China; Canada: oil and the US economy; Japan: the US yield gap and imported
energy; the euro area: gas). Those count as drivers too, measured through a tradeable or published proxy.

Origin: the task was to move the parked "macro pulse" crypto feed onto the desk. Nathan redirected:
crypto stays off the desk except Bitcoin as one reading, and the real need is drivers plus correlations.

## Goals

1. One Drivers page holding both the existing cross-asset readings and a new "Who is driving" section.
2. A fixed, curated list of the links that normally hold, grouped by the currency (or gold, Bitcoin) they drive.
3. Each link measured over three windows, each against its own normal:
   - **3 days** from hourly bars, normal = its range over the last 2 years (Yahoo keeps 2 years of hourly data).
   - **20 days** and **60 days** from daily closes, normal = their range over the last 5 years.
4. For each link a plain state: **in control** or **not in control**, the date that state began, and an early
   warning when the 3-day reading breaks while the 20-day still says in control.
5. Click a link to open a deep dive: its 5-year history against the normal band, how big a move in the target
   typically follows a 1% move in the driver, and how the link behaves in each kind of market, with today's
   kind highlighted.
6. A market-regime read on top of the section, built from Nathan's own earlier method (Macro Tracker v5,
   sheets "Risk & Gold" and "Hub"), plus safe havens.
7. Remove the Risk page (it moves to his journaling dashboard later).

## Non-goals

- No crypto besides Bitcoin. The macro-pulse collector (stablecoins, Deribit, crypto Fear & Greed) is not shown.
- No trade calls, no bias. The desk measures; Nathan decides.
- No intraday refresh. Everything is computed in the nightly CI run; the 3-day window is "the 3 days up to
  the run".
- No TradingView data. No TradingView MCP is connected, and an MCP runs on Nathan's machine, not in CI.
- No note field per link in this version (he brings the news reason himself; a written story per link can come later).
- Nothing from Ozkar's debrief (his material stays private, see brain note "Ozkar Morning Debrief").

## Anti-goals (failure even if it works)

- A precise-looking number resting on too little data (a 3-point daily correlation). Every reading shows how
  many observations it used; below a minimum it shows "not enough data", not a number.
- Green/red. Desk colour rule: blue = bullish, red = bearish, never green. Here the states are not bullish or
  bearish, so use the accent (in control), faint (not in control) and warn/amber (breaking) tokens.
- A table that only repeats the "correlations" section of Ozkar's debrief. What the desk adds: the
  in-control state with its start date, the 3-day early warning, the 5-year normal, and behaviour by regime.

## Constraints

- Repo is public: no personal data.
- Desk rule (dashboard/desk/README.md): the desk shows no data Nathan gets elsewhere, with exceptions he asks
  for. This is one (asked 2026-11-17), next to Positioning.
- Keyless sources only, runnable in GitHub Actions: Yahoo Finance chart API, FRED fredgraph.csv.
- Yahoo forex daily bars are midnight-London snapshots: the bar dated D holds D-1's close. The existing engine
  already handles this (use the FX bar's open as the previous business day's close). Keep that.
- Desk patterns: thin HTML shell per page, one renderer per page in `dashboard/desk/assets/desk.js`, data via
  `loadLive`, shared chart helpers (`lineSvg`, etc.), colour tokens in `desk.css`.
- Nathan prefers visuals first (dials, sparklines), numbers second. He uses the desk on a laptop and an iPad.

## Approaches considered

1. **Extend the existing correlation engine** (`scripts/correlations.mjs`), run it nightly again, render on
   Drivers. It already does 20/60-day Pearson on daily moves, the FX date trap, status against typical
   direction, and 6 months of history. Chosen: least new code, already verified against the data trap.
2. A new separate engine and page. Rejected: duplicates the engine and splits drivers across two pages, which
   Nathan explicitly asked to combine.
3. TradingView as the data source (MCP or the keyless scanner in `scripts/tradingview.mjs`). Rejected: the
   MCP cannot run in CI, and the scanner gives snapshots, not the 5-year and hourly history this needs.

Nathan approved approach 1 on 2026-11-17.

## The links (curated; Nathan can ask to add or drop)

`typical` is the usual sign of the correlation between the two as quoted. `story` is the real-world reason,
one line, shown on the page.

| Group | Link (target / driver) | Typical | Story |
|---|---|---|---|
| USD | DXY / US 2Y yield | + | Dollar follows the expected Fed path |
| EUR | EURUSD / TTF gas (`TTF=F`) | - | Europe imports its energy: dearer gas, weaker euro |
| GBP | GBPUSD / S&P 500 | + | Mildly risk-on currency. Its gilt driver is the 2Y spread link below |
| JPY | USDJPY / US 10Y yield | + | Wider US-Japan yield gap lifts USDJPY |
| JPY | USDJPY / WTI oil | + | Japan imports its oil: dearer oil weakens the yen |
| JPY | AUDJPY / S&P 500 | + | Risk barometer: risk-on sells the yen |
| CHF | USDCHF / VIX | - | Fear pulls haven money into the franc |
| CAD | USDCAD / WTI oil | - | Oil is Canada's biggest export: oil up, CAD up |
| CAD | USDCAD / S&P 500 | - | The US is Canada's main customer: US growth lifts CAD |
| AUD | AUDUSD / iron ore (`TIO=F`) | + | Australia's biggest export |
| AUD | AUDUSD / copper | + | China and global building demand |
| AUD | AUDUSD / USDCNY | - | China is Australia's biggest customer: a firmer yuan lifts AUD |
| NZD | NZDUSD / GDT dairy price index | + | Dairy is New Zealand's biggest export. Auctions are every two weeks: shown as level and trend, no correlation windows |
| NZD | NZDUSD / USDCNY | - | China is New Zealand's biggest dairy customer |
| NZD | NZDUSD / S&P 500 | + | Risk-on currency |
| Gold | Gold / DXY | - | Gold is priced in dollars |
| Gold | Gold / US 10Y real yield | - | Gold pays no yield: higher real yields raise the cost of holding it |
| Bitcoin | Bitcoin / Nasdaq 100 | + | Bitcoin trades as a high-beta risk asset |

**Rate differentials** (added after looking through Market Context, 2026-11-17). Its own model says three
forces move a currency (data, central banks, what is priced) and its pair view puts the 2Y spread in the
middle. The 2Y gap against the US is the most direct "expectations" driver, so each currency gets one more
link: `<CCY>USD` (or `USD<CCY>`) against the 2Y yield spread (its 2Y minus the US 2Y, daily change), typical
`+` as `<CCY>USD`. Free daily sources, probed 2026-11-17:

| Currency | 2Y source | Probe |
|---|---|---|
| CAD | Bank of Canada Valet API, `BD.CDN.2YR.DQ.YLD` | works, daily, JSON |
| GBP | Bank of England database, `IUDSNPY` (2Y gilt) | works, daily, CSV. Gives GBP its gilt driver |
| AUD | RBA table F2 CSV | works, daily |
| JPY | Japan MoF JGB CSV (`jgbcme_all.csv` for history) | current-month file loads; history file to check |
| EUR | Bundesbank statistics API (German 2Y, `BBSIS` daily series) | reachable; needs the right request format (406 on the first try) |
| CHF | SNB data portal | monthly only in the cube tried: no daily 2Y found, mark missing |
| NZD | RBNZ B2 | blocks scripts (403): mark missing |

No figures are taken from Market Context itself: it is paid material and the desk is public. Things it has
that the desk leaves out on purpose: the rolling 30-day data-surprise line (no free consensus data), what is
priced per bank, and per-release beat/miss counts (the Scorecard's release-to-reaction tally covers the
reaction side). It has no commodities, cross-asset drivers or correlations.

Dropped from the old list (my call): pure quote mechanics that are always correlated and say nothing about a
driver (EURUSD/GBPUSD, AUDUSD/NZDUSD, EURUSD/USDCHF, USDJPY/USDCHF, EURUSD/DXY, AUDUSD/USDCAD). AUDUSD/copper
and the gold and yield links stay.

Data checked on 2026-11-17: Yahoo serves 5 years of daily bars for `TTF=F`, `TIO=F`, `HG=F`, `CL=F`, `GC=F`,
`DX-Y.NYB`, `CNY=X` (not `CNH=X`, which returns one bar), `^GSPC`, `^NDX`, `^VIX`, `BTC-USD`, `XLY`, `XLP`,
`TLT`, `AUDJPY=X`; 2 years of hourly bars for FX, gold, oil, DXY, VIX, `^TNX` (US hours only), `BTC-USD`.
FRED: `DGS2` and `DFII10` daily back decades; `BAMLH0A0HYM2` only from 2023-11 (licence limit). GDT: the
results page loads (HTTP 200) but its data sits in page scripts; parsing it is the builder's job, and if no
stable source works, NZ dairy shows as missing.

## Readings per link

For every link with daily data, from aligned daily moves (log returns; daily change for yields):

- `r20`, `r60`: Pearson correlation over the last 20 and 60 shared trading days.
- Normal: from the rolling `r20` and `r60` series over the last 5 years: the 10th, 50th and 90th percentile.
  The page shows today's value against that band.
- `r3d`: Pearson correlation of hourly moves over the **last 3 trading days on which both sides traded**
  (UTC hour-aligned bars, returns between consecutive shared timestamps, all shared bars in those 3 days).
  Not 72 clock hours: a Monday run would then hold mostly weekend. For 23-hour markets this is about 65
  moves; for links with a US-hours side (`^GSPC`, `^NDX`, `^TNX`) about 20. Those links do get a 3-day
  reading from US-hours bars (my call), and the page shows the observation count next to it.
  Normal: percentiles of the same 3-day reading over the last 2 years, sampled once per trading day.
  Minimum 18 shared hourly moves, else "not enough data".
  Links without hourly data for both sides (US 2Y, real yield, 2Y spreads, iron ore, TTF, CNY, GDT) show the 3-day slot
  as "no hourly data". USDJPY / US 10Y uses `^TNX` hourly.
- `beta60`: slope of the target's daily move on the driver's daily move over 60 days, expressed as "a 1% move
  in the driver goes with an X% move in the target" (yields: per 10 bp).

### In control or not

Using `aligned = r * sign(typical)`:
- **In control** when aligned `r20` >= 0.5.
- **Not in control** when aligned `r20` < 0.3.
- Between 0.3 and 0.5: keeps the previous state (hysteresis, so it does not flicker).
- **Moving the wrong way**: a flag on "not in control" (not a third state) while aligned `r20` <= -0.3. It
  shows as a small tag beside the state pill; the flag drops as soon as aligned `r20` rises above -0.3. The
  "share of days in control" figure counts only in-control days. (My call: keeps two states and two colours.)
- `since`: the date the current state began, found by walking back through the daily `r20` series with the
  same hysteresis rule.
- **Breaking** (early warning): in control on 20 days, but aligned `r3d` below the 10th percentile of its normal.
- The 60-day reading is context (is this a long-standing link?), not part of the state.

Thresholds 0.5 / 0.3 are the ones already in the brain note "Correlation Pairs" (starting values, untested).

## Market regime

From Macro Tracker v5 ("Risk & Gold", "Hub"), with safe havens added. All computed daily over 5 years so the
deep dives can split history by it.

1. **VIX rule** (Nathan's investing "Layer 3"): risk-on when VIX < 18 and the S&P 500 is above its 200-day
   average; risk-off when VIX > 30; otherwise caution.
2. **Barometer**, five gauges, each read from its 20-day change:
   - AUDJPY rising = risk-on.
   - Copper / gold ratio rising = risk-on.
   - US high-yield spread falling = risk-on (FRED, history from 2023-11 only; before that the gauge is absent
     and the verdict uses the other four).
   - Discretionary / staples (XLY / XLP) rising = risk-on.
   - Safe havens: average 20-day return of yen (inverse USDJPY), franc (inverse USDCHF), gold and long
     Treasuries (TLT), minus the S&P 500's. Havens beating stocks = risk-off.
   - Each gauge reads neutral when its 20-day change is within 0.25 standard deviations of its 20-day changes
     over the past year.
   - Verdict: risk-on or risk-off when that side leads by 2 or more gauges, else mixed (Excel rule).
3. **Do they agree?** (Excel rule): VIX rule and barometer the same = yes; either mixed or caution = partly,
   size down; opposite = no, trust neither.
4. **Two more splits** for the deep dives: US rates (2Y change over 63 trading days: > +25 bp rising,
   < -25 bp falling, else flat) and the dollar (DXY over 63 days: > +2% strengthening, < -2% weakening, else
   flat). Thresholds are my call.
5. **Economic state of each currency**: the growth x inflation direction from the newest Scorecard card,
   shown in that currency's deep dives as context. Nathan's own entry (`currencies.X.growth.dir`,
   `.inflation.dir`) first; where he left it blank, the Market Context auto value (`currencies.X.auto...`),
   labelled as such. Not a history split (scorecards only go back two weeks). (My call.)

**Which risk read splits the history** (my call): the deep-dive regime table splits by the **VIX rule**
(risk-on / caution / risk-off). It is Nathan's own rule, and it has a clean 5-year history (fetch about 6
years so the 200-day average is warm from the start). The barometer and "do they agree?" are shown for today
in the banner, with their own history line, but do not split the 5-year table: the high-yield gauge only
starts in 2023-11 and the neutral band needs a year of warm-up, so their older readings are not comparable.

Dropped from the Excel barometer: crypto/CNN Fear & Greed and the hand-read asset scoreboard (not measurable
daily for free).

## Deep dive (on click)

Per link, opened in place under its row (one open at a time) on laptop and iPad:
- 5-year line of `r60` (and `r20` lighter) with the 10th-90th percentile band shaded and the 0.5 / 0.3 lines.
- Last 6 months of daily `r20` for detail, with state changes marked.
- Beta now, and a table by regime: for each value of the VIX rule, the rates split and the dollar split:
  median `r60`, median beta, share of days the link was in control. Today's regime rows highlighted.
- The story line, the currency's economic state from the Scorecard, link to Countries for that currency.
- Sources, as-of dates, observations used.

## Page layout (Drivers)

1. Heading and blurb updated to say drivers and correlations.
2. **Market regime** banner: VIX rule pill, the five barometer gauges as small arrows with 20-day sparklines,
   verdict, "do they agree?", rates and dollar splits.
3. **Who is driving**: grouped by USD, EUR, GBP, JPY, CHF, CAD, AUD, NZD, Gold, Bitcoin. Each row: "Oil -> CAD"
   style label, story, three small dials (-1 to +1 track, normal band shaded, marker for today) for 3d / 20d /
   60d, state pill with "since <date>", breaking flag. Row click opens the deep dive.
4. Existing panels unchanged below (liquidity, gold stack, curve, growth, inflation, bounce, stock-bond, 28 pairs).
   The existing stock-bond panel stays as is.
5. Data warnings and missing drivers (CHF and NZD 2Y spreads; GDT if parsing fails) listed at the bottom of the section.

## Risk page removal

Delete `dashboard/desk/risk.html`, its `PAGES` entry and `render.risk` in `desk.js`, and CSS used only by it.
README table row removed. Browser localStorage key `desk.risk` is left alone (harmless).

## CI and data

- `.github/workflows/whale-flow.yml`: the correlations step runs every night again (drop its `if: inputs.full`)
  and its outcome stays in the summary. The macro-pulse step is gated behind `inputs.full` like the other
  parked collectors (crypto is off the desk); its script and snapshots are untouched.
- Output stays `dashboard/desk/data/correlations.json` (new shape: `asOf, generatedAt, method, sources,
  missing, errors, regime{now, history}, links[...]`) plus the slim daily archive in `data/correlations/`.
  Keep the page file under about 600 KB: downsample long histories (weekly points for 5 years, daily for the
  last 6 months).
- Non-fatal per series, as today: one dead source records an error, the rest still write.

## Docs

- `dashboard/desk/README.md`: Drivers row (new section, deep dive, regime), Risk row removed, rule exception
  recorded, `correlations.json` row replaced with the new shape and its script.
- Brain note "Correlation Pairs": update the pair list and windows after the build (brain, not the repo).

## Left to the builder

- Exact file split (one script or helpers), test framework (follow what the repo uses; pure functions such as
  alignment, Pearson, state and `since`, regime gauges get unit tests).
- Dial and row styling within the desk's tokens; mobile wrapping.
- GDT parsing approach, or marking it missing.
- Downsampling details and exact JSON field names beyond those above.
