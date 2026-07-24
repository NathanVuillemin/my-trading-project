---
name: strategy-builder
description: Turn a user's trading strategy idea (indicators + rules + ticker + lookback years) into a Pine Script v6 strategy() file with dual raw/clean backtest modes, where "clean" excludes cached macro/news event windows from stats. Use when the user describes a new strategy, asks to build/generate a .pine file, or wants a strategy tested/backtested on a specific ticker over N years.
---

# Strategy Builder

Builds one Pine Script v6 `strategy()` file per invocation. Patterns below are adapted from
[TradersPost/pinescript-agents](https://github.com/TradersPost/pinescript-agents) (`pine-developer` +
`pine-backtester` skills) and Pine v6 2025 language updates. Cite these as source when relevant.

## Step 0 — always offer preset vs. custom before asking for rules

Before asking the user to describe strategy rules from scratch, `Glob` for `strategy-rules/*.md` (excluding
`_TEMPLATE.md` and `README.md`). Two cases:

- **Presets exist**: list them (name + one-line summary from each file's `## Entry`) and ask the user to pick
  one, or say they want something custom instead. Don't silently assume — always ask, even if only one
  preset exists.
- **No presets yet** (fresh `strategy-rules/`, only the template/README in it): say so and ask whether they
  want to describe a custom strategy now, or use `strategy-rule-writer` first to save one as a reusable preset
  before building. Either is fine — don't force a detour through `strategy-rule-writer` if they just want a
  one-off.

If they pick a preset, read `strategy-rules/<name>.md` — its Entry/Exit/Notes sections satisfy the "strategy
description" input below, no further questions needed on that front. If they name a preset that doesn't
exist, say so plainly and fall back to asking for a custom description, don't guess at rules.

If they describe a brand-new strategy inline and it seems worth keeping, offer to hand off to
`strategy-rule-writer` to save it as a `strategy-rules/<slug>.md` for reuse — but only on request, don't write
to that folder unprompted.

## Required inputs (ask if missing)

- **Strategy description**: entry/exit logic, indicators used, any macro-economic factors the user wants
  incorporated (e.g. rate regime, DXY, VIX as a filter via `request.security`). Satisfied by Step 0 if a saved
  strategy-rules file was used.
- **Ticker** (e.g. `NASDAQ:NVDA`).
- **Lookback window**: years of history to target, default 10, cap at what the exchange actually has listed.

Do not proceed to code generation until these three are known. Everything else (risk sizing, timeframe) can
default sensibly and be stated back to the user, not asked.

## Step 1 — Load or build the event cache

Path: `data/events/<TICKER>.json` (ticker with `:` and `/` replaced by `_`, e.g. `NASDAQ_NVDA.json`).

1. Check if the file exists and covers the requested lookback window. If yes and not stale (>90 days old for
   the trailing 2 years, no freshness requirement for older history), reuse it — do not re-research.
2. If missing or insufficient, research macro/news events materially relevant to *this specific ticker* over
   the window using WebSearch. Do not use a generic macro calendar — ground it in what actually moved this
   name (e.g. NVDA 2020 isn't just "COVID", check whether the move was pandemic demand, the 2022 crypto/gaming
   drawdown, or the 2023 AI boom — attribute correctly, cite sources).
3. Write/update the cache as:

```json
{
  "ticker": "NASDAQ:NVDA",
  "generated_at": "2026-07-18",
  "events": [
    {
      "start": "2020-02-20",
      "end": "2020-04-07",
      "label": "COVID crash",
      "category": "pandemic-macro",
      "rationale": "Broad market liquidity crisis, not company-specific signal",
      "confidence": "high",
      "sources": ["https://..."]
    }
  ]
}
```

- `category` values: `pandemic-macro`, `war-geopolitical`, `monetary-policy`, `earnings-shock`,
  `sector-rotation`, `liquidity-crisis`, `other`. Only include windows where the move was driven by something
  outside the strategy's own signal logic — not every drawdown qualifies.
- Keep windows tight (days/weeks), not entire years, unless the event genuinely spans that long.

## Step 2 — Pine v6 conventions (hardcode these, don't improvise)

From Pine v6 2025 updates and the pine-developer checklist:

- **UDT-first architecture**: define user-defined types for trades/state before calculation logic. Bundle
  data with drawing/methods where applicable.
- **Loops**: use `for...in` over arrays, never a classic counted `for` with a mutable bound (March 2025 change
  made `to_num` re-evaluate per iteration — infinite-loop risk if the array can grow/shrink).
- **Drawing coordinates**: use `xloc.bar_time` (unlimited historical lookback) instead of `xloc.bar_index`
  (hard 5000-bar limit) for anything referencing older bars.
- **Hard limits to respect**: 64 drawing objects max, 40 `request.security()` calls max, 500 combined
  plot/hline/fill outputs, 5000-bar historical index reference limit (use time-based refs instead).
- **Line wrapping** (Dec 2025 rule): inside parens, indentation is flexible; outside parens, indentation must
  not be a multiple of 4 spaces; ternaries stay on one line.
- Scopes are unlimited across functions/methods/loops/conditionals (Feb 2025) — don't artificially flatten
  logic to avoid a scope-depth limit that no longer exists.

## Step 3 — Dual raw/clean backtest mode (this project's core requirement)

Every generated strategy must expose a boolean input toggle, e.g. `excludeEventWindows = input.bool(true,
"Exclude macro/event windows (clean mode)")`, and embed the cached event windows as time-range pairs:

```pine
// Event windows loaded from data/events/<TICKER>.json at generation time — regenerate if cache changes.
var eventStarts = array.from(timestamp("2020-02-20T00:00:00"), timestamp("2022-02-24T00:00:00"))
var eventEnds   = array.from(timestamp("2020-04-07T00:00:00"), timestamp("2022-03-15T00:00:00"))

f_inEventWindow() =>
    inWindow = false
    for i = 0 to array.size(eventStarts) - 1
        if time >= array.get(eventStarts, i) and time <= array.get(eventEnds, i)
            inWindow := true
    inWindow

blocked = excludeEventWindows and f_inEventWindow()
```

Gate entries with `if longCondition and not blocked` (never gate exits — always allow the strategy to close a
position it's already in, even inside an event window, to avoid unrealistic frozen exposure).

**Also track both equity paths in parallel, regardless of the input toggle**, so one run — headless or in
TradingView — captures the comparison instead of requiring two separate runs with the toggle flipped:

```pine
var float rawEquity   = 0.0
var float cleanEquity = 0.0
// update both on every bar using the strategy's own P&L logic, one gated on `blocked`, one not
plot(rawEquity,   "Raw Equity (all bars)",         color.orange)
plot(cleanEquity, "Clean Equity (event-excluded)",  color.blue)
```

Named exactly `rawEquity` / `cleanEquity` so `pine-backtester` (see `.claude/agents/pine-backtester.md`) can
read both series out of one PineTS run without re-executing the script. The `excludeEventWindows` input still
controls which mode the strategy actually *trades* live/on-chart in TradingView — the parallel plots are for
comparison only, they don't place orders themselves.

Report **both** stat sets to the user: raw (all bars) and clean (event bars excluded from the entry
decision). The gap between them is the actual "is this signal or is this noise/luck" answer the user asked
for — call it out explicitly in the notes file, don't bury it.

## Step 4 — Required strategy scaffolding

- `//@strategy_alert_message {{strategy.order.alert_message}}` immediately after the `strategy()` declaration.
- Mandatory stats/plots: net P/L, win rate, trade count, max drawdown, equity curve. Sharpe/Sortino optional
  but preferred if the user is comparing multiple strategies.
- Anti-repainting: gate any "final" decision logic on `barstate.isconfirmed` where the strategy would
  otherwise act on an unconfirmed bar; use `barstate.islastconfirmedhistory` only for one-time historical
  setup, never for entry/exit logic itself.

## Step 5 — Output

Write to `pine/<strategy-slug>/v<N>.pine` (increment N if the slug already has versions — never overwrite a
prior version silently) and a sibling `notes.md` containing: strategy description as understood, ticker,
window, event windows applied (with sources), and the raw-vs-clean framing.

## Step 6 — Hand off

Tell the user the file is ready and that **strategy-reviewer** should run before they trust it, or invoke
**pine-strategy-pipeline** next time to do build+review in one shot. State plainly: no headless engine here
is authoritative — the real backtest numbers come from pasting into TradingView's Strategy Tester. PineTS
(`scripts/pinets-sanity-check.mjs`) only sanity-checks that the script runs; its v6 `strategy()` support is
experimental (see [LuxAlgo/PineTS](https://github.com/LuxAlgo/PineTS)), so treat divergence from TradingView
as PineTS's limitation, not proof of a bug, unless the syntax checker also flags something.
