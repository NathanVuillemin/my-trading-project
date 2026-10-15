# 15 · Convertible Bonds & Arbitrage
Condensed summary in my own words. `[Claude+]` = my additions.

## Core points
- **Convertible** = a corporate bond plus the right to convert into a fixed number of shares; issuers accept convertibility in exchange for a lower coupon. Key terms: par, coupon, maturity, **conversion ratio**, **conversion price**, call/put provisions; some are zero-coupon.
- **Check the conversion maths**: conversion value = share price × ratio vs cost = conversion price × ratio. The course's example was deep ITM (value ≈ $1,330 vs cost ≈ $1,000) with delta > 85.
- **Price curve, four zones**: distressed (the bond floor itself fails), bond-like (sits near the floor), **balanced** (half bond, half option: where arb lives), equity-like (tracks parity).
- **Arb trade**: buy the convert when it's cheap vs fair value + short delta × shares → delta-neutral, **long vol**, **long credit**. Rebalance dynamically: stock up → delta up → short more; stock down → cover. That forces you to sell high and buy low, which is where much of the P&L comes from when vol is rich.
- **Risks**: borrow cost/availability, issuer credit, corporate actions, vol collapse, illiquidity; outright holders also face equity, rate (long maturities) and credit risk.
- **History**: Thorp reported ~25%/yr with minimal risk in the early 1960s; ~10%/yr at ~5% vol from 1990–2007; ~−40% in 2008 when short-selling bans broke the hedge and buyers vanished; subdued under ZIRP/low vol. Still niche (~1.4% of 2024 corporate issuance), but a higher-vol regime could favour it again.

> `[Claude+]` Relevance to you is mostly conceptual: it's the clearest example of "long gamma + dynamic hedging = get paid for volatility", and of how a *market-neutral* strategy can still blow up when one leg becomes impossible to trade. Prop-rule analogue: a hedge that depends on something that can be switched off (e.g. weekend gaps, broker widening spreads on news) isn't a real hedge.

## Self-test
1. Compute conversion value: ratio 8, share $150. → $1,200
2. Name the four zones of the convertible price curve.
3. What three exposures does convert arb leave you with?
4. Why does dynamic hedging make money when vol is high?
5. Why did 2008 break the strategy?
