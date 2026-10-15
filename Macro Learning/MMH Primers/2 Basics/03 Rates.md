# 03 · Rates — the price of money
Condensed summary in my own words. `[Claude+]` = my additions.

## Main lessons
- **Fisher split**: nominal yield = **real yield + breakeven**. Breakevens follow inflation expectations; real yields follow the expected Fed path. Nominal = the net of both.
- **Always attribute**: 2021 = breakevens surged, real yields went negative, nominals rose a little (inflation doing the lifting). 2022–23 = real yields surged, breakevens eased, nominals little changed on net (the Fed doing the lifting). Same nominal story on the surface, opposite drivers.
- Free tracking: Treasury ETF (nominal), TIPS ETF (real), RINF (breakevens); FRED/TradingView across maturities.
- **Curve & spreads**: 2s10s plus 2s30s, 5s30s, 3m10y etc. Spreads lead and lag each other, which is useful for timing. Also watch the **real** and **breakeven** curves (e.g. 2y vs 10y breakevens vs core CPI at peaks; in 2022 the real 10s–2s spread tracked risk assets out to Bitcoin).
- **Four curve moves**: bull steepener (cuts priced), bear steepener (long-end inflation/supply fear), bull flattener (safety/recession bid), bear flattener (active hiking). Treat each as a regime.
- Rates are upstream of equity sector/factor behaviour. Real positioning signal = the price itself.
- **Learn outward from the short end**: STIR (Fed path) → duration curve (2y–30y) → risk curve (credit → equities → crypto). Most people far out on the risk curve know least about the short end.

> `[Claude+]` **Gold ↔ real yields cheat-sheet**: gold is priced against the **10y TIPS real yield** (FRED: `DFII10`). Rule of thumb from the 2010s: roughly −$100 to −$150/oz per +50bp in real yields, but the relationship weakened after 2022 due to central-bank buying. Watch attribution: if nominal yields rise because breakevens rise (inflation scare) with real yields flat, gold can rally with yields. If real yields drive the rise, gold usually falls.

> `[Claude+]` **FRED codes**: DGS2, DGS10 (nominal), DFII5, DFII10 (real), T5YIE, T10YIE (breakevens), T10Y2Y (2s10s), T10Y3M, SOFR, EFFR.

## Self-test
1. 10y nominal 4.3%, 10y TIPS 1.9%. What's the breakeven? → 2.4%
2. Nominal +20bp, real +35bp, breakeven −15bp. What's the story? → Hawkish Fed repricing, inflation expectations falling
3. Define all four curve moves and the typical driver of each.
4. Why learn from the short end outward?
5. Why might gold rally while 10y nominal yields rise?
