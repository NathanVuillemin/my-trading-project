# F9 · How Markets Work
Big idea: every trade has a **specific counterparty with constraints**. Ask "who *has* to act here?"

## Order flow
- Exchange (stocks, futures): central **order book**, matched by price then time. OTC (most bonds and FX): dealers quote you directly.
- Path: you → broker → book/dealer → clearing & settlement (T+1/T+2).
- Quoted price = best bid/offer right now; size moves it.
- **Market order**: certain fill, uncertain price (slippage). **Limit**: certain price, uncertain fill. **Stop**: activates at a trigger; stop clusters = forced flow worth hunting.

## The players
| Player | Motive / constraint |
|---|---|
| Market makers | Earn the spread, hedge instantly, no view |
| Banks/dealers | OTC wholesale; regulation limits what they can hold |
| Real money (pensions, insurers, SWFs) | Huge, slow, mandate-driven; rebalancing moves prices for days |
| Hedge funds | Fast, leveraged; the usual crowded-trade suspects |
| Corporates | Hedging real business; price-insensitive |
| Central banks / govts | Policy, reserves, issuance; not profit-driven |
| Retail | Small, sometimes decisive in aggregate; prey on short timeframes |
| HFT/algos | Speed; don't compete there |

## The clock
Asia → London → NY (overlaps busiest, US afternoons thin). Economic calendar, expiries, ex-dividend dates and quarter-end rebalancing explain a lot of "mystery" moves.

## Self-test
1. Market vs limit order: which guarantees what? → Market = fill; limit = price
2. Why do stop clusters matter to price action? → They create forced flow when triggered
3. Price-insensitive players who must trade regardless? → Corporates hedging, central banks, rebalancing real money
4. A big move in the last hour of quarter-end with no news. First hypothesis? → Rebalancing flows
