# 06 · Liquidity
Condensed summary in my own words. `[Claude+]` = my additions.

## Main lessons
- **Three meanings**: market (can I sell without moving price?), funding (can I borrow against assets?), macro (how much money/credit exists to hold assets?). Crises usually hit all three in sequence: macro → funding → market.
- **Reserves "bathtub"**: net liquidity ≈ **Fed assets − TGA − RRP**. Inflows: QE, RRP drawdown, Treasury spending the TGA. Outflows: QT runoff, cash parking in RRP, TGA refills (e.g. after a debt-ceiling deal). The quiet taps can overwhelm QE/QT. 2023: liquidity eased while the Fed was officially tightening, because the RRP drained.
- **Transmission**: (1) portfolio rebalancing: displaced investors move out the risk curve; (2) collateral: cheaper leverage; (3) signalling: the CB "has your back" → premia compress. Drains are gradual until a funding threshold breaks, then sudden. The far end of the risk curve feels it first, both ways.
- **Global & the dollar**: the world's debt and trade are in USD, so the dollar's level *is* a financial condition. Weaker USD eases the world (global M2 in USD rises); stronger USD = a margin call on the world. Major CB balance sheets (Fed, ECB, BoJ, PBoC) move together. Offshore dollar stress shows in the **cross-currency basis**; Fed swap lines are the valve.
- **Financial conditions** (long yields, spreads, equities, USD) are what borrowers feel. The feedback loop: markets ease in anticipation of cuts → the economy re-accelerates → cuts get priced out → tighter again. Think homeostat.
- "Bad news is good news" only works when inflation lets the CB respond.
- **Dashboard**: net liquidity (weekly), M2 and bank credit, funding spreads (repo vs corridor, bills, xccy basis), USD, pre-announced plumbing calendars (QT, refunding, debt ceiling).

> `[Claude+]` **Build it on FRED**: `WALCL` (Fed total assets, weekly Wed) − `WTREGEN` (TGA) − `RRPONTSYD` (RRP) → net liquidity. Chart it against SPX, BTC and XAUUSD. Also `M2SL`, `NFCI` (Chicago Fed conditions: >0 = tighter than average), `SOFR` vs `IORB` (SOFR above IORB = reserve scarcity signs, as in Sept 2019).

> `[Claude+]` Gold relationship: gold tends to benefit from rising global liquidity and a weaker USD, but in acute funding crunches (March 2020, Oct 2008) it gets sold for cash first. Gold is liquid collateral that people sell to meet margin calls.

## Self-test
1. Define the three kinds of liquidity.
2. Write the net liquidity formula and name the three taps.
3. How could liquidity rise during QT?
4. Describe the three transmission channels.
5. Why is a strong dollar "a margin call on the world"?
6. Explain the financial-conditions feedback loop.
