# strategy-rules/

Reusable strategy definitions, saved once and recycled on demand — so a strategy only needs to be described in
full detail the first time. After that, referring to it by name is enough.

## How this gets used

When you ask to build/backtest a strategy:

- If you name a saved strategy (e.g. "use the `rsi-trend-filter` strategy on gold"), `strategy-builder` /
  `pine-builder` reads `strategy-rules/<name>.md` instead of asking you to redescribe the rules.
- If you describe a brand-new strategy from scratch, you can ask for it to be saved here afterward (e.g. "save
  that as `my-breakout-v1`") so it's reusable next time — otherwise one-off strategies aren't saved
  automatically, to keep this folder to things you've actually decided are worth reusing.
- If you name a strategy that isn't here, you'll be asked to describe it (same as before this folder existed).

## File format

One file per strategy, named `<slug>.md` (lowercase, hyphens, e.g. `macd-momentum.md`). Copy `_TEMPLATE.md` to
start a new one.

```markdown
---
name: rsi-trend-filter
tags: [momentum, trend-filter]
indicators: [RSI(14), SMA(50)]
suggested_macro_filter: none
---

# RSI Trend Filter

## Entry
Long when RSI(14) crosses above 30 AND price is above SMA(50).

## Exit
Close when RSI(14) crosses above 70.

## Notes
Works best on trending instruments; expect more whipsaw on choppy/range-bound assets.
```

- `indicators` and `suggested_macro_filter` in the frontmatter just give `strategy-builder` a quick summary to
  scan without reading the full body — the Entry/Exit/Notes sections are the actual source of truth.
- `suggested_macro_filter` is optional (e.g. "DXY strength filter", "VIX regime filter", or `none`).
- Keep Entry/Exit rules unambiguous enough to translate directly into Pine Script conditions — vague rules
  ("buy when it looks strong") will just get punted back to you as a clarifying question.

## Nothing in here is pre-seeded

This folder starts empty except for `_TEMPLATE.md`. No example strategies were invented on your behalf —
add your own as you decide which ones are worth keeping around.
