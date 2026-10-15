# 18 · Repo Markets
Condensed summary in my own words. `[Claude+]` = my additions.

## Core points
- **Repo** = sell securities for cash and agree to buy them back at a slightly higher price (a secured short-term loan). Reverse repo = the cash lender's side. Tenors: overnight, term, open. Venues: tri-party (clearing agent; general collateral), bilateral (specific bonds/"specials"), interdealer.
- **Rates**: GC repo (secured) usually sits below Fed funds (unsecured); the gap widens in stress and at reporting dates. **SOFR** = the NY Fed's daily volume-weighted median of repo trades (smooth); GC repo = the live tradeable print (can spike at quarter-ends while SOFR looks calm).
- **Collateral hierarchy and haircuts (approx.)**: Treasuries/G10 govts ~1–2% → agencies ~1–5% → IG corporates ~3–10% → EM sovereigns ~5–15%. Haircut hikes in stress force deleveraging. Basel III favours high-quality secured funding.
- **Specials**: when borrowing demand for one bond exceeds supply (often crowded shorts or futures delivery), its repo rate drops below GC, even negative. Example: March 2021, when the on-the-run 10y went deeply negative as shorts crowded in over quarter-end.
- **Three jobs**: core funding (dealers, leveraged funds; often the last route open in stress); **policy transmission** (ON RRP = floor, Standing Repo Facility = ceiling, plus operations); **early stress indicator**.
- **Stress episodes**: 2008 (haircut spiral and refusal to roll repo preceded failures); Sept 2019 "repocalypse" (overnight ~2% → 6%+ on tax payments + Treasury settlement draining reserves → Fed operations); March 2020 (even Treasury repo strained → massive Fed ops).
- **Players**: dealers (matched books), hedge funds (big borrowers, e.g. the cash-futures basis trade), money funds (big lenders), central banks, corporates.
- **Niche trades**: specials trading (own and lend out a bond expected to go special) and supporting the Treasury cash-futures basis trade (repo sets its carry).

> `[Claude+]` **Stress checklist** (FRED): `SOFR` vs `IORB` (SOFR persistently above the interest on reserves = reserves getting scarce), `RRPONTSYD` falling toward zero (buffer gone), the SRF usage spike. These flagged tightening in late 2025, and QT was ended partly for this reason. A repo accident is a classic trigger for sudden Fed easing → typically USD down, gold up after the initial liquidation.

## Self-test
1. Explain repo from both sides.
2. Why does GC repo usually trade below EFFR?
3. SOFR vs GC repo: which is smoother and why?
4. What makes a bond "special"?
5. How do ON RRP and the SRF form a corridor?
6. What happened in Sept 2019?
