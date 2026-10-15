# 13 · FX Spot & Forwards
Condensed summary in my own words. `[Claude+]` = my additions.

## Core points
- **Spot** = exchange currencies at today's rate, settling T+2. **Forward** = an agreed rate for settlement beyond spot (weeks to years).
- **No central exchange**: banks and brokers make prices, but e-FX keeps G10 quotes within a pip or two; the provider's spread is the fee.
- **Leverage trap**: losses run on **notional**, not deposit. £10k at 10:1 = £100k position; a 5% adverse move = −50% of the account. Per-point tickets hide notional: back it out as margin ÷ deposit factor (course example: £56.87 / 0.45% ≈ £12.6k). Margin tiers rise with size.
- **Why spot FX is hard**: you're forecasting the *future state of two economies*. Bank 12-month forecasts for one pair can span 1.27–1.39.
- **Horizons that work at spot**: intraday (technical, leveraged, low holding cost) or 1 week–3 months (unleveraged, macro view across meetings/data, wider stops). Beyond 3 months, use options.
- **Unleveraged overlay**: e.g. sell GBP to buy USD and US stocks = a combined FX + equity view.
- **Forward points are not a forecast**: spot ± points = forward, set by the two currencies' swap rates for the tenor (CIP). Higher-yielding base → forward below spot. So **forwards are really a rates trade**, which is why STIRT desks sit in FICC.
- **Forwards' three jobs**: hold without roll costs (carry priced in upfront), capital-efficient exposure (~2–5% margin, P/L-only settlement), clean hedges (strip FX out of a foreign equity position or cover an event window).

> `[Claude+]` **Retail/prop equivalent of forward points = swap/rollover**: your broker charges or credits overnight financing based on the same rate differential (plus markup). Triple swap is usually on Wednesday (covers the weekend). Long XAUUSD usually pays swap (gold "yields" less than USD). Holding swing trades for weeks adds up, so include it in expectancy.

> `[Claude+]` **Notional check for your gold trades**: 1 lot XAUUSD at $2,400 = 100 oz = $240k notional. On a $100k prop account that's 2.4:1 effective leverage, and a 2% gold move = $4.8k = 4.8% of the account. Size from the stop (00.6), then sanity-check the notional.

## Self-test
1. £20k account at 20:1 fully used; the pair moves 3% against you. Loss? → £12k (60%)
2. Back out the notional: margin £90, deposit factor 0.5%. → £18k
3. Which horizons suit spot, and what should you use beyond 3 months?
4. Why is a forward not a forecast?
5. List the three jobs forwards do well.
