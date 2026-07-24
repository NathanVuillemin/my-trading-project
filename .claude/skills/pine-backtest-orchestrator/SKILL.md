---
name: pine-backtest-orchestrator
description: All-in-one pipeline — build a Pine Script v6 strategy from a description and immediately review it, looping fixes until clean or a fix budget is exhausted. Use when the user wants a strategy built AND validated in one request, without manually invoking strategy-builder then strategy-reviewer separately.
---

# Pine Backtest Orchestrator

Runs **strategy-builder** then **strategy-reviewer** back to back, closing the loop on blocking findings
automatically. This is the "just do the whole thing" entry point — use it as the default unless the user
specifically asks only to build or only to review.

## Flow

1. **Build**: follow `strategy-builder` in full — including its Step 0, which always asks whether to use a
   saved `strategy-rules/*.md` preset or a custom description before anything else (event cache load/research,
   v6 conventions, dual raw/clean mode, required scaffolding). Produces `pine/<slug>/v<N>.pine` + `notes.md`.
2. **Review**: follow `strategy-reviewer` in full against the file just produced.
3. **If blocking findings exist**:
   - Apply the concrete fixes listed by the reviewer directly to the same file (don't bump the version number
     for review-driven fixes — only bump `v<N>` for user-requested logic changes).
   - Re-run Step 2.
   - Fix budget: **2 automatic fix/re-review cycles**. If still blocking after that, stop and hand the
     findings to the user rather than looping indefinitely — some blocking issues need a strategy-logic
     decision only the user can make (e.g. the syntax checker rejecting a construct that requires rethinking
     the approach, not just a typo).
4. **If clean** (or budget exhausted): report final status.

## Final report to user

State clearly, every time:

- File path(s) written.
- Event windows applied (from `data/events/<TICKER>.json`), with a one-line rationale each — this is what
  makes "clean mode" defensible rather than arbitrary.
- Reviewer verdict (`READY FOR TRADINGVIEW` or remaining issues + why they need a human call).
- The standing limitation: **no tool in this pipeline is an authoritative backtest engine.** The syntax
  checker ([erevus-cn/pinescript_syntax_checker](https://github.com/erevus-cn/pinescript_syntax_checker))
  confirms it compiles. PineTS ([LuxAlgo/PineTS](https://github.com/LuxAlgo/PineTS)) confirms it runs and
  gives a rough shape, with experimental v6 parity. Real equity/drawdown/win-rate numbers only come from
  pasting the file into TradingView's own Strategy Tester — say this every time, don't let it get lost after
  the first mention.
- Next step is always the same: paste into TradingView, run both `excludeEventWindows = true` and `= false`,
  compare. If clean-mode performance collapses relative to raw, the strategy was riding event noise, not
  signal — that comparison *is* the deliverable the user is after.

## When not to use this skill

If the user only wants a syntax/structure check on a file they or someone else already wrote (no build
needed), use `strategy-reviewer` directly — don't regenerate a script that wasn't asked for.
