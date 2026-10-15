# 14 · The Greeks (working manual)
Condensed summary in my own words. `[Claude+]` = my additions.

## Core points (the course uses one worked trade: 3m GBPUSD 1.2600 call, £1m, spot 1.2207, premium ~0.70%)
- **Only three Greeks really matter day to day: delta, gamma, theta.**
- **Delta** (−1 to +1; calls +, puts −): price sensitivity *and* a rough probability of finishing ITM (~23% in the example). You can pick strikes by delta. The **0.25–0.45 zone** gives a workable balance of probability and cost. Delta-hedge by trading delta × notional in spot (useful for sitting out an event). Delta shifts with spot, time (ITM → 1, OTM → 0 near expiry) and vol (high vol pulls ATM delta toward 0.5). A straddle is delta-neutral by construction.
- **Gamma**: how fast delta changes. Always positive for option buyers; peaks ATM, near zero in the wings. Long gamma = want a trend; short gamma = want stillness. A market dominated by hedged option *buyers* sells rallies and buys dips → dampened range. A call spread (buy 1.26, sell 1.29) cut gamma by more than half.
- **Theta**: daily time decay (negative for buyers). Rules for buyers: only buy if you expect the move *before* expiry; choose a tenor longer than your thesis; respect how fast 0DTE decays. A risk reversal (sell a put against the call) can flip net theta positive. Pure option selling collects theta but risks steamroller losses; capping it (condors) gives most of the theta back.

> `[Claude+]` **Dealer gamma for your markets**: when dealers are long gamma (usually when the public sells options), their hedging dampens moves → mean reversion → range days. When dealers are short gamma (the public buys heavy options, e.g. gold calls in a squeeze), hedging amplifies moves → trend days. For XAUUSD, large COMEX/GLD option strikes near expiry can "pin" price. Check the CME gold options expiry calendar (usually a few days before the futures delivery month).

## Self-test
1. What two things does a 0.30 delta tell you?
2. Where is gamma highest and why?
3. Why does a market full of hedged option buyers tend to range?
4. Give two ways to reduce theta bleed.
5. Why choose a tenor longer than your thesis?
