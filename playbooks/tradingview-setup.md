# TradingView Day Trading Setup — Reference
**Updated:** 16 July 2026 (v2 — system-matched multi-timeframe grids) · **Plan:** TradingView Premium · **Prop target:** FTMO (chart futures, execute MT5/cTrader)

## v2 layout structure (matches Final Strategy Breakdown)
Each layout is now a **2×2 grid: Daily / 4H / 1H / 15m**, symbol-synced + crosshair-synced:
- **Daily & 4H panes:** candles + Fractal Structure Break only (clean structure/orderflow read; draw zones & Gann box here)
- **1H & 15m panes:** full template (Sessions H/L + PDH/PDL, SVP HD value lines, Fractals, CVD)
- **Removed everywhere:** Anchored VWAP, Liquidity Heatmap (not part of the system)

## Drawing templates (global, in every drawing's Template menu)
- **P-D Box (Ozkar):** Gann box, levels 0 / 0.5 / 1 only — stretch across the active 4H swing (low→high bullish). A demo box sits on the NQ 4H pane; drag its anchors to the real swing.
- **Demand (open)** — green rectangle · **Supply (open)** — red rectangle · **Mitigated zone** — gray rectangle. Re-style a zone to gray the moment price taps it (lesson 3: tapped = invalid).

## Alert workflow (instead of screen-watching)
After the weekly outlook, mark the open 4H zones → right-click each zone edge → Add alert ("crossing"). The chart calls you when price reaches a POI (entry-model step 2); you then watch for the sweep + 15m fractal break. 2–3 AAA setups/month means alerts do the waiting, not you.

## Layouts (all saved, autosave ON)
| Layout | Symbol | Timeframe | Executes on |
|---|---|---|---|
| Day Trading - NQ | CME_MINI:NQ1! | 15m | FTMO US100 |
| Day Trading - Gold | COMEX:GC1! | 15m | FTMO XAUUSD |
| Day Trading - BTC | BINANCE:BTCUSDT.P | 15m | Phantom (Hyperliquid perps), low leverage |

ES layout deleted 16 Jul 2026 (too correlated with NQ). BTC charted on Binance perp for volume depth; prices track Hyperliquid closely.

Original "Forex" layout left untouched as backup. Why futures symbols: real exchange volume — SVP, heatmap, and CVD are meaningless on CFD tick-volume feeds.

## Indicator template (identical on all 3)

### 1. Sessions Liquidity (Silent)
- Sessions: New York 13:00–22:00, London 07:00–16:00, Tokyo 00:00–09:00 (GMT). Sydney OFF.
- Per session: High/Low ON, Range OFF
- Style → Graphic objects: Boxes OFF, Pane labels OFF, Lines ON
- PDH/PDL enabled
- Note: the pale blue/white background banding is TradingView's built-in ETH/RTH shading (white = US regular hours), not this indicator. Kept intentionally.

### 2. SVP HD (Session Volume Profile)
- Inputs: Sessions = All, Volume = Total, Value Area = 68, Extend POC/VAH/VAL Right = ON
- Style: Volume profile histogram OFF — only 3 lines show:
  - POC: purple, thickness 2
  - VAH / VAL: purple
- Purple = value. VA edges → Fakeout setup; POC → Mean Reversion setup.

### 3. Anchored VWAP
- Color: orange, bands (Plot rows) OFF
- Anchor: 2026-07-10 15:00 (July swing high before current selloff) — **placeholder on Gold/ES; re-anchor to the HTF swing that started each instrument's current macro move** (Inputs → Year/Month/Day/Hour)

### 4. Liquidity Heatmap (Nephew_Sam_)
- Kept with original inputs — zones are small red/green blocks, acceptable
- If it ever gets noisy: raise its minimum-size filter until ~3–6 zones per session, or hide via legend eye

### 5. Fractal Structure Break Indicator
- Unchanged (2 Solid 2 Dotted 50). Black = structure. Nothing else on the chart may be black.

### 6. CVD — Cumulative Volume Delta (TradingView built-in)
- Bottom pane, anchor period 1D
- Use: absorption confirmation at sweep levels. Sweep of a low + CVD still falling + price holding = institutions absorbing sell-side liquidity → A+ confirmation.

### Removed
- %R Trend Exhaustion — oscillator, not part of the location-based system.

### 7. HTF Highs (own script, `tradingview/htf-highs.pine`)
- Added 18 Nov 2026. Pine Editor → paste → Save → Add to chart, on every pane (it reads the pane's timeframe).
- Daily/weekly panes show yearly + 3-month highs; intraday panes show 6-month, monthly, weekly and previous-day highs. Each level has its own on/off per chart type in the inputs.
- Default = previous completed period (PYH, P3MH, PMH, PWH, PDH). Switch "Level" to "Current period" for the running high.
- Levels at the same price merge into one line ("PYH / P3MH"). Colour dark gold, so it clashes with nothing below.
- PDH overlaps Sessions Liquidity's PDH/PDL: turn one off.
- v3 (18 Nov 2026, styled after Fabio's chart): thin 1px line from the wick that made the high to the right edge of the visible chart, one colour per level (Y blue, 6M green, 3M purple, M red, W orange, D grey), short tag above the line end. Hover a tag for the exact price. If the wick is older than the chart's loaded history the line starts at the period open instead.

### 8. Event Levels (Alfie's script, saved in the account as "Event Levels")
- High and low of each FOMC / CPI / NFP / PPI / retail-sales day in the last year, kept until price trades through. Dashed lines, name + date labels.
- Source kept locally in `tradingview/third-party/` (git-ignored: someone else's code, repo is public).
- Release dates are hard-coded (built 2026-11-17). Alfie's refresh job doesn't run here, so the chart shows a warning after 8 Dec 2026 until the dates are updated.
- On AUD/CHF only so far (trial).
- 18 Nov 2026: on every pane of all 28 desk-pair layouts (8 majors, every cross), plus Gold and silver. The 13 pairs that had no layout (EURGBP, EURAUD, EURNZD, EURCAD, GBPCAD, AUDNZD, AUDCAD, NZDUSD, NZDCAD, NZDCHF, NZDJPY, CADCHF, CADJPY) were copied from the EUR/JPY layout (D / 1H / 4H / 15m, IC Markets feed, Fractal Structure Break + HTF Highs).
- Single-pane layouts still: GBP/USD (15m), USD/CAD (1D), GBP/CHF (1H); CHF/JPY has 3 panes.

## Drawing horizontal liquidity lines
- Hold **Shift** while drawing a trend line: it locks to 0° / 45° / 90°, so flat is easy. Let go of the mouse before Shift.
- Turn on **magnet** (left toolbar, Strong) so the first click lands exactly on the wick high.
- Or use the **Horizontal ray** tool from the lines menu: one click on the wick, flat by design.

## Color discipline
purple = value (POC/VA) · orange = AVWAP · black = structure/fractals · blue/red thin lines = session H/L, PDH/PDL · red/green = candles + heatmap zones only

## Open items
1. **Real-time CME data**: TradingView shows futures ~10 min delayed without the CME bundle add-on (a few €/mo). Required before live/funded trading; optional during backtesting.
2. Re-anchor AVWAP on Gold and ES.
3. FTMO funded-account rule to encode: no order actions 2 min before/after major news (NFP, CPI, FOMC) on XAUUSD/DXY.
4. Plan: 2 weeks TradingView paper trading + session-sweep backtest (NQ, Gold) before FTMO Challenge.
