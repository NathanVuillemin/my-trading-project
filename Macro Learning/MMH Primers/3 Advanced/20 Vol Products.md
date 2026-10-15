# 20 · Volatility Products
Condensed summary in my own words. `[Claude+]` = my additions.

## Core points
- **Realised vol** = what happened (std dev of log returns × √252; 1% daily ≈ 15.9% annual). **Implied vol** = what options price for the future. Vol P&L lives in the IV-vs-RV gap: buyers win if realised > implied.
- **Three gauges**: **VIX** (30-day SPX implied; VIX 20 ≈ 5.8% one-month move), **MOVE** (Treasury option vol across 2y–30y), **CVIX** (trade-weighted G10 FX vol). Divergences show *which market carries the risk* (2013 taper: VIX calm, MOVE and EM FX vol jumped; 2023–24: MOVE high while VIX slept).
- **Extremes**: 2008 (VIX ~89 intraday, MOVE ~264); 2020 (VIX ~85, MOVE >160, FX vol spike; everything at once, so hedges broke).
- **Volmageddon (Feb 2018)**: calm 2017 bred huge short-vol positioning; a ~4% SPX drop doubled VIX; inverse-VIX ETPs had to *buy* VIX futures into the spike → the largest one lost >90% in a day. Structure, not news, caused the explosion.
- **Uses**: VIX calls/futures as hedges (futures bleed roll in contango; calls decay); FX straddles when event vol looks cheap; long-gamma swaptions when the Fed path is uncertain; **dispersion** (short index vol vs long single-name vol = short correlation; loses in crashes); **variance swaps** (payoff on realised variance, so squared sensitivity to spikes).
- **Flows**: banks often net short vol (via structured products), funds trade both sides, asset managers buy protection and sell covered calls, and retail structured notes add vol supply.

> `[Claude+]` **Your gauge set**: VIX (risk mood), MOVE (rates stress; high MOVE often means USD and gold chop), CVIX or EURUSD 1m implied (FX calm vs event mode), GVZ (gold vol). A quick rule: when MOVE is elevated and rising, reduce position size on USD pairs and gold around US data. Realised ranges expand, and SMC stops beyond normal sweeps get run more often.

## Self-test
1. Daily std dev 0.8%. Annualised RV? → ≈12.7%
2. VIX 30. Implied one-month move? → ≈8.7%
3. What made Feb 2018 explode?
4. What does a dispersion trade bet on, and when does it lose?
5. Why are variance swaps so sensitive to spikes?
