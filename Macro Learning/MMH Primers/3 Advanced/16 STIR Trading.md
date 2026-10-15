# 16 · STIR — trading the short-rate market
Condensed summary in my own words. `[Claude+]` = my additions.

## Core points
- **LIBOR → SOFR**: LIBOR (bank-estimated, unsecured, manipulated) was replaced by **SOFR**, computed from actual overnight Treasury repo trades. Collateralised, near risk-free, backward-looking; term SOFR and spread adjustments bridged the gap. SOFR futures and options replaced Eurodollars; record volumes in 2024. Equivalents: €STR/EURIBOR (EUR), SONIA (GBP).
- **Players**: hedge funds/prop (policy views, relative value, dislocations), HFT (liquidity that disappears in stress), banks (hedging funding), pensions/asset managers, central banks (monitoring transmission).
- **History layers**: 1980s derivatives boom → electronic/HFT (deep in calm, thin in stress → place stops carefully around data) → crisis-driven regulation (central clearing) → pandemic fiscal/inflation regime.
- **SOFR futures**: price = **100 − rate** (96.325 → 3.675%). **$25 per bp per contract** (3m). **Long = betting on cuts; short = hikes.** Ticker: SFR + month code (H Mar, M Jun, U Sep, Z Dec) + year digit (SFRZ5 = Dec 2025).
- **Toolkit**: OIS swaps (fixed vs SOFR), options (caps, floors, swaptions, straddles/strangles), basis trades (SOFR vs EFFR; the 1m SOFR vs FF spread is increasingly active).
- **Four strategy families**: directional; curve (front-end steepeners/flatteners); basis; volatility, including **gamma scalping** (hedge long options with futures as price moves, the same mechanics as the convert-arb hedge).
- **Behavioural edge**: herding to safety (and getting stuck with it), overreacting to Fed signals (fade it), anchoring and recency (even the Fed in 2021), confirmation bias (keep asking how you're wrong). The course's example: early in the year almost no cuts were priced, but the Dec SOFR contract double-bottomed on the H4 (tariff risk) and weeks later ~3 cuts were priced. The contrarian long won.

> `[Claude+]` **How to use STIR without trading it**: CME FedWatch = probabilities derived from Fed funds futures. Compare "cuts priced for the next 12 months" with your macro view. For FX: if the market prices far more Fed cuts than ECB cuts and US data stays firm, the repricing risk favours USD. For gold: an aggressive priced cutting path is already in the price, so gold becomes vulnerable to "less dovish than priced" Fed outcomes even while the Fed is cutting.

## Self-test
1. Why is SOFR considered more robust than LIBOR?
2. SFRH6 trades at 96.10. What rate is implied? → 3.90%
3. You're long 10 contracts and rates fall 15bp. P&L? → +10 × 15 × $25 = +$3,750
4. Name the four STIR strategy families.
5. What is gamma scalping?
6. Give two behavioural biases that misprice STIR and how to exploit them.
