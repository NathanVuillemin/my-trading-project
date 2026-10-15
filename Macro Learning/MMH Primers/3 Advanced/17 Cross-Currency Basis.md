# 17 · Cross-Currency Basis
Condensed summary in my own words. `[Claude+]` = my additions.

## Core points
- **What**: the gap between funding rates implied by FX swaps and the actual interbank rates. Under perfect CIP it would be zero; in practice it's usually **negative vs USD**, reflecting the world's standing demand for dollars.
- **XCCY basis swap**: principals swapped at spot at the start → both sides pay floating rates on what they received during the term (basis added to the **non-USD leg**, the market convention) → principals swapped back at the *same* original rate. It's real funding with no FX risk if held to maturity. A negative basis means the non-USD side accepts less, i.e. pays a premium for dollars.
- **Users**: corporates (borrow at home, swap into USD for a foreign project), banks/dealers (intermediate, OTC), hedge funds (funding, RV, speculation), SWFs/pensions (structural hedges), central banks (swap lines).
- **Drivers**: mostly **dollar scarcity**; rate differentials matter less in practice; central bank swap lines are the circuit breaker. Episodes: 2017 tax repatriation (basis toward −100bp, quickly resolved); March 2020 (Fed swap lines drawn from ~0 to ~$450bn by end-April); the **year-end turn** (dealers shrink balance sheets every December → basis widens → normalises in January).
- **Market**: OTC out to 30y, deepest at 1m/3m/1y in EURUSD and USDJPY. New in 2025: a cash-settled EURUSD basis future (cleared, no principal exchange).
- **Trades**: arbitrage (usually only a few bp, needs size and leverage), relative value on the basis curve or across pairs, macro views on dollar liquidity (paying vs receiving the non-USD basis).
- **Behaviour**: panics overshoot; policy gets over-anticipated; the year-end turn is front-run earlier every year.

> `[Claude+]` **Practical use for you**: you won't trade the basis, but a sharply more negative EURUSD/USDJPY 3m basis is a **USD-funding-stress alarm**. In those moments USD tends to rise against almost everything (even vs JPY at first), and gold can be sold for liquidity before recovering. Late December liquidity is thin and funding-distorted, so it's a good time to cut size.

## Self-test
1. Why should the basis be zero in theory, and why isn't it?
2. Walk through the three phases of a basis swap.
3. What does a −25bp EURUSD basis mean for each leg?
4. Name the three case studies and what ended the 2020 episode.
5. Why does the basis widen every December?
