---
name: strategy-reviewer
description: Review an existing .pine strategy file for Pine v6 syntax errors, structural/best-practice violations, and correctness of this project's raw/clean event-exclusion backtest mode. Use when the user asks to review, check, lint, validate, or audit a .pine file, or after strategy-builder produces one.
---

# Strategy Reviewer

Validates one `.pine` file. Findings-only — do not silently rewrite the file; report issues with severity and
a suggested fix, let the user or the calling skill decide whether to apply it.

## Step 1 — Compiler-accurate syntax check (authoritative for syntax)

Use the `pinescript-syntax-checker` MCP server (already registered in `.mcp.json`, backed by
[erevus-cn/pinescript_syntax_checker](https://github.com/erevus-cn/pinescript_syntax_checker), which calls
TradingView's own `pine-facade` API — this is real compiler feedback, not a heuristic). If its tools aren't
visible yet, use `ToolSearch` with query `pinescript` to load them. Run it against the file content and treat
any reported error as **blocking** — fix before anything else.

## Step 2 — PineTS headless sanity run (informative only, not authoritative)

```
pnpm exec node scripts/pinets-sanity-check.mjs <file> <TICKER> <from-date> <to-date>
```

If it throws, note it as a **warning**, not a hard failure — [PineTS](https://github.com/LuxAlgo/PineTS)'s v6
`strategy()` support is experimental and can diverge from real TradingView behavior. Only escalate to blocking
if the syntax checker (Step 1) also flags something in the same area.

## Step 3 — Structural checklist (from TradersPost/pinescript-agents `pine-backtester` conventions)

Check each, report pass/fail:

- [ ] UDT defined for trade/state tracking where the strategy has non-trivial state (not required for simple
      single-condition strategies).
- [ ] Any drawing referencing bars beyond ~5000 back uses `xloc.bar_time`, not `xloc.bar_index`.
- [ ] All array iteration uses `for...in`, not a classic `for` with a bound that can change mid-loop.
- [ ] `//@strategy_alert_message {{strategy.order.alert_message}}` present right after `strategy()`.
- [ ] Mandatory stats plotted: net P/L, win rate, trade count, max drawdown, equity curve.
- [ ] No lookahead/repainting: entry/exit logic doesn't key off unconfirmed bar state; `barstate.isconfirmed`
      used where needed; `barstate.islastconfirmedhistory` (if used at all) is confined to one-time setup, not
      trade logic.
- [ ] Within hard limits: ≤64 drawing objects, ≤40 `request.security()` calls, ≤500 combined
      plot/hline/fill outputs.

## Step 4 — Project-specific check: raw/clean event mode

This is not a generic Pine convention — it's this workspace's own requirement, verify it explicitly:

- [ ] `excludeEventWindows` (or equivalently named) boolean input exists and defaults sensibly.
- [ ] Event windows embedded in the script match `data/events/<TICKER>.json` at time of generation — flag if
      the cache has since been updated and the script wasn't regenerated (stale embed).
- [ ] Event-window gating applies to **entries only**, never blocks exits — an open position must always be
      allowed to close.
- [ ] The script (or its `notes.md`) surfaces both raw and clean stats, not just one — reviewing a script that
      only reports clean-mode numbers should be flagged as misleading by omission.

## Output format

One line per finding, most severe first:

```
<file>:<line-or-section>: [BLOCKING|WARNING|NIT] <problem>. Fix: <concrete fix>.
```

End with a one-line verdict: `READY FOR TRADINGVIEW` (no blocking findings) or `NOT READY — N blocking
issue(s)`. Never claim a script is "backtested" or give it a pass/fail on performance — this skill checks
correctness and structure only; actual performance numbers only come from TradingView's Strategy Tester.
