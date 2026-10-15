# 21 · SOFR Options
Condensed summary in my own words. `[Claude+]` = my additions.

## Core points
- **Options on SOFR futures** (1m and 3m), American-style, settle into the future (which cash-settles on compounded SOFR). Futures tick 0.0025 = $6.25 (3m contract).
- **IMM flip**: price = 100 − rate, so **expecting more cuts → buy calls; expecting higher rates → buy puts**.
- Specs: strikes ~25bp apart (finer ATM); premiums in futures ticks; weekly/monthly expiries (Friday before the delivery month); **mid-curve options** (short expiry on a later future) to trade shifts in forward expectations.
- **Normal vol** (bp, not %): 50bp normal vol ≈ a ~50bp expected annual rate swing. It works near zero and negative rates, and vega is linear. Rising vols = a wider range of policy outcomes priced.
- **Surface**: deferred vol > front; skew usually favours **calls** (rate crashes = emergency cuts), so steep call skew = fear of renewed easing.
- **Players**: hedge funds (convex Fed bets), dealers including large non-bank market makers (usually short optionality, so they amplify spikes), asset managers (hedge without selling bonds), corporates (occasional caps/floors), growing retail.
- **Strategies**: vanillas on deferred contracts; **calendar spreads** (trade *when* easing starts); straddles/strangles around FOMC/CPI/NFP; risk reversals (trade the skew).
- **Risks**: theta (right view, wrong expiry = loss), thin liquidity away from the money, volatile marks, and overpaying for event premium when realised underdelivers.

> `[Claude+]` Even without trading them, SOFR option skew and implied vol are a useful Fed-uncertainty read: rising normal vol ahead of FOMC = the market expects a big repricing, so USD crosses and gold may overshoot either way. Avoid holding tight stops through the release.

## Self-test
1. You expect the Fed to cut faster than priced. Calls or puts?
2. What does 60bp normal vol mean?
3. Why does SOFR option skew usually favour calls?
4. What view does a calendar spread express?
5. Name the biggest P&L drag for option buyers here.
