# 01 · FX I — Foundations (Part 1 of 5)
Condensed notes in my own words. `[Claude+]` = my additions.

## The gist
FX is the hardest macro asset because a pair is a *ratio of two economies* (no built-in upward drift) and its drivers **rotate over time**. That difficulty is exactly why edge remains: most people settle for trend systems or trading USD on risk swings.

## Key points
- **Drivers rotate by era**: 80s–90s nominal rate differentials → 2000s carry + trade boom → 2010s QE / real rates / central bank policy → 2020s energy, geopolitics, relative GIP. A regression fitted on one era breaks at the next inflection. Learn the mechanics, not one correlation.
- **Two engines per pair**: every move is a *net effect*. **Attribution check**: compare the currency against several others. GBP down against everything = GBP story; down only vs USD = USD story.
- **Regime history** (~500 years): bimetallism / pieces of eight → gold standard / sterling bloc → Bretton Woods (1944–71, USD pegged to gold) → floating since 1971; Europe re-fixed via EMS → euro (1999). Regimes usually change through war or shock, so backtests assuming today's rules are fragile.
- **Country = company**: GDP/income ≈ income statement, BoP ≈ cash flows, national balance sheet = capital structure. The currency prices the world's access to that structure. *Quantify narratives* ("de-dollarisation" → by how much, in which flows?).
- **Impossible Trinity**: fixed FX + free capital + independent policy; you can only have two. Eurozone gives up own policy; China gives up free capital; US/UK/Japan give up the peg (so their FX absorbs the pressure). Pegs absorb stress in reserves, floaters in the exchange rate.
- **Core idea**: a pair expresses the **GIP differential** (relative growth, inflation, policy).
- **Five differentials to watch**: nominal rate spread (whole curve), breakeven spread, real rate / OIS spread, hedged yields, **cross-currency basis** (blows out = genuine USD shortage vs calm = just rate differentials).
- Some currencies are driven more by a key export than by rates (e.g. CAD/oil).
- **Data realities**: US data is best, which is why systematic FX skews US; China is critical but hard to model. Workflow: pull data from official stats sites into spreadsheets. Free tools: FRED, Investing.com, TradingView, OEC (trade composition), CME CVOL/positioning. **FX volume data is mostly noise** (OTC market).

> `[Claude+]` **Quick attribution in practice**: use currency indices, e.g. DXY for USD, plus TradingView's `TVC:EXY`, `TVC:BXY`, `TVC:JXY` (euro, pound, yen indices) or build equal-weight baskets. If EURUSD falls and DXY rises while EXY is flat → it's a USD story. For gold: compare XAUUSD with XAUEUR/XAUJPY. Gold up in *all* currencies = a gold story (haven/CB demand); gold up only in USD = a USD-weakness story.

> `[Claude+]` **2-year yield spread as a first-pass driver**: plotting (US 2y − DE 2y) against EURUSD is the classic starter chart. When the pair diverges from the spread for weeks, ask what else is priced: risk premium, energy, or positioning.

## Self-test
1. Why do fixed FX regressions break?
2. GBPUSD −1%, EURGBP +1%, GBPJPY −1%. Whose story? → GBP
3. State the Impossible Trinity and where the US, China and the eurozone sit.
4. What are the five differentials?
5. What does a blowout in the cross-currency basis tell you?
6. Why shouldn't you lean on FX volume?
