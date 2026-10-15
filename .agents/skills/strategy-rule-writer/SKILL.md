---
name: strategy-rule-writer
description: Guides turning a trading idea into a saved, reusable strategy-rules/<slug>.md file — unambiguous entry/exit conditions that translate cleanly into Pine Script later. Use when the user wants to define, save, or add a new preset strategy (not when they want Pine code generated directly — that's strategy-builder, which can call this first if the idea isn't saved yet).
---

# Strategy Rule Writer

Writes exactly one file: `strategy-rules/<slug>.md`. Does not touch Pine Script, tickers, or backtesting —
this skill's only job is turning a trading idea into an unambiguous, reusable rule definition. See
`strategy-rules/README.md` for how the resulting file gets consumed later.

## Step 1 — gather the idea

Ask only for what's missing:

- **Name** — short, descriptive, becomes the `<slug>` (lowercase, hyphens: `rsi-trend-filter`,
  `macd-momentum-breakout`).
- **Entry condition(s)** — what triggers opening a position.
- **Exit condition(s)** — what triggers closing it (target, stop, indicator-based, or time-based).
- **Indicators used** — named with parameters, e.g. `RSI(14)`, `SMA(50)`, `MACD(12,26,9)`.
- **Macro filter** (optional) — e.g. "only trade when DXY is below its 50-day average," or none.
- **Tags** — free-form categorization: `momentum`, `mean-reversion`, `breakout`, `trend-filter`, etc.

Don't ask about ticker, timeframe-for-backtesting, or lookback years — those belong to `strategy-builder` at
build time, not to the reusable rule definition.

## Step 2 — tighten the rules before writing anything

A rule is only reusable if it's unambiguous enough to become a Pine Script condition later without more
back-and-forth. Push back (politely, once) on vague language:

- "buy when it looks strong" → ask which indicator and what threshold/cross defines "strong."
- "sell near resistance" → ask for the specific level/indicator definition of resistance being used.
- Missing exit logic entirely → ask explicitly; a rule with only an entry isn't usable.
- State long/short direction explicitly if it's not obviously both.

If the user genuinely wants to leave something loose for `strategy-builder` to interpret later (e.g. exact
stop-loss percentage), that's fine — note it as an open parameter in **Notes**, don't force a number that
wasn't given.

## Step 3 — write the file

Format (matches `strategy-rules/_TEMPLATE.md` exactly):

```markdown
---
name: <slug>
tags: [<tag1>, <tag2>]
indicators: [<Indicator(params)>, ...]
suggested_macro_filter: <short description, or "none">
---

# <Human-Readable Name>

## Entry
<Exact condition(s).>

## Exit
<Exact condition(s).>

## Notes
<Instrument/timeframe fit, known weaknesses, open parameters left for build time, position sizing preference.>
```

Save to `strategy-rules/<slug>.md`. If a file with that slug already exists, confirm with the user before
overwriting — don't silently clobber a saved strategy.

## Handoff

Tell the user the strategy is saved and available by name — e.g. "saved as `rsi-trend-filter`, you can now
say 'build `rsi-trend-filter` on gold' and skip re-describing the rules." Building the actual `.pine` file is
`strategy-builder`'s job, not this skill's — don't generate code here even if asked; redirect to
`strategy-builder` (or `pine-backtest-orchestrator` for build+review together).
