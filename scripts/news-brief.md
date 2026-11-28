# Desk news brief: daily procedure

Run by the scheduled task `desk-news-brief` every morning. Rewrites the two briefs in
`dashboard/desk/data/news.json`, which the Today page's News panel shows ("Today" and "Week of ..."). The desk reads
the file from GitHub, so a push is enough; no deploy is needed.

## Rules
- **Facts only.** What happened and what is scheduled. Never a call, a bias, a forecast or a trade idea: those are
  Nathan's (Trading Routine Backbone, principle 5).
- **Every price figure comes from `node scripts/news-facts.mjs`.** Never type a level or a move from memory or from a
  headline. If the script errors for a market, leave that market out.
- **Every other fact needs a source** found today (web search). Prefer the company, central bank, agency or a major
  wire. If sources disagree, use the primary source or leave it out. Dates must be checked, not assumed.
- **Scheduled events:** take days, times and central-bank decision dates from the TradingView MCP
  (`mcp-tv-get-economic-calendar`, countries `US,EU,GB,JP,CH,CA,AU,NZ`; times are UTC, write them as UK time).
  Never give a time you did not confirm there or at the source. If a central-bank date is not in the calendar or
  confirmed by the bank, say so.
- **TradingView MCP (paid) is the first source** for calendar, headlines (`mcp-tv-get-news`, `mcp-tv-get-news-story`)
  and any extra market read the script does not cover (`mcp-tv-get-ohlcv`, e.g. CBOE:VIX3M, TVC:MOVE, INDEX:S5FI).
  A headline still needs a source link in `sources`. If the MCP is unavailable, fall back to web search.
- Short, plain sentences. 3 to 5 bullets per list. Write currencies and pairs as codes (AUD, AUDJPY).
- Keep `links` and `note` as they are.

## Steps
1. `git pull --rebase --autostash origin main` in the trading repo.
2. `node scripts/news-facts.mjs` and keep the output.
3. Pull the TradingView calendar (yesterday to the end of next week, `min_importance` 0) and TradingView news.
   Then search the web for anything missing: the last session's market story (equities, rates, FX, commodities, crypto) and its causes;
   anything since the close (Asia session, overnight headlines); this week's economic calendar for the eight FX
   majors (US, euro area, UK, Japan, Switzerland, Canada, Australia, New Zealand) and central-bank meetings.
4. Write `brief` = the latest session (and any overnight news):
   `{ date: today (YYYY-MM-DD, local), summary: [what happened], watch: [what to look for today and tomorrow], sources: [2-4 {title, url}] }`.
5. Write `week`:
   - Monday to Friday: `weekOf` = this week's Monday; `happened` = the week so far (from Monday's open; on Monday,
     the previous week in one or two bullets); `ahead` = the rest of this week's calendar.
   - Saturday and Sunday: `weekOf` = the coming Monday; `happened` = the week just gone; `ahead` = the coming week.
   - Same shape: `{ weekOf, happened: [], ahead: [], sources: [] }`.
6. Check the file parses: `node -e "JSON.parse(require('fs').readFileSync('dashboard/desk/data/news.json','utf8'))"`.
7. Commit only `dashboard/desk/data/news.json` with message `News brief YYYY-MM-DD (desk)` and push. If the push is
   rejected, `git pull --rebase --autostash origin main` and push again (up to 3 times).
8. Report in two lines: the brief's date and the first summary bullet.
