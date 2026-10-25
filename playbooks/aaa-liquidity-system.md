# Final Strategy Breakdown — AAA Liquidity System
**Nathan Vuillemin · 16 July 2026 · v1.0 (pre-backtest)**
Sources: Ozkar Meyssen's 9-lesson series (transcripts extracted 16 Jul 2026), TTA/Fabio session-sweep model, independent sweep research (DailyPriceAction, ICT-crypto adaptations). One rulebook — conflicts reconciled, flagged in §10.

**Assets:** NQ (FTMO US100) · Gold (FTMO XAUUSD) · BTC (Phantom/Hyperliquid perps, low leverage)
**Timeframes:** Daily + 4H = bias & context · 1H = zone refinement · 15m (–1H) = entry trigger
**Frequency target:** quality over quantity. 2–3 trades/month is acceptable. Every trade must pass the full checklist — anything less is not taken.

---

## 1. Core definitions (objective, codable)

1. **Swing structure:** uptrend = HH+HL, downtrend = LL+LH.
2. **Break of Structure (BOS):** a candle **body close** beyond a swing high/low. A wick-only break is NOT a BOS — it is a **liquidity grab**.
3. **Change of Character (CHoCH):** BOS against the prevailing trend (e.g. swing low closes broken in an uptrend).
4. **Internal vs swing structure:** small staircase moves inside one leg are internal; only clear, large pullbacks create swing points.
5. **Fractal structure:** the aggressive LTF structure. Fractal high = high of the current down-move; after a fractal low breaks, the new fractal high = the most recent high that broke it. Pullback exists only if a candle's wick exceeds the prior candle's wick against the move direction.
6. **Supply zone:** the last buy-before-sell candle/zone before a down BOS. **Demand zone:** the last sell-before-buy before an up BOS.
   - **Validity (lesson 3, verified):** a zone is valid only while *untapped* ("open"). Once price taps it, it is mitigated → invalid; control passes to the next zone in the chain. A zone broken by body close = invalid + orderflow flip.
   - **Draw only with the trend:** bullish → demand zones at/below the 50% level only (ignore supply); bearish → supply zones at/above 50% only (ignore demand).
7. **Orderflow:** the chain of S/D zones. The most recent unbroken zone is "in control." Orderflow flips when price **closes** through the controlling zone.
8. **Premium/Discount:** Gann box (levels 0 / 0.5 / 1) drawn across the active swing (low→high when bullish, high→low when bearish). Discount = below 0.5; premium = above 0.5.
9. **Liquidity types (Ozkar ∪ Fabio — same taxonomy):**
   - *Trendline liquidity* (= Fabio "trend liquidity"): 3+ stacked highs/lows along a trend. Expect ALL of it to be swept in one move; only the final level matters for reactions.
   - *Major liquidity* (= Fabio "HH/LL liquidity"): major swing highs/lows, PDH/PDL, session H/L, equal highs/lows, round numbers. Biggest reactions.
   - *Internal liquidity*: minor bumps inside a leg. Small reactions; used for entry refinement.
10. **Strong high/low (bank entry):** at a POI, early buyers/sellers enter → their stops get swept → fractal break in trade direction confirms the strong high/low. Stops behind a strong H/L are considered safe.

## 2. The 5-point checklist (ALL must pass — this defines AAA)

| # | Check | Pass condition |
|---|---|---|
| 1 | **Market structure** (D/4H) | Trade direction = swing structure direction. Post-CHoCH, direction = new trend. |
| 2 | **Premium/Discount** (4H swing) | Longs only from discount (≤0.5 of active swing); shorts only from premium. |
| 3 | **Supply & Demand** | A valid HTF (4H/1H) zone at the entry area — the POI. |
| 4 | **Orderflow** | Zone chain in control agrees with trade direction. Never trade against orderflow, even after a liquidity grab, until it flips (close through controlling zone). |
| 5 | **Liquidity** | Liquidity has been TAKEN before/at entry (sweep into the POI). No sweep = you are the liquidity = no trade. AND a clear liquidity target exists on the other side. |

Volume confirmation (Nathan's addition, from chart template): CVD not making new extremes while price sweeps = absorption — strengthens check #5. POC/VA lines locate where value agrees with the POI.

## 3. Entry model (sequence — every step mandatory)

0. **Weekly macro bias (Ozkar's outlook layer, verified 16 Jul):** central-bank stance, upcoming news, risk-on/off → directional bias per asset for the week. Macro can veto a technical setup; it never replaces the checklist.
1. **HTF map (D/4H):** structure direction, orderflow chain, active swing P/D box, HTF S/D zones (open/unmitigated only), liquidity pools marked (PDH/PDL, session H/L, equal H/L, trendline stacks).
2. **Wait for price to reach the POI** (HTF zone in discount/premium as required).
3. **Sweep:** price takes liquidity at/into the POI (early buyers'/sellers' stops swept). Wick through, no body close beyond (on the trigger TF).
4. **Trigger (15m–1H):** fractal break in the trade direction after the sweep (for longs: fractal high breaks after the sweep low; this also confirms the strong low). On 4H setups, refine on 1H; on 1H setups, refine on 15m.
5. **Entry:** limit at the trigger-TF zone (top of demand / bottom of supply) created by the confirming move — or market on the fractal-break close if the zone is thin.
6. **Stop:** beyond the strong low/high (the sweep extreme), never inside the sweep zone. Small ATR buffer allowed.
7. **Target:** opposite liquidity pool (major liquidity preferred). Minimum 1:3 RR or the trade is skipped.

## 4. Risk & management

- Risk per trade: **0.5–1%** (prop). Phantom/BTC: size so a stop-out = ≤1% of that account; leverage 2–3x max, isolated margin.
- Minimum RR: 1:3. TP at target liquidity; stop to BE after +1R or after first opposing liquidity is taken.
- Optional pyramiding (Nathan's rule): start 1/4 size → add at +1R → add at +2R, trail stop with each add. Apply only after the base system is proven in backtest.
- One position per asset. No correlated doubling (NQ + BTC count as correlated risk-on — half size if both on).

## 5. Time rules

- **No entries after the New York session** (Ozkar; confirmed by his missed-trade example). Overnight holds allowed only if stop is behind a strong H/L.
- **Dead gap / rollover candle: 23:00–00:00 CET.** Candles in this window are fake — no liquidity, no zones; think them away. Stops are vulnerable to fake wicks. Ozkar's fix: pull the stop 5 min before 23:00, restore 1 min after 00:00. ⚠️ **FTMO conflict flag:** verify FTMO rules before ever removing a stop; safer default = don't hold prop positions through 23:00, or accept the wick risk with a wider structural stop.
- News: no order actions ±2 min around NFP/CPI/FOMC on funded FTMO (XAUUSD/DXY rule); pre-check calendar each session.
- These are risk/context rules, not extra checklist items — the checklist stays the 5 points above.

## 6. Per-asset adaptation

### NQ (chart NQ1!, execute US100)
- Prime window: NY open/session. Overnight + London range = the liquidity map; NY sweeps it.
- Behavior: trends hard → best for trend-continuation entries (checklist in trend direction after pullback-sweep into demand/discount).
- Stops: structural, typically fine at 15m fractal extremes.

### Gold (chart GC1!, execute XAUUSD)
- Prime windows: London and NY. Most institutional asset; sweeps constantly.
- Current regime (Jul 2026): ranging ~4,000–4,100 → expect range plays: sweep of range edge + rejection back inside → target opposite edge/POC. Trend-continuation entries wait for a D1 BOS out of the range.
- Respect the FTMO news rule strictly on XAUUSD.

### BTC (chart BINANCE:BTCUSDT.P, execute Phantom/Hyperliquid)
- Same 5-point checklist; session logic replaced by:
  - **Prime window = US equity overlap:** 14:30–17:00 CET (BTC's "NY open"); secondary 19:30–22:00 CET; dead zone 17:00–19:30 CET.
  - **Overnight range** (00:00–14:30 CET) = the liquidity map for the day's sweep.
  - **Funding filter:** funding > +0.08% → expect a bearish sweep of equal lows before the 8h funding stamp (00:00/08:00/16:00 UTC); < −0.04% → bullish sweep of highs. Extreme funding against your direction = stand down; aligned = timing edge.
  - **Weekend rule:** no entries Friday PM through Sunday; Monday frequently sweeps the weekend extreme and fills back to Friday close — that Monday sweep can BE the setup if the full checklist passes.
  - **NQ correlation:** NQ bias = default BTC bias; BTC/NQ divergence at a shared level (one makes the high, the other fails) strengthens the reversal case.
  - Stops in **percent terms**: 0.3–0.5% of price for 15m triggers — never copied from NQ point-distances.
  - No dead-gap/rollover rule (24/7 market), but funding stamps play the equivalent role.

## 7. AAA setup definition (the "2–3 per month" bar)

A trade is AAA only if ALL are true:
1. Checklist 5/5 (structure, P/D, S&D zone, orderflow, liquidity-taken + liquidity-target).
2. Sweep is of **major or full-trendline** liquidity (not internal-only).
3. Trigger-TF fractal break confirms a strong high/low.
4. ≥1:3 to the first major liquidity target.
5. No red-flag timing (post-NY, dead gap, ±2min news, BTC weekend, extreme adverse funding).
6. CVD/absorption does not contradict the reversal (bonus confluence, not a hard gate until backtested).

Anything scoring 5/6 or less is a pass (skip). Log skipped setups too — the backtest needs both.

## 8. Backtest plan (next step)

- Instruments: NQ1! and GC1! first (real volume, session structure), BTC after.
- Sample: minimum 12 months of 15m data per asset, walk-forward: 9m in-sample / 3m out-of-sample. No parameter tuning on OOS.
- Code each definition in §1 exactly (BOS = body close; sweep = wick beyond level, close back inside within N=3 candles — N to be tested {1,2,3,5}).
- Record per trade: date, session, setup type (continuation vs range-fade), sweep type (major/trendline/internal), RR achieved, MAE/MFE, checklist score.
- Metrics: win rate, avg R, expectancy, max drawdown, performance by session/day/regime (trend vs range via D1 structure state).
- Costs: FTMO spread+commission per instrument; BTC: taker fees + funding + realistic slippage.
- Kill criteria: expectancy ≤ 0 after costs on OOS, or max DD incompatible with FTMO 5% daily / 10% total → revise, don't trade it live.

## 9. Reconciliation: Ozkar × Fabio (one rulebook)

- Same auction foundation. Fabio's 3 liquidity types map 1:1 to Ozkar's (range→trendline/major at session edges, trend→trendline, HH/LL→major).
- Fabio's session sweep model = a **special case** of the entry model in §3 where the POI is the session range extreme. It still requires the full checklist — a session sweep against 4H orderflow is NOT a trade (this is the one real conflict; resolved in Ozkar's favor: orderflow gate wins).
- Ozkar's fractal-break confirmation replaces/upgrades "rejection candle" confirmations from generic sweep guides: close back inside + fractal break, not just a wick.

## 10. Open items
1. Verify FTMO policy on removing stops during the 23:00 rollover window.
2. Ozkar's Weekly Outlooks / Trade Breakdown Saturday playlists: mine 2–3 for worked examples to validate rule interpretation (esp. exact fractal-break definition on 15m).
3. Lesson 3 (S&D zone drawing specifics) skipped for token budget — zone definitions in §1.6 come from the Orderflow lesson; refine wick/body zone boundaries from lesson 3 if backtest shows sensitivity.
4. Anchored VWAP anchors on Gold/BTC still placeholders on the charts.
5. Define sweep close-back-inside window (N candles) via backtest, not opinion.
