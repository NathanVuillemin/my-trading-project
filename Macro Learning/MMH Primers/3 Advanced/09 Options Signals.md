# 09 · Options as a Signal (positioning premiums)
Condensed summary in my own words. `[Claude+]` = my additions.

## Main lessons
- **"Show me the money"**: signals without dollars behind them (fear/greed, surveys, social mood) add little. Option premiums reflect real supply and demand for exposure.
- Spot prices a whole distribution in one number; options price it with nuance, and the Greeks isolate each piece: **delta** (price), **gamma** (change of delta), **vega** (vol), **theta** (time decay), **rho** (rates).
- **Five signals**: IV vs realised (premium = expects more movement; discount = expects calm); skew (OTM put vs call pricing = tail fear); term structure (IV across expiries); notional/OI/volume (size and where activity sits); catalyst dates (opex, hedging into macro events).
- **Stack them**: August 2024 equity mini-liquidation. Spot broke lower, IV premium jumped, skew blew out, term structure shifted, all confirming real money paying for protection.
- **Find the why via correlations**: similar premium spikes can have different macro causes (e.g. the stock–bond correlation had opposite signs in different spikes). Without the why you can't decide whether to take the other side.
- **Full stack**: map GIL → reflect it in credit/duration risk → map correlations → track uncertainty → certainty → read option premiums as the timing layer; fade when pricing is unrealistic.
- **Correlations of premiums**: map IV, premium, skew and term-structure correlations across assets (e.g. VIX vs MOVE above SPX vs TLT). Shifts in vol correlations/spreads often *precede* spot correlation changes: **vol leads, spot follows**.
- **Free tools**: CME CVOL, CBOE implied correlation and vol indices, strike-level IV/OI dashboards, skew/risk-reversal histories.

> `[Claude+]` **For your markets**: CME `GVZ` (CBOE gold vol index, like VIX for GLD) and CME gold CVOL; FX: CME EUR/JPY CVOL; 25-delta risk reversals (e.g. USDJPY RR turning deeply negative = market paying for yen upside = carry-unwind fear, as seen before Aug 2024). A rising GVZ with gold *falling* = downside hedging (bearish stress); rising GVZ with gold rising = upside chase (call demand, often late-stage).

## Self-test
1. Why does the course dismiss sentiment surveys?
2. Define IV premium, skew and term structure.
3. What did the options market do in August 2024?
4. Why do you need correlations to interpret a vol spike?
5. What does "vol leads, spot follows" mean?
