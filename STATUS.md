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

## CI verified end-to-end (run 30157427275)

Triggered a real run once `gh` was authenticated. Everything that had only ever been
assumed is now confirmed:

| Feed | In CI |
|---|---|
| whale-flow | OK — 120 markets, 2 flagged |
| trust | OK — 0.82 mean confidence, 37 round-trip wallets |
| portfolio | OK — 13 positions |
| **insiders** | **OK — 250 filings, 26 buys. SEC does not block GitHub runners** |
| **macro-flows** | **OK — 19 markets, 11 conviction extremes** |
| smart-money | 53% smart coverage — see below |

Blocked from GitHub runners: **Binance (451)** and **Bybit (403)**. The Bybit result
corrects a wrong assumption in my own code — it was added believing it answered from
anywhere unlike Binance. It doesn't. OKX is the only free top-trader source that works
from CI, so smart coverage there is structurally ~53% until a Dune or CoinGlass key
exists. Locally it runs at 76%.

## Needs you — I deliberately didn't do these

1. **`gh` is now installed and authenticated** (v2.96.0, repo+workflow scopes). Runs can be triggered with `gh workflow run whale-flow.yml --ref main` and logs read with `gh run view <id> --log`. Branch `fix/hyperliquid-rate-limit-retry` is merged into main — delete it when convenient.
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
