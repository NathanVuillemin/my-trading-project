# Data notes — traps, and decisions that are load-bearing

Reference for the data collectors. Everything here was found by things going wrong, and most of
it is **not obvious from reading the code**. If you are about to "simplify" one of these, read
the entry first — several of these decisions look like redundant complexity and are not.

Companion to `STATUS.md` (what is running right now). This file is the durable *why*.

---

## The one-paragraph version

Two ideas run through all of it:

1. **A source that goes quiet must say so.** Silence gets published as fact. Most of the bugs
   below were not crashes — they were numbers that kept flowing while meaning something else.
2. **Separate what someone *chose* from what they were *obliged* to do.** A hedger and a
   speculator produce identical-looking flow and mean opposite things.

---

## Trap 1 — "net flow" is not the direction of new risk

**Where:** `scripts/whale-flow.mjs`

Fills come in two kinds: opening a position (new risk) and closing one (removing risk). Summing
both gives `net`. Flagging on `net` reads **backwards** whenever closes dominate.

Real example, 2026-07-24: BTC showed `net` +$7.70M — apparent buying. But that was $14M of
whales *closing shorts*. Actual new risk was −$6.29M, i.e. fresh **shorts**. Three of the four
flagged markets that day were inverted this way, including the whole INDEX class.

**Decision:** flags, baselines, class rollups and driver attribution all run on `opened`
(opening fills only). `net` is still recorded and shown, and a `divergent` flag marks when the
two disagree in sign.

**Do not** "simplify" this back to one number.

---

## Trap 2 — the informative trader group is different in each market

**Where:** `scripts/macro-flows.mjs`

The CFTC publishes several reports. Which one you read changes the answer completely.

| Market type | Report | Informed group |
|---|---|---|
| Commodities | legacy `6dca-aqww` | commercials (producers, merchants — the physical side) |
| FX, indices | TFF `gpe5-46if` | asset managers (real money), vs leveraged funds (fast money) |

The legacy report's "commercial" bucket in FX lumps **dealers** (who hedge as an obligation,
carrying no view) together with real money. Reading it as conviction inverts the signal.

Measured, same day, same data:

| | legacy "commercials" | TFF asset managers |
|---|---|---|
| JPY | idx 94 → bullish | idx 4 → **bearish** |
| GBP | idx 84 → bullish | idx 5 → **bearish** |
| EUR | idx 90 → bullish | idx 17 → **bearish** |
| CAD | idx 95 → bullish | idx 26 → **bearish** |

All four majors flipped. **Do not consolidate onto one report.**

---

## Trap 3 — CFTC market names break URLs

**Where:** `scripts/macro-flows.mjs`

Names contain characters that are structural in a URL: `E-MINI S&P 500` has an `&`,
`COPPER- #1` has a `#`. `encodeURI` leaves both intact, so the query string truncates and
Socrata answers HTTP 400.

**Fix:** `encodeURIComponent` the `$where` *value*, not the whole URL.

Also: there is **no dollar-index contract** in either CFTC dataset. It is deliberately absent
rather than fuzzy-matched onto something else.

---

## Trap 4 — a source can vanish without failing

**Where:** `scripts/connectors.mjs`

Per-asset `try/catch` made "this venue is unreachable" look identical to "this asset isn't
listed here". Binance geo-blocks GitHub runners (HTTP 451), so `binance-top` — weight 2.0, a
*smart*-tier source — contributed **nothing to every cloud run** while working perfectly
locally. The composite kept publishing numbers as though nothing had changed.

**Decision:** `tally()` per venue distinguishes unreachable from not-listed, and `runAll`
returns `coverage`: which sources are live, which are missing, and what fraction of the
smart-tier weight actually arrived. Below 60% emits a `DEGRADED` warning that travels *with the
snapshot*, so a reader of the data knows what it was built from.

Known blocked from CI: **Binance (451)** and **Bybit (403)**. OKX is the only free top-trader
source that answers from a datacentre IP, so CI smart coverage sits near 53% until a Dune or
CoinGlass key is added. Never assume an API works in CI because it works locally.

---

## Trap 5 — counting closing fills as "trades"

**Where:** `scripts/portfolio.mjs`

Scaling out of one position in 140 slices is one trade, not 140. Naive counting produced
"140 trades, 0% win rate" for a wallet that had actually completed **zero** round trips.

**Decision:** fills are grouped into round trips using `startPosition` — a trade is complete
when the position returns to flat. Still-open positions are excluded from win/loss stats and
reported separately. Win rate and expectancy are per round trip.

Caveat: the API returns at most 2000 fills, so a position opened before that window may never
show a clean flat→flat cycle. Reported honestly as 0 rather than guessed at.

---

## The signal taxonomy (why `macro-flows` has two sections)

Not decoration. The two answer different questions and must not be averaged together.

**CONVICTION** — someone *chose* this exposure.
- slow: asset managers, commercials (multi-month)
- fast: leveraged funds, large specs (crowded, squeeze-prone)
- Read as: directional intent. Extremes measured against each market's own multi-year range.
- Slow and fast at opposite extremes = classic squeeze setup.

**HEDGING** — obligation-driven flow, carrying no view.
- dealers intermediating; producers locking in prices
- Read as: **where size is absorbed** — the levels price is likely to react around. This is a
  liquidity map, *not* a direction call.
- Sized as share of open interest, because a big book is what makes a level matter.

Commercials appear in **both** sections deliberately: their flow is hedging by nature, but they
hold the best information about physical supply and demand.

---

## Normalisation

Raw COT net positions are not comparable across markets or through time. Everything is
expressed as a **COT index**: the percentile of the current net position within a multi-year
lookback (default 3 years). That is what makes a 900k-contract S&P book comparable to a
3k-contract bitcoin book.

---

## Exchange flows

`FlowInExUSD` / `FlowOutExUSD` from the CoinMetrics community API. Net = out − in, so
**positive means coins are leaving exchanges** (accumulation).

Chosen deliberately over more wallet tracking: it is **aggregate**, so there is no address to
label and the "one wrong tag poisons the analysis" failure mode cannot occur.

Recent values carry `status: "flash"` — preliminary and subject to revision. That status is
passed through to the output; don't treat a flash value as final.

Free tier covers flows, supply-on-exchange and MVRV. UTXO age bands, SOPR and realized cap are
**paid** (403 on the community key).

---

## Working in this repo alongside someone else

Commit with **explicit paths**, not `git add -A`. A blanket add in this repo swept another
session's in-progress `scripts/trust.mjs` into an unrelated commit. Pull before starting.
