# Trading Desk

Nathan's own layer on top of what he already receives. Market Context and his coach's Markets Desk (morning debrief and weekly review in one page, since 2026-11-21) give him
the data; this desk holds what he does with it: his weekly scorecard and pairs, his if/then lines, kill
switches, key levels, daily notes, ideas, and a review of whether his calls were right.

**Rule: the desk shows no data he is sent elsewhere.** Exceptions Nathan asked for: the Positioning page
(2026-11-15), which reads official positioning data for his currencies and the markets his ideas touch, and the
drivers and correlations on the Drivers page (2026-11-17), which say which driver is in control of a market and when
it lets go. Crypto stays off the desk, Bitcoin excepted. Otherwise the one thing it reads is a small live price file,
used only to hold his own entries against the market.

Live: `/my-trading-project/desk/`. Preview locally: `npm run desk`, then http://localhost:8787/desk/
(pages fetch JSON, so file:// won't work). Deploys with the rest of `dashboard/` via `whale-flow.yml`
(daily, or a manual run; a push alone does not publish).

## Pages
| Page | File | Holds |
|---|---|---|
| Today | `index.html` | Also: "whose story is it?" attribution heatmap (each currency against each other, today / week / month) and the News panel (summary, what to look for, links out). Original: | This week's confirmed pairs against live prices (last, today, week, 1 month, with or against his call, a live TradingView mini chart, his events, levels and kill switches for the pair); every currency's score against its move; the seven-question daily read with links; the three-line daily note |
| Scorecard | `scorecard.html` | The weekly build: his view per currency (read-only, from Countries: the entry in force that week, with its date and age, amber when written before the week's Monday; older cards keep a sentence typed on the card), his call, score, ranking, pair proposals, week-ahead events with if/then. A positioning map (COT gauge per currency) heads it; each currency card carries its gauge; "COT crowded my way" fills itself from positioning once a call is made (`crowdedBy: cot`) until he ticks it himself (`crowdedBy: me`); each proposed pair shows a base-vs-quote bar and whether positioning is crowded his way. Each currency card opens with a five-layer funnel against his call: data directions, 1-month move rank, bank lean vs what is priced, and positioning, shaded lines up / against / no read. Also: a regime dial placing every currency on growth momentum × inflation momentum and inflation level × direction (MMH 04/05); "pages in the book" on each proposed pair (data, banks, price, trend, positioning, catalyst; MMH 10); and a reaction column on events: he picks beat / in line / miss, the desk reads the basket move, σ, whether it held and the next three days (MMH 00.7) |
| Countries | `countries.html` | At the top, **My read**: his current view of the chosen economy, written next to this week's Market Context labels and saved dated to `views.json` (earlier entries listed under it); it shows on the Scorecard. Below, layer 1 of the Market Macro Hub framework: each economy's seven-part profile (history, demographics, capacity, geography, resources, politics, the three regimes), quantified, plus side-by-side bars, a commodity long/short heatmap, how it shows in price, what to watch, and its positioning card. From `data/countries.json`, written by hand, refreshed yearly |
| Playbook | `playbook.html` | The course's framework as visuals and checklists: five-layer funnel (linked to the desk page for each layer), policy-regime map, duration x credit grid, transmission chain, release-to-reaction matrix, protocols filterable by layer, theories, data points and thresholds. From `data/playbook.json` |
| Drivers | `drivers.html` | **What is driving each market, and when it stops.** At the top, the market regime: Nathan's VIX rule (VIX under 18 with the S&P above its 200-day = risk-on, over 30 = risk-off, else caution) and the "where is money moving" barometer from his Macro Tracker (AUDJPY, copper/gold, US high-yield spread, discretionary/staples, safe havens vs the S&P; each on its 20-day change, a lead of two decides), whether they agree, US rates and dollar over 3 months. Then **Who is driving**: per currency (plus gold and Bitcoin) the links that normally hold: real-world drivers (oil for CAD and JPY, gas for EUR, iron ore, copper and China for AUD, dairy and China for NZD, fear for CHF), the 2Y yield gap against the US, and risk. Each shows three dials, 3 days (hourly bars, against a 2-year normal), 20 and 60 days (daily, against a 5-year normal), and a state: in control (20-day correlation in its usual direction at 0.5+) or not (below 0.3), since when, and "breaking" when the 3 days drop below normal while the 20 days still hold. Click a link for 5 years of history, the typical move per 1% (or 10bp), and how it behaved under each VIX rule, rates and dollar state, with the currency's growth and inflation direction from the Scorecard. Below, the cross-asset readings Market Context does not carry, one course module each: US net liquidity (06), gold driver stack (23), US curve regimes (03), growth breadth (04), inflation pace (05, FX II), equity bounce check (00.4), stock-bond correlation (08), the 28 pairs by trend × volatility (00.9). From `data/correlations.json` and `data/drivers.json` |
| Kill Switches | `kill-switches.html` | Conditions that change or end a bias |
| Key Levels | `levels.html` | His own levels, sorted by distance from the live price |
| Positioning | `positioning.html` | How capital is positioned: his confirmed pairs against positioning (crowded his way or against him), the eight currencies (asset managers, leveraged funds, dealers), each open idea's markets and currencies, Japan's weekly real-money flows for JPY, all 28 pairs, and the markets list. Read-only. Visuals shared with Scorecard and Ideas: `posGauge` (0-100 track, crowded ends shaded, ● asset managers, ◆ leveraged funds / managed money, hollow = 4 weeks ago), `posTrend` (26 weeks), `posPairBar` (base vs quote) |
| Ideas | `ideas.html` | Inbox for ideas from podcasts, videos, calls: open, kept or dropped. Once an idea has research, positioning cards for its markets and currencies show under it, open |
| Review | `review.html` | Also the release-to-reaction tally: logged events in the 3x3 grid with average three-day follow-through per cell. Original: | Each saved week graded from prices: pairs by their move in his direction, currency calls by the currency against the other seven |

All pages are thin shells (`<body data-page="…">`); `assets/desk.js` draws the nav and one renderer per page.

## Data
Everything Nathan types is one JSON file per domain in `data/`, committed through the GitHub contents API.
| File | Holds | Key fields |
|---|---|---|
| `scorecard-index.json` | Weeks with a scorecard, newest first | `weeks[{monday, pairs[{pair, dir}], scores{CCY: n}}]` |
| `scorecard-<monday>.json` | One weekly build, named by the Monday of the trading week | `monday, updated, active[CCY], currencies{CCY: {growth{level,dir}, inflation{level,dir}, labour{level,dir}, sentence, lean, priced12m, weekChange, call (tooLittle/aboutRight/tooMuch), strong, crowded, rank1m}}, pairs[{pair, dir, diff}], events[{id, date, currency, event, ifThen}]` |
| `views.json` | His view per currency, written on Countries | `views{CCY: [{date, text}]}`, newest first; one entry per day. A scorecard week shows the newest entry dated on or before its Friday |
| `daily-notes.json` | The three lines per day | `days{YYYY-MM-DD: {story, ifThen, biasCheck, done[1-7], saved}}` |
| `killswitches.json` | Kill switches | `kinds{}, effects{}, killSwitches[{id, currency, kind, condition, now, effect, status (armed/near/fired), firedOn, by, created, edited}]` |
| `levels.json` | Key levels | `note, families{}, types{key: {family, desc}}, statuses{}, levels[{id, instrument, level, type, side, who, evidence, status, lastTouch, created, edited}]` |
| `ideas.json` | Ideas | `ideas[{id, date, source, text, status (open/kept/dropped), research?}]`. `research` is written by the `idea-researcher` agent through `scripts/idea-research.mjs --apply`: thesis, instruments, claims with verdicts and sources, what is priced, what confirms and kills it, fit with the routine, a keep/drop/watch suggestion. Read-only on the page; the decision is Nathan's |
| `positioning.json` | Positioning | Written by `scripts/desk-positioning.mjs` (`npm run positioning`) in the daily CI run: `cotDate, lookbackYears, currencies{CCY: {groups[{name, role (slow/fast/hedging), net, index, index1w, index4w, shareOfOi, tag, spark}], squeeze}}, markets[...], jpyFlows{weekEnding, lines[]}, warns`. Index = percentile of the net inside its own 3-year range. CFTC TFF for FX and financials, disaggregated for commodities; USD derived from the seven legs in dollars (no dollar-index contract exists in COT). Ideas link to markets by keywords in `desk.js` (`POS_IDEA_MARKETS`). Not included: CME daily open interest (CME blocks scripts and its terms forbid scraping) and retail sentiment (Myfxbook behind Cloudflare, others need an account) |
| `drivers.json` | Drivers, Scorecard trend page | Written by `scripts/desk-drivers.mjs` (`npm run drivers`) daily in CI from FRED (keyless fredgraph.csv) and Yahoo: `liquidity, gold, curve, growth, inflation, bounce, stockBond, pairs, warns` |
| `news.json` | Today | No news feed: `links[{group, title, url}]` out to news sites, calendars and central banks, plus `brief{date, summary[], watch[], sources[]}` written on request ("today's news brief") |
| `correlations.json` | Drivers | Written by `scripts/correlations.mjs` (`npm run correlations`) daily in CI; maths in `scripts/lib/corr-math.mjs` (tests: `npm run test:corr`), sources in `scripts/lib/corr-sources.mjs`. `asOf, method, sources, missing, errors, regime{asOf, vix{value, spx, spx200, rule}, gauges[{key, label, chg20, unit, read, spark}], verdict, agree, rates{chg63bp, split}, dollar{chg63pct, split}, history}, links[{id, group, target, driver, labelT, labelD, typical, story, r3d{r, n, normal{p10,p50,p90}}, r20{r, normal}, r60{r, normal}, beta60, state (in/out), since, wrongWay, breaking, history{weekly, daily, changes}, byRegime{vix, rates, dollar}}]`; NZ dairy is a `level` (GDT auctions). Sources, keyless: Yahoo (daily 6 years, hourly 2 years), FRED, 2Y yields from the Bank of Canada, Bank of England, RBA, Japan's Ministry of Finance and the Bundesbank, Global Dairy Trade. No free daily 2Y for CHF and NZD: listed as missing |

## Ideas: from a podcast to a checked idea
1. Nathan writes the idea raw on the Ideas page (date, source, a few lines).
2. The words behind it go in `inbox/` (git-ignored, publishers' material): `python scripts/ingest-transcript.py <url-or-file> --title "..." --date YYYY-MM-DD`.
   Handles a transcript PDF (MacroVoices links one per episode), a YouTube URL (needs `pip install youtube-transcript-api`) or a text file.
   Or give the link to the `podcast-digest` agent (`.claude/agents/podcast-digest.md`): it ingests, reads the whole thing and writes
   `inbox/digest-<date>-<slug>.md` with attributed claims, data points, what to watch and candidate ideas. Nathan picks which candidates
   become ideas, in his own words.
3. The `idea-researcher` agent (`.claude/agents/idea-researcher.md`) reads the idea, the inbox and the web and writes `inbox/research-<id>.json`.
4. `node scripts/idea-research.mjs --apply inbox/research-<id>.json` merges it under the idea as `research`; `npm run ideas` lists ideas and which have research. Commit `ideas.json` to publish.
5. The page shows the research under the idea, folded. Nathan reads it and sets kept or dropped himself.

## Live prices
Two inputs, combined in the browser (`derivePrices` in `assets/desk.js`):

1. **Live quotes.** Every page that shows prices fetches Coinbase's public exchange-rates endpoint
   (`api.coinbase.com/v2/exchange-rates?currency=USD`, keyless, open to browsers) once a minute. These are
   reference rates that update every minute or two and sit within about 0.02% of the interbank quote: good for
   moves and distances, not an executable price. A pill shows the quote's age; if the fetch fails, pages fall
   back to the newest reference value and say so.
2. **Reference closes.** `scripts/desk-live.mjs` pulls three months of daily closes for the seven USD pairs from
   Yahoo Finance (keyless) and writes `asOf, priceTime, source, history{dates[], usd{CCY: []}}` (USD per unit of
   each currency; the last bar is the session in progress). CI force-pushes the file to the `desk-live` branch
   (a single commit, replaced each time, so main's history stays clean) and pages read it from
   `raw.githubusercontent.com/…/desk-live/live.json`.

While spot FX is shut (Friday 17:00 to Sunday 17:00 New York time) the desk ignores live quotes, which keep drifting
on thin weekend rates: prices hold the last daily close, "today" is that last session, and a pill says "FX closed".

From those the browser works out, for all 28 pairs and for each currency against the other seven: last, today,
week to date, one month, the typical daily move over the last 20 sessions, and ranks.

The closes only change once a day, which matters because **GitHub starts this repo's scheduled jobs hours
late** (the 22:00 UTC daily job has started between 00:46 and 03:58). So nothing live depends on a schedule:
the daily `whale-flow.yml` job publishes the closes at its end, and `desk-live.yml` tries again hourly. If the
published file predates yesterday's final close, pages flag the day change as approximate.

The TradingView mini charts on Today are the only tick-live element.
Local: `npm run desk:live` writes `data/live.json` (git-ignored), which the local preview also reads.

## As an app on the laptop and the iPad
The desk carries a web app manifest (`manifest.webmanifest`, icons in `assets/icons/`). On the iPad: Safari → Share → Add to
Home Screen. On the laptop: Chrome or Edge → Install app. Both are a window around the live site, so every deploy reaches
them on the next open (after Pages' ten-minute cache); nothing to reinstall. The installed copy has its own storage, so the
token and the brief links are pasted once more inside it. No service worker, so no offline mode and no stale-cache trap.

## Saving
Pages are static, so saves go straight to the repo. Nathan pastes a fine-grained token (this repo only,
Contents read and write) once per device on any page; it stays in that browser's localStorage and is sent only
to api.github.com. Each save re-reads the file and applies one change, so a commit made in between is never
overwritten; a file that does not exist yet is created. Without a token pages are read-only. Pages read the
repo's current file, not the deployed copy, so a save shows at once.

The link to his coach's Markets Desk used by the daily checklist is private: it is pasted once per device and
kept in localStorage, never in the repo.

## Local test mode
Add `?store=local` to any desk address: every save goes to this browser's localStorage instead of GitHub (a
banner shows it; the flag lasts for the browser session). `?store=github` switches back. Use it for trying
pages and for testing changes: without it, with a token connected, a save commits to main even from `npm run desk`.

## Scorecard rules
One card per trading week; a build done on Saturday or Sunday belongs to the coming Monday. Score per currency:
the call gives the sign (too little priced = +1, about right = 0, too much priced = -1), "strong" doubles it,
crowded positioning pulls it one notch towards zero. Pairs are every two active currencies with different
scores, widest gap first; highest against lowest is marked. Nathan confirms two or three.

## Review rules
A week is measured from the last daily close before its Monday to its Friday close (or the latest price while
it runs). A call counts as right when price moved more than 0.05% its way. Direction only: it does not grade
entries or exits.
