# 12 · FX Options (as an instrument)
Condensed summary in my own words. `[Claude+]` = my additions.

## Core points
- **Definition**: the right, not the obligation, to exchange currencies at a strike by expiry. A call on one currency = a put on the other (GBP call = USD put). Priced off vol, the rate differential and time. Bought options risk the premium; **sold options can lose without limit**.
- **When options beat spot**: (1) better R:R geometry on the same view (a cheap OTM call can give 3–4:1 vs 2:1 spot); (2) a known max loss through events, with no stop slippage; (3) harvesting the IV-over-realised premium by selling short-dated options in calm markets.
- **Reading a ticket** (course example: buy 6m GBPUSD 1.3400 call, £1m, spot 1.3321): premium ≈ 1.66% (~£16.6k); breakeven ≈ 1.3622 at expiry; delta ≈ 42% ≈ rough probability of finishing ITM, and the size of the spot hedge (sell ~£425k). Higher strike = cheaper. European style by default; ~2-day expiry-to-delivery gap. **Test**: is the breakeven move realistic within the tenor?
- **Structures**: *straddle* (buy call + put) = bet on the size of the move, not direction (e.g. cheap 2-week straddle across Fed + BoE). *Knock-out* barrier (e.g. down-and-out at 1.2900) cut the premium from 1.66% to 1.40%, but the option dies if touched. *Up-and-in* activates only above a level. **Premium saved = scenarios given up.**
- **Vol smile**: IV by delta; wings are pricier (fat tails). Left-skewed = puts bid (downside caution). 3m ATM > 6m ATM = near-term event risk. Pick strikes in the flat part of the smile to avoid skew spikes.

> `[Claude+]` **Prop-firm note**: most FX prop firms only allow spot CFDs, so options are mainly *information* for you (risk reversals, event-vol pricing). Use the **implied move** to set expectations: 1-day ATM vol / √252 × spot ≈ expected daily move. E.g. EURUSD 1-week vol of 8% → daily ≈ 0.5% ≈ 55 pips. If your TP needs 150 pips in a day, the market is pricing that as a ~3σ event.

## Self-test
1. Why is a GBP call also a USD put?
2. Give three reasons to use options over spot.
3. What two things does delta tell you?
4. Why is a knock-out cheaper than a vanilla?
5. Left-skewed smile + short tenor ATM above longer tenor. What does it say?
