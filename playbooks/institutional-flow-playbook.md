# Institutional Flow Playbook

**Purpose**: Track where institutional ("smart") money is positioned, where it's moving, and what regime it's operating in — and use that to set directional bias for FX day trades and stock CFD swings.

**Core principle**: The data isn't hidden. It's dispersed, unglamorous to read, and rarely synthesized. The edge is in the synthesis and the discipline to act on it. Institutions are required by regulators to leave footprints; your job is to read them.

**Integration rule**: Institutional signals set *directional bias* and *conviction*. They do NOT trigger entries. Entries still come from the FTB / Rejection Block framework. Never let a positioning signal override price action at the entry candle.

---

## The Three Layers

### Layer 1 — Positioning (who is already long/short)

Slowest-moving layer. Tells you where money currently sits. Best for setting weekly directional bias.

**FX (primary):**
- **CFTC Commitments of Traders (COT)** — Released Fridays, snapshot as of Tuesday. Three groups: Commercials (smart money hedgers — fade extreme positioning), Large Specs / Non-Commercials (trend followers), Small Specs (usually wrong at extremes). Source: cftc.gov/MarketReports/CommitmentsofTraders. Free.
- **Net positioning extremes** — Flag any major currency where non-commercial net position is in the top/bottom 5% of trailing 3-year range. These mark contrarian inflection points.
- **CME FedWatch / SOFR futures positioning** — Reveals what the rates market is pricing for central bank moves. Source: cmegroup.com/markets/interest-rates.

**Equities (primary):**
- **13F filings** — Quarterly (45-day lag). Tracks holdings of all institutions managing >$100M. Source: sec.gov/edgar or whalewisdom.com (free tier). Look at *changes* — new buys, full exits, increased stakes.
- **Form 4 insider transactions** — Real-time-ish. Insider buying (especially cluster buying by multiple insiders) is meaningful. Insider selling is mostly noise (vesting, diversification). Source: SEC EDGAR.
- **13D/13G filings** — Activists or 5%+ holders. Concentrated bets. Often catalyst-driven.

---

### Layer 2 — Flow (where money is moving now)

Real-time-ish layer. Tells you what's happening today. Useful for confirming or fading intraday/weekly setups.

**FX (primary):**
- **DXY behavior + rates differentials** — Watch the 2-year yield spread between currencies. If EUR/USD bias is long but US 2yr is pulling away from German 2yr, fade your bias.
- **FX options risk reversals** — Skew in the options market shows where institutional hedging demand sits. Bloomberg/Reuters terminal data; free proxies harder to find but Saxo and some brokers publish.
- **Order flow proxies** — If you don't have true Level II FX data, watch correlated assets: DXY, US 10yr yield, equity futures, gold. Divergence = something institutional is moving.

**Equities (primary):**
- **Dark pool prints** — ~40% of US equity volume happens off-exchange. Large prints in dark pools = institutional accumulation/distribution. Sources: FINRA ATS data (finra.org/finra-data/browse-catalog/equity-trading/short-sale-volume-trading), or paid: SqueezeMetrics, BlackBoxStocks.
- **Unusual options activity** — Large block trades in options, especially OTM calls/puts with volume >> open interest. Sources: Unusual Whales, BarChart unusual activity (free), CBOE.
- **ETF creations/redemptions** — Persistent ETF buying in a sector signals broad institutional flow. Source: etf.com, issuer sites (SPDR, iShares).
- **Sector rotation in leadership** — Watch the strongest stocks (52-week high names, record-quarter earnings). When leadership breaks down, institutional money is rotating. Mark Minervini / Stan Weinstein methodology.

---

### Layer 3 — Stress / Regime (where money hides or panics)

Slowest-moving fundamentally but state-changing fast. Tells you what regime you're in. Filters which setups have edge.

**Cross-asset signals:**
- **Credit spreads (HY vs IG)** — When high-yield spreads blow out, risk-off is here. Source: FRED (BAMLH0A0HYM2 series). Free.
- **VIX term structure (contango vs backwardation)** — VX1/VX2 ratio. Backwardation = stress. Sources: vixcentral.com (free), CBOE.
- **MOVE Index** — Bond market volatility. Often leads equity volatility. Source: cboe.com or Bloomberg.
- **Repo rates / SOFR spread to Fed funds** — Funding stress signal. Source: FRED.
- **Copper/Gold ratio** — Risk-on vs risk-off macro proxy. Rising copper relative to gold = reflation, rising gold relative to copper = defensive.
- **Yield curve (2s10s, 3m10y)** — Recession proximity gauge. Source: FRED.
- **DXY direction** — Strong dollar = global liquidity tightening = risk-off for most other assets.

---

## Signal Priority by Workflow

### FX Day Trading (intraday, FTB/RB entries)

Weekly (set bias):
1. COT — net positioning + week-over-week change for the pairs in watchlist
2. 2yr rate differentials — direction of travel
3. Regime check — VIX, DXY, credit spreads

Intraday (confirm/fade):
1. Correlated asset divergence (DXY, gold, 10yr yield)
2. London/NY session liquidity sweeps lining up with COT bias

### Stock CFD Swing

Pre-trade (set bias):
1. 13F top holders of the name — are institutions accumulating or distributing?
2. Insider Form 4 activity
3. Sector leadership context — is this stock in a leading sector or laggard?

Confirmation:
1. Dark pool prints relative to total volume
2. Unusual options activity (calls vs puts skew)
3. Relative strength vs S&P 500 (price/SPY ratio rising = institutional demand)

Regime gate:
- If credit spreads widening AND VIX in backwardation → reduce position size or stand aside. Swing setups have much lower win rate in risk-off regimes.

---

## How This Integrates with the FTB Framework

The FTB strategy already has 5 confluences (market structure, supply/demand, premium/discount, liquidity sweep, FTB entry). Add institutional flow as a **bias filter that sits above the confluences**, not as a 6th confluence:

```
Step 0: Institutional Bias Check (this playbook)
   ↓
   If bias = long → only take long FTB setups this week
   If bias = short → only take short FTB setups this week
   If bias = mixed/no edge → stand aside or reduce size
   ↓
Step 1-5: FTB confluences (your existing process)
   ↓
Step 6: Entry trigger (FTB / Rejection Block on 15m or 1H)
```

This filters out roughly half your potential setups. That's the point — it should make you trade less, not more.

---

## Weekly Routine

**Sunday (30-45 min):**
- Pull COT report for watchlist pairs. Flag any positioning extremes (>2 standard deviations from 3-year mean).
- Note week-over-week change in commercial vs non-commercial positions.
- Check 2yr yield differentials for major pairs.
- Pull updated 13F changes for any stocks on the swing watchlist.
- Check sector leadership: which sectors made new highs this week, which broke down.
- Write 1-paragraph "Bias note" per instrument: direction + conviction (1-5) + key invalidation level.

**Daily (5-10 min, pre-session):**
- Check VIX, DXY, credit spreads — has regime changed?
- Scan unusual options activity in stock watchlist names.
- Confirm bias note still holds; if regime shifted, demote conviction.

**Trade log addition:**
- For every trade, log the institutional bias score (1-5) at time of entry. After 50 trades, segment win rate by bias score. If A+ setups with bias score 4-5 don't outperform setups with bias score 1-2, the framework isn't working and we revise.

---

## Honest Limits & Caveats

1. **COT is lagged** — Tuesday snapshot released Friday. Useful for bias, not for entries.
2. **13F is heavily lagged** — 45 days. By the time you see Druckenmiller bought X, the position may already be exited.
3. **Most "smart money" indicators are 60% noise.** Track win rate by signal. Kill the ones that don't work for *your* setups, not what works for someone else.
4. **Dark pool data is fragmented** — FINRA ATS data is weekly aggregate. Real-time dark pool prints require paid feeds.
5. **Correlation ≠ causation** — Institutional positioning often *follows* price moves. Don't assume causation just because the data looks predictive.
6. **The "elite hiding things" frame is mostly wrong** — Big positions are publicly disclosed. The information asymmetry is in execution algos and proprietary research, neither of which retail can replicate. The retail edge is patience and selectivity, not stealing signals.

---

## What We Build Next

This playbook is the north star. Concrete next steps, in order:

1. **Extend the dashboard** with a COT positioning panel (FX) + a regime widget (VIX, DXY, credit spreads).
2. **Build the weekly research routine** as a checklist module — same format as the pre-trade checklist, separate tab.
3. **Backtest the bias filter** — once we have 50+ logged trades, segment by institutional bias score and measure delta.

The dashboard already exists at `dashboard.html` — start there.
