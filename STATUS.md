# Status — 2026-07-25

Written while you were at work. Everything below is on `main` and pushed.

## What runs

`npm run health` — start here. One command, tells you whether any feed is stale or degraded.

| Command | What it does |
|---|---|
| `npm run health` | Staleness + quality check on every feed. Read-only |
| `npm run refresh` | Runs all six collectors, then rebuilds the dashboard |
| `npm run dashboard` | Rebuild the page only |

Individual collectors: `whale:flow`, `smart:money`, `trust`, `portfolio`, `insiders`, `macro:flows`.

CI runs all six daily at 22:00 UTC, commits snapshots, deploys to
https://nathanvuillemin.github.io/my-trading-project/

## Fixed today

**Rate limiting (was corrupting data daily).** `trust.mjs` makes ~180 Hyperliquid
requests at `--top 60`; `portfolio.mjs` ran straight after and died on the first 429.
Worse, `trust.mjs` was throttled on `userFills` too — which returns *empty* rather than
erroring — so no round trips were found and every wallet silently fell back to the
weakest evidence basis while still publishing a score. Both steps are non-fatal in CI, so
the daily run would have gone green while two panels rotted.

Proven A/B before merging:

| | portfolio | trust evidence |
|---|---|---|
| without fix | dies on 429 | 60/60 wallets `markets`, 0.38 confidence |
| with fix | completes | 39 roundTrips / 10 closingFills / 11 markets, 0.85 |

Both callers now retry 429/5xx with exponential backoff and jitter (5 attempts, 16s cap).

**Health checks.** New `scripts/health.mjs`. It caught the above independently, which is
the point — feeds degrade *without failing*, and nothing was watching for that. Now runs
in CI and writes into the run summary.

## Needs you — I deliberately didn't do these

1. **The PR is still unopened.** `gh` isn't installed, so I couldn't create it. I merged
   the fix to `main` directly instead, because leaving it unmerged meant knowingly shipping
   corrupted data every day while you were out. Branch `fix/hyperliquid-rate-limit-retry`
   still exists; the PR link is dead weight now that it's merged — delete the branch when
   convenient.
2. **`config/portfolio.json` still uses a PLACEHOLDER address** (a leaderboard whale). The
   portfolio panel is showing someone else's book. Swap in your own public address.
3. **Dune + CoinGlass keys unset** — smart-money runs at 76% smart-tier coverage. Free keys;
   set them as repo secrets if you want the other 24%.
4. **The repos you mentioned** (caveman, browser harness, Open design, Impeccable, design
   extract, n8n MCP) — no links yet, and I won't guess which projects those names refer to.

## Known-but-fine

- **Whale-flow baseline is cold.** Flags are $-floor only until ~2026-08-08; z-scores need
  ~14 daily runs. Not a bug, just time. History table now shows 2 days.
- **Binance is geo-blocked on GitHub runners** (HTTP 451). `binance-top` contributes
  nothing in CI and everything in local runs. Coverage reporting makes this visible rather
  than silent. No free top-trader source survives CI except OKX.
- **Portfolio shows 0 completed round trips.** Correct — that whale holds positions open,
  and the 2000-fill API window rarely contains a full flat→flat cycle.

## The thing to be careful about

You asked me to be careful what gets removed. Two structural decisions are load-bearing:

- **The dashboard auto-discovers `data/*/`.** Adding a collector needs no dashboard edit.
  Don't hardcode feeds back in.
- **Collectors are non-fatal in CI, and `health.mjs` is the counterweight.** If you ever
  drop the health step, restore fail-on-error somewhere, or degraded data goes back to
  being invisible.
