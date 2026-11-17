# Drivers + Correlations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the parked correlation engine into a nightly "who is driving" feed (3d/20d/60d against normal, in-control state, market regime, deep dive by regime) shown on the desk's Drivers page; remove the Risk page.

**Architecture:** Pure maths in `scripts/lib/corr-math.mjs` (unit-tested with `node:test`), data fetchers in `scripts/lib/corr-sources.mjs`, link list + orchestration in `scripts/correlations.mjs` writing `dashboard/desk/data/correlations.json`. The page renders it inside `render.drivers` in `dashboard/desk/assets/desk.js`.

**Tech Stack:** Node 24 (built-in fetch, `node:test`), vanilla JS + inline SVG on the desk.

**Spec:** `docs/superpowers/specs/2026-11-17-drivers-correlations-design.md`

## Global Constraints

- Keyless sources only (Yahoo chart API, FRED fredgraph.csv, central-bank public files). Runs in GitHub Actions.
- Keep the FX date trap fix: Yahoo `=X` daily bars use the bar's open as the previous business day's close.
- In control: aligned r20 >= 0.5. Not in control: aligned r20 < 0.3. Between: keep previous state. Wrong-way flag: aligned r20 <= -0.3.
- Breaking: in control and aligned r3d below the 10th percentile of its 2-year normal.
- 3-day: all shared hourly moves in the last 3 trading days both sides traded; minimum 18 moves.
- Normals: p10/p50/p90 of rolling r20 and r60 over 5 years; of r3d over 2 years, sampled once per trading day.
- VIX rule: risk-on VIX < 18 and S&P > 200-day; risk-off VIX > 30; else caution.
- Barometer gauges read their 20-day change; neutral within 0.25 standard deviations of the past year's 20-day changes; verdict needs a lead of 2.
- Splits: US 2Y over 63 days > +25 bp rising / < -25 bp falling; DXY over 63 days > +2% / < -2%.
- Colours: accent = in control, faint = not in control, warn = breaking. No green.
- `correlations.json` under ~600 KB.
- Public repo: nothing from Market Context or Ozkar.

## Review Focus

1. A source down (e.g. Bundesbank, GDT, Yahoo 429): the link shows "no data" with the error listed; the run still writes and exits 0 unless half the series fail. Test: `buildLink` with a missing series returns `status: 'no data'`.
2. Monday run: the 3-day window skips the weekend and still finds 3 trading days. Test in `threeDayWindow`.
3. A US-hours side (`^GSPC`, `^TNX`) gives ~20 moves; with fewer than 18 it returns `null` and `n`. Test.
4. A link whose r20 hovers between 0.3 and 0.5 must not flicker; `since` stays at the last real change. Test in `linkState`.
5. Yield series (daily changes, not log returns) mixed with price series: alignment uses the right step per kind. Test in `dailyMoves`.

---

### Task 1: Correlation maths

**Files:**
- Create: `scripts/lib/corr-math.mjs`
- Test: `scripts/lib/corr-math.test.mjs`
- Modify: `package.json` (add `"test:corr": "node --test scripts/lib/"`)

**Interfaces:**
- Produces:
  - `pearson(x: number[], y: number[]) -> number|null` (null when n < 3 or zero variance)
  - `dailyMoves(a: Map<date,num>, b: Map<date,num>, kindA, kindB) -> {dates, a, b}` (kind `'yield'` = difference, else log return; only shared dates)
  - `rolling(moves, w) -> (number|null)[]` (r over window ending at each index)
  - `pctl(values: number[], p: number) -> number|null` and `normalBand(values) -> {p10, p50, p90}|null`
  - `beta(x, y) -> number|null` (slope of y on x)
  - `hourlyMoves(a: Map<epochSec,num>, b, kindA, kindB) -> {t, a, b}` (shared UTC hour stamps)
  - `threeDayWindow(moves) -> {a, b, n}` (moves whose UTC date is among the last 3 distinct UTC dates present)
  - `r3dSeries(moves) -> {date, r}[]` (one value per trading day over the history, using the same 3-day rule; null when n < 18)
  - `linkState(r20s: (number|null)[], dates: string[], typical: 'positive'|'inverse') -> {state: 'in'|'out', since: string, wrongWay: boolean}`
  - `vixRule(vix, spx, spx200) -> 'risk-on'|'caution'|'risk-off'`
  - `gaugeRead(chg20: number, sd: number, risingIsOn: boolean) -> 'on'|'off'|'neutral'`
  - `verdict(reads: string[]) -> 'risk-on'|'risk-off'|'mixed'`
  - `agree(vix, verdict) -> 'yes'|'partly'|'no'`
  - `split3(chg, up, down, labels) -> label` (rates and dollar splits)
  - `regimeTable(rows: {r60, beta, inCtrl, vix, rates, dollar}[]) -> {vix:{[k]:{r60, beta, shareIn, n}}, rates:{...}, dollar:{...}}` (medians)

- [ ] **Step 1: Write failing tests** in `scripts/lib/corr-math.test.mjs` with `node:test` + `assert/strict`:
  - `pearson([1,2,3,4],[2,4,6,8]) === 1`; `pearson([1,2,3,4],[4,3,2,1]) === -1`; `pearson([1,1],[1,2]) === null`.
  - `dailyMoves`: yield kind `{d1:4.0, d2:4.1}` gives move `0.1` (±1e-9); price kind `{d1:100,d2:110}` gives `Math.log(1.1)`; dates only where both have a value.
  - `threeDayWindow`: moves stamped Thu, Fri, Mon (no weekend bars) → all three days kept, Wed dropped.
  - `r3dSeries`/window with 10 shared moves → r `null`, `n: 10`.
  - `linkState` positive, r20s `[0.6,0.45,0.35,0.45,0.2,0.4]` → `state:'out'`, `since` = date of index 4. r20s `[0.2,0.55,0.4,0.31]` → `'in'`, since index 1. Inverse, r20 `[-0.6]` → `'in'`. Positive `[0.6,-0.4]` → `out`, `wrongWay: true`.
  - `vixRule(17, 5000, 4800) === 'risk-on'`; `vixRule(17, 4700, 4800) === 'caution'`; `vixRule(31, 5000, 4800) === 'risk-off'`; `vixRule(20,5000,4800) === 'caution'`.
  - `gaugeRead(0.1, 1, true) === 'neutral'`; `gaugeRead(0.5,1,true)==='on'`; `gaugeRead(0.5,1,false)==='off'`.
  - `verdict(['on','on','off','neutral','on']) === 'risk-on'` (3-1 = 2); `verdict(['on','off','neutral'])==='mixed'`.
  - `agree('risk-on','risk-on')==='yes'`; `agree('caution','risk-on')==='partly'`; `agree('risk-on','mixed')==='partly'`; `agree('risk-off','risk-on')==='no'`.
- [ ] **Step 2: Run** `node --test scripts/lib/` → FAIL (module missing).
- [ ] **Step 3: Implement** the functions above. `linkState` walks forward with the hysteresis rule from the first non-null value (initial state from the first value: in if aligned >= 0.5 else out); `since` = date the state last switched (or first date). `verdict` counts `'on'` and `'off'`.
- [ ] **Step 4: Run** `node --test scripts/lib/` → all pass.
- [ ] **Step 5: Commit** `feat: correlation maths for the drivers page (tested)`.

### Task 2: Data sources

**Files:**
- Create: `scripts/lib/corr-sources.mjs`
- Test: manual probe script run (network), no unit test.

**Interfaces:**
- Produces (all return `Map`; throw with a short message on failure):
  - `yahooDaily(symbol, range='6y') -> Map<'YYYY-MM-DD', number>` (move the existing `yahoo()` from `correlations.mjs`, incl. FX open-shift and weekend drop)
  - `yahooHourly(symbol) -> Map<epochSec, number>` (`range=2y&interval=1h`, closes; FX too: hourly bars are not shifted)
  - `fred(id, years=6) -> Map<date, number>`
  - `cb2y(ccy) -> Map<date, number>` for `CAD` (BoC Valet `BD.CDN.2YR.DQ.YLD`), `GBP` (BoE `IUDSNPY`), `AUD` (RBA F2 CSV, 2-year column), `JPY` (MoF `jgbcme_all.csv`, 2Y column), `EUR` (Bundesbank BBSIS daily 2Y). Throws `no free daily 2Y` for `CHF`, `NZD`.
  - `gdt() -> Map<date, number>` (GDT price index by auction date) or throws.
- [ ] **Step 1:** Implement; each fetch uses `AbortSignal.timeout(30000)` and a desk User-Agent.
- [ ] **Step 2:** Run a scratch probe printing `size`, first and last entry for each source. Expected: Yahoo daily ~1500 rows from 2020; hourly ~12k for FX; each `cb2y` with recent values matching the order of magnitude seen in the spec probe. Record which of EUR/JPY/GDT failed; failures stay "missing", not blockers.
- [ ] **Step 3: Commit** `feat: keyless sources for drivers (Yahoo daily/hourly, FRED, central-bank 2Y, GDT)`.

### Task 3: Engine and output

**Files:**
- Modify (rewrite): `scripts/correlations.mjs`
- Test: `scripts/lib/corr-math.test.mjs` (add `buildLink` no-data test) — `buildLink` lives in `corr-math.mjs`.

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces `dashboard/desk/data/correlations.json`:
  ```
  { asOf, generatedAt, method, sources, missing[], errors[],
    regime: { asOf, vix:{value, spx, spx200, rule}, gauges:[{key,label,chg20,read,spark[]}], verdict, agree,
              rates:{chg63bp, split}, dollar:{chg63pct, split}, history:[{date, rule, verdict}] (weekly, 5y) },
    links: [{ id, group, target, driver, labelT, labelD, typical, story, kind:'corr'|'level',
              r3d:{r, n, normal}|null, r20:{r, normal}, r60:{r, normal}, beta60, betaUnit:'1%'|'10bp',
              state, since, wrongWay, breaking, obs,
              history:{ weekly:[[date, r60, r20]] (5y), daily:[[date, r20]] (6m), changes:[[date,state]] },
              byRegime: { vix:{}, rates:{}, dollar:{} }, asOfT, asOfD, status? }] }
  ```
  `kind:'level'` (GDT) carries `level:{value, chg3m, history:[[date,v]]}` instead of r fields.
- [ ] **Step 1: Failing test:** `buildLink(cfg, {}, {}, regimeByDate)` with no series → `{status:'no data'}`.
- [ ] **Step 2: Implement** `buildLink(cfg, daily, hourly, regimeByDate)` in `corr-math.mjs` (daily = series maps by key; computes everything above for one link). Run tests → pass.
- [ ] **Step 3: Rewrite `correlations.mjs`:** `SERIES` (Yahoo daily: EURUSD=X GBPUSD=X AUDUSD=X NZDUSD=X JPY=X CHF=X CAD=X AUDJPY=X DX-Y.NYB GC=F CL=F HG=F TIO=F TTF=F CNY=X ^GSPC ^NDX ^VIX BTC-USD XLY XLP TLT; FRED DGS2 DFII10 BAMLH0A0HYM2; hourly: the FX pairs, AUDJPY, DX-Y.NYB, GC=F, CL=F, HG=F, ^GSPC, ^NDX, ^VIX, ^TNX, BTC-USD; 2Y: `cb2y` per CCY; spread series = cb2y(ccy) − DGS2 on shared dates, kind yield). `LINKS` = the spec's table plus the 2Y spread links (`id`, `group`, `target`, `driver`, `typical`, `story`), US 10Y daily from FRED `DGS10`, hourly from `^TNX`. Compute the regime history first (VIX rule, gauges, verdict, agree, rates/dollar splits per date), then each link. Keep the slim archive `data/correlations/<date>.json` (`{asOf, links:[{id, r3d, r20, r60, state}]}`). Exit 1 only if half the series failed.
- [ ] **Step 4: Run** `npm run correlations`. Expected: one line per link with r3d/r20/r60/state; file written; `ls -l` size < 600 KB; spot-check: Gold/DXY r60 negative, USDCAD/WTI negative.
- [ ] **Step 5: Commit** `feat: who-is-driving engine (3d/20d/60d vs normal, state, regime splits)` including the regenerated JSON.

### Task 4: Drivers page

**Files:**
- Modify: `dashboard/desk/assets/desk.js` (`render.drivers`, new helpers next to `lineSvg`), `dashboard/desk/assets/desk.css`, `dashboard/desk/drivers.html` only if the title needs it.

**Interfaces:**
- Consumes: `correlations.json` via `loadLive('correlations', true)`.
- Produces helpers: `corrDial(r: {r, normal, n?}|null, typical, label) -> svg string`, `regimeBanner(regime) -> html`, `linkRow(link) -> html`, `linkDeepDive(link, scorecardCard) -> html`.
- [ ] **Step 1:** `render.drivers` loads `correlations` (optional) and the newest scorecard card (`scorecard-index` → `scorecard-<monday>`, optional) alongside `drivers`; heading/blurb mention drivers and correlations.
- [ ] **Step 2:** Regime banner: VIX rule pill + value, five gauges (arrow, label, 20d sparkline via `lineSvg`), verdict pill, "do they agree?" line, rates and dollar splits.
- [ ] **Step 3:** "Who is driving" grouped by USD EUR GBP JPY CHF CAD AUD NZD Gold Bitcoin. Row: "Driver → target" label, story, three dials (track −1..+1, p10–p90 band shaded, marker coloured by state, `n` shown for r3d), state pill (accent "in control" / faint "not in control") with "since <date>", wrong-way tag, warn "breaking" pill. Missing/no-data links show a faint line with the reason.
- [ ] **Step 4:** Click row (event delegation on `main`, `data-link` id) toggles one deep dive under it: 5y weekly r60 + r20 `lineSvg` with p10–p90 band and 0.5/0.3 hlines (sign-adjusted for inverse links), 6-month daily r20 with state-change markers, beta sentence ("a 1% move in X goes with a Y% move in Z"), by-regime table with today's row highlighted, currency's economic state (own growth/inflation dir, fallback `auto`, labelled), Countries link, sources/as-of/obs.
- [ ] **Step 5:** Existing panels unchanged below. Data warnings + missing list at the end of the section.
- [ ] **Step 6:** Preview `npm run desk` → http://localhost:8787/desk/drivers.html: no console errors; click two rows; check a 375px width.
- [ ] **Step 7: Commit** `feat(desk): who-is-driving section and deep dive on Drivers`.

### Task 5: Remove Risk page

**Files:**
- Delete: `dashboard/desk/risk.html`. Modify: `desk.js` (`PAGES` entry, `render.risk`), `desk.css` (rules used only by risk: check `heat-bar`, `form-grid` usage before deleting).
- [ ] **Step 1:** Remove; `grep -n "risk.html\|render.risk\|heat-bar" dashboard/desk -r` → no hits (except CSS still used elsewhere).
- [ ] **Step 2:** Preview: nav has no Risk; every page loads.
- [ ] **Step 3: Commit** `chore(desk): remove the Risk page (moves to the journaling dashboard)`.

### Task 6: CI, README, brain

**Files:**
- Modify: `.github/workflows/whale-flow.yml`, `dashboard/desk/README.md`, `package.json` (`refresh` unchanged).
- [ ] **Step 1:** Workflow: correlations step without `if: inputs.full`, named "Drivers: who is driving (Yahoo + FRED + central banks)"; macro-pulse step gets `if: inputs.full`; header comment updated (desk feeds now include correlations; macro pulse parked 2026-11-17, crypto off the desk).
- [ ] **Step 2:** README: Drivers row describes the new section, deep dive and regime; Risk row removed; rule exception recorded (2026-11-17); `correlations.json` row replaced with the new shape and `npm run correlations`; `npm run test:corr`.
- [ ] **Step 3:** Brain: update note "Correlation Pairs" (links, windows, state rule, regime) via `brain_capture` or by editing the vault note.
- [ ] **Step 4: Commit** `ci+docs: run the drivers engine nightly, park macro pulse, README`.
