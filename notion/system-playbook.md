# System Playbook

The rulebook. Changes here are versioned by hand — every edit gets a dated line in the
Changelog at the bottom, with the evidence that justified it. No rule changes off a single
losing trade.

## Non-negotiables

1. Risk per trade: __% of account. No exceptions, no "this one is obvious".
2. Max concurrent risk: __%.
3. Max trades per day: __. After that, screen off regardless of result.
4. No entry without a written stop before the order is placed.
5. No revenge entry within __ minutes of a loss.

## Session routine

**Pre-market**
- Mark higher-timeframe levels
- Read the cockpit dashboard: whale flow, COT, insider clusters, funding
- Write the day's bias and the one setup you are hunting

**In session**
- Only take setups in the Playbook Rules database
- Log the trade in Trade Log at entry, not after the fact

**Post-market**
- Fill the Daily Review
- Photograph the notebook page into today's Journal entry

## Setups

Each setup lives as its own row in the **Playbook Rules** database, with the same fields the
repo's `strategy-rules/_TEMPLATE.md` uses:

| Field | Meaning |
|---|---|
| Name | Human-readable strategy name |
| Tags | momentum, mean-reversion, breakout, trend-filter |
| Indicators | RSI(14), SMA(50), MACD(12,26,9) |
| Macro filter | DXY strength filter, VIX regime filter, or none |
| Entry | Exact, unambiguous condition. Long/short, what crosses what, confirmations |
| Exit | Target, stop, indicator-based, or time-based |
| Status | Testing / Live / Retired |
| Notes | Instrument fit, known weaknesses, sizing, timeframe |

A setup only moves Testing → Live after __ logged trades and a positive expectancy.

## Metrics that decide changes

- Expectancy in R
- Win rate by setup
- Rules-followed rate (the only metric that measures *you* instead of the market)
- Average R on rule-followed trades vs rule-broken trades

## Changelog

| Date | Change | Evidence |
|---|---|---|
| YYYY-MM-DD | Initial version | — |
