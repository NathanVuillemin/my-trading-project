# 19 · Credit Default Swaps
Condensed summary in my own words. `[Claude+]` = my additions.

## Core points
- **CDS** = credit insurance as a swap. The buyer pays a running premium (bp per year on notional) and is short credit; the seller receives premium and pays **notional × (1 − recovery)** on a credit event (long credit). No bond needs to change hands.
- **Levels = live default pricing**: the course contrasts a big bank ~43bp, a leveraged cruise line ~147bp, and the same cruise line >2,000bp at its 2022 low point.
- **Why use CDS instead of bonds**: it isolates credit (strips out duration, repo, coupon effects); shorting credit without borrowing bonds; often more liquid and faster-moving in stress.
- **Conventions**: fixed coupons (100bp IG / 500bp HY) + an **upfront** payment for the difference vs the market spread. Risk screen: spread DV01 dominates (~$464/bp in the course example); rate DV01 is negligible; default exposure depends on the recovery assumption.
- **Shortcut**: spread ≈ PD × (1 − R). 200bp at 40% recovery ≈ 3.3% annual default probability.
- **Credit events** (ISDA): bankruptcy, failure to pay, restructuring (depending on the contract). Downgrades don't count. Settlement is now mostly cash via an ISDA auction that sets recovery.
- **Credit curve**: healthy = upward sloping; distressed = **inverted** (near-term risk priced highest). Curve trades isolate the *timing* of risk.
- **Strategies**: hedging bond books; directional (sell protection = long, buy = short); capital-structure arb (credit vs equity/puts); **CDS–bond basis** trades (buy bond + buy protection when the bond pays more than CDS costs).
- **Players**: dealers, hedge funds (most active), asset managers/pensions (index hedges), insurers (much less since 2008), corporates (as a monitoring signal).
- **In stress**: CDS led equity before the 2008 bank failures and priced Eurozone sovereign risk early in 2011–12; index CDS gapped in March 2020. But widening protection costs can also feed the panic.
- **Counterparty risk**: a big insurer sold ~$440bn of largely unhedged protection before 2008 → ~$180bn bailout. Hence central clearing today.

> `[Claude+]` **Macro gauges from CDS**: CDX IG/HY and iTraxx Main/Crossover are the risk barometers macro desks glance at next to VIX. US sovereign 5y CDS (and other G7) spiking around debt-ceiling standoffs has been a gold-supportive signal (trust/"anti-confidence" bid). Free proxy if you lack CDS data: FRED HY OAS `BAMLH0A0HYM2`.

## Self-test
1. What does the seller pay on default with 30% recovery on $10m? → $7m
2. Why is CDS the "purer" credit instrument?
3. A 5y CDS trades at 300bp with 40% recovery. Rough annual PD? → 5%
4. What does an inverted credit curve tell you?
5. Explain a positive-carry basis trade.
6. Why did the 2008 insurer episode lead to central clearing?
