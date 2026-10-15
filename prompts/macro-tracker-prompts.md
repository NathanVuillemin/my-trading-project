# Macro Tracker — update prompts

Master copy lives on the **Prompts** sheet of the newest `Macro_Tracker_v*.xlsx` (Trading System folder). This file mirrors it for scheduling.

## Update rules (every prompt)

1. Work on the newest Macro_Tracker_v*.xlsx in OneDrive › Desktop › Trading System. If it is open/locked in Excel, do NOT overwrite it: stop and report the planned changes instead.
2. Back up first: copy it to backups/<file>_backup_<YYYY-MM-DD_HHMM>_<prompt ID>.xlsx.
3. Write ONLY cells whose Sources row says “Claude” (blue input cells). Never write cells marked “User”: Bias N/Q, User bias, User read, Compare, Journal, Guide thresholds, Events “User notes”, Calendar settings. “Claude drafts → User confirms” cells: put the draft in the note cell and leave the value unless it is empty.
4. Use ONLY the fixed source listed on the Sources sheet for each input. If a source is down or a number cannot be verified, keep the old value and log it as “NOT UPDATED — reason”. Never estimate or fill from memory.
5. Units: percentages as plain numbers (3.1 = 3.1%); yields in %; dates as real dates, never =TODAY(). Never type into grey or green cells — they are formulas.
6. Keep all formulas, formatting, colours and layout. Only the Events table and the Key Levels table may gain rows. Keep Events sorted by Date, then Time; never delete a row that has User notes.
7. Times in Amsterdam time (CET/CEST).
8. After writing: recalculate, confirm zero formula errors, and update the “LIVE DATA as of …” line on every sheet touched.
9. Log the run: add one row to the Update Log sheet (date/time, prompt ID, run by, sheets touched, key changes old → new, stance/bias flips, anything NOT UPDATED). End the reply with the same summary.
10. Anything written into the workbook refers to the human as “User” (never “you”). The AI is “Claude”.

## Prompts

### P0 — FULL CYCLE (scheduled)

- **When:** Every 2 days, 07:00 Amsterdam. Also on demand.
- **Updates:** Everything below, in order. P5 only on Sundays, P6 only on the first run of the month.

```text
Workbook: the newest Macro_Tracker_v*.xlsx in OneDrive › Desktop › Trading System (on the User’s computer; a copy may also live in the cloud later). Before starting, read the workbook’s Prompts sheet (UPDATE RULES) and Sources sheet (one fixed source per input + who fills each cell) and follow both exactly. Run the Macro Tracker FULL CYCLE for today. Do these prompts from the Prompts sheet in this order, as one run with one backup and one Update Log row: (1) P1 Events; (2) P2 Markets; (3) P3 Macro data — only for indicators with a new release since the last Update Log row; (4) P4 Country deep-dive for every currency that had a central-bank decision, central-bank speech, budget or tier-1 release since the last run, or whose Hub “Last checked” is older than 7 days; (5) if today is Sunday, P5 Key levels; (6) if this is the first run this month, P6 Who holds what; (7) P7 AI bias — always last. Finish with a 5-line summary: what changed, which Scorecard stances or FINAL BIAS values flipped, where the AI bias now disagrees with the model or the User bias, the next 3 high-impact events, and anything NOT UPDATED.
```

### P1 — EVENTS & CALENDAR

- **When:** Inside P0 (every 2 days). Manually: Sunday evening.
- **Updates:** Events!A:I (never J = User notes). Calendar updates itself.

```text
Workbook: the newest Macro_Tracker_v*.xlsx in OneDrive › Desktop › Trading System (on the User’s computer; a copy may also live in the cloud later). Before starting, read the workbook’s Prompts sheet (UPDATE RULES) and Sources sheet (one fixed source per input + who fills each cell) and follow both exactly. Update the Events sheet. 1) Download the Forex Factory weekly feed (nfs.faireconomy.media/ff_calendar_thisweek.json, and ff_calendar_nextweek.json when it exists). 2) Keep: every High-impact event; Medium-impact for USD, EUR, GBP, JPY, CNY; bank holidays for USD, EUR, GBP, JPY. Convert times to Amsterdam time. 3) Set Type with the calendar key: Central bank (decisions/press conferences), CB speech (central-bank speakers, minutes), Government (budgets, auctions, treasury, finance ministers), Inflation, Jobs, Growth & business, Holiday. 4) Make sure the next 4 months of Fed, ECB, BoE and BoJ decisions, US CPI and jobs dates (BLS schedule) and national budgets are listed (official calendars). 5) For events that already happened, fill Actual from the official release. 6) Remove duplicates; delete Claude rows older than 30 days unless they have User notes; keep the table sorted. Log: events added / updated / removed.
```

### P2 — MARKETS (prices, yields, risk)

- **When:** Inside P0 (every 2 days).
- **Updates:** Risk & Gold B5:B7, B13:C14, F13:F14 · Scorecard K5:L12 · Key Levels B6:C10 · Hub C26:C31.

```text
Workbook: the newest Macro_Tracker_v*.xlsx in OneDrive › Desktop › Trading System (on the User’s computer; a copy may also live in the cloud later). Before starting, read the workbook’s Prompts sheet (UPDATE RULES) and Sources sheet (one fixed source per input + who fills each cell) and follow both exactly. Update the market inputs. Risk & Gold: VIX (FRED VIXCLS), S&P 500 close and 200-day average of the last 200 closes (FRED SP500), US 10Y real yield now and ~1 month ago (FRED DFII10), ICE DXY now and ~1 month ago (same series in both cells); rewrite the F13/F14 driver notes in one line each. Scorecard 2Y yield now and 1 month ago for every currency row that has data (US FRED DGS2, EUR German 2Y Bundesbank, GBP UK 2Y gilt, JPY Japan MoF JGB 2Y); “1 month ago” = same date last month or the nearest trading day before. Key Levels: current price + today’s date for every instrument in A6:A10 (Interactive Brokers). Hub risk barometer C26:C31 using the fixed rules on the Sources sheet (1-month change: AUD/JPY, CPER÷GLD, XLY÷XLP, HY spread, asset leader, CNN Fear & Greed). Log old → new for each number and any Scorecard pricing-score, risk-regime or gold-bias flip.
```

### P3 — MACRO DATA (Scorecard stats)

- **When:** Inside P0 when a release happened. Manually after CPI / jobs / PMI / GDP.
- **Updates:** Scorecard C, E:J, S · Bias Builder blue indicator cells (headline CPI, wages, GDP, previous policy rate).

```text
Workbook: the newest Macro_Tracker_v*.xlsx in OneDrive › Desktop › Trading System (on the User’s computer; a copy may also live in the cloud later). Before starting, read the workbook’s Prompts sheet (UPDATE RULES) and Sources sheet (one fixed source per input + who fills each cell) and follow both exactly. Update the macro statistics for USD, EUR, GBP, JPY (and any other Scorecard row the User has started filling). Only change a number if a NEW official release came out. Scorecard: policy rate (after a decision), core CPI YoY now + the month 3 months earlier, unemployment now + 3 months earlier, composite PMI FINAL print — using the exact series on the Sources sheet (US FRED; Eurostat; ONS; Statistics Bureau of Japan core-core; S&P Global / HCOB). Bias Builder: headline CPI now + 3 months earlier, wage growth, GDP q/q latest + previous quarter, previous policy rate after a decision. If a currency’s score or STANCE changes, rewrite its Scorecard Notes (S) in one line: which print would flip it next. Log each changed number old → new and every score / stance flip.
```

### P4 — COUNTRY DEEP-DIVE  [CURRENCY]

- **When:** On demand, and inside P0 after a central-bank or tier-1 event.
- **Updates:** Bias Builder block for that currency (narrative rows + AI read) · Hub row (situation, theme, last checked) · Scorecard S · new catalysts into Events.

```text
Workbook: the newest Macro_Tracker_v*.xlsx in OneDrive › Desktop › Trading System (on the User’s computer; a copy may also live in the cloud later). Before starting, read the workbook’s Prompts sheet (UPDATE RULES) and Sources sheet (one fixed source per input + who fills each cell) and follow both exactly. Country deep-dive for [CURRENCY] as of today. Research with current sources: 1) the central bank’s last decision, vote split and the key guidance line (quote it); 2) latest inflation, jobs and growth prints vs expectations; 3) what the market prices for the next meeting and further out (probability + as-of date, from the source on the Sources sheet); 4) what the treasury / finance ministry / government is saying, plus fiscal and political events; 5) FX intervention and big official holders; 6) the next 3 catalysts with dates. Write it into the [CURRENCY] block on Bias Builder (Last decision, Vote, Central bank is saying, Market pricing next / further out, Treasury / government, Fiscal & political calendar, AI read stance + confidence + one-paragraph reasoning), the Hub row (Situation in one line, Main theme / risk, Last checked = today) and Scorecard Notes. Add any missing catalysts to Events. In the reply: the full brief, then ONE line for the Hub and what would change the picture.
```

### P5 — KEY LEVELS REVIEW

- **When:** Sundays (inside P0). Manually before a trading week.
- **Updates:** Key Levels B6:C10, rows 13–52 (I “Last tested”, J “Reaction”, new proposed rows).

```text
Workbook: the newest Macro_Tracker_v*.xlsx in OneDrive › Desktop › Trading System (on the User’s computer; a copy may also live in the cloud later). Before starting, read the workbook’s Prompts sheet (UPDATE RULES) and Sources sheet (one fixed source per input + who fills each cell) and follow both exactly. Review the Key Levels sheet. 1) Update current prices and dates (Interactive Brokers). 2) For every level, check the daily history since its “Last tested” date: if price traded within the NEAR distance on the Guide sheet, set Last tested to that date and describe the reaction in a few words (held / broke / swept and reversed). 3) For rows whose Source says “verify”, confirm the level from price history or an official source and replace “verify” with the source — or flag it. 4) Propose up to 3 new levels per instrument (policy lines, big option strikes/expiries, prior highs/lows) as new rows with Source “Claude proposal <date>”. Never delete or edit a row the User added or changed. Log levels tested, verified and proposed.
```

### P6 — WHO HOLDS WHAT

- **When:** Monthly (first P0 run of the month).
- **Updates:** Hub C18:D22.

```text
Workbook: the newest Macro_Tracker_v*.xlsx in OneDrive › Desktop › Trading System (on the User’s computer; a copy may also live in the cloud later). Before starting, read the workbook’s Prompts sheet (UPDATE RULES) and Sources sheet (one fixed source per input + who fills each cell) and follow both exactly. Update Hub section B (Who holds what). For each row write one line “what changed” from the latest release and set Last checked to today: US Treasury TIC (foreign holdings / flows, Japan and China), World Gold Council central-bank gold statistics, IMF COFER reserve shares (quarterly — keep the old line if no new quarter), Japan MoF monthly FX intervention amounts, CFTC Commitments of Traders (speculative positioning in JPY, EUR, GBP, gold, USD). Log anything that changes the gold research score or a currency story.
```

### P7 — AI BIAS

- **When:** Always last in P0. Manually after any update.
- **Updates:** Bias Builder C6:C9, D6:D9, G6:G9 · AI read rows in every block (stance, confidence, reasoning) · gold AI read.

```text
Workbook: the newest Macro_Tracker_v*.xlsx in OneDrive › Desktop › Trading System (on the User’s computer; a copy may also live in the cloud later). Before starting, read the workbook’s Prompts sheet (UPDATE RULES) and Sources sheet (one fixed source per input + who fills each cell) and follow both exactly. Refresh the AI bias on the Bias Builder sheet using only what is in the workbook now (Scorecard, Bias Builder blocks, Risk & Gold, Key Levels, Events, Hub). For each currency block set the AI read stance (HAWKISH / NEUTRAL / DOVISH), confidence (High / Medium / Low) and a 2–3 sentence reasoning that names the strongest point FOR and AGAINST. For each pair set AI bias (LONG / SHORT / FLAT), the key driver in ≤2 lines and confidence; say explicitly when the AI bias disagrees with the model FINAL BIAS and why. Gold: AI read + reasoning from the Risk & Gold drivers vs price. Never touch User bias or User read. Reply with a table: pair · model · AI · User · agreement · what would flip the AI bias.
```

### P8 — AFTER-EVENT UPDATE  [EVENT]

- **When:** Manually, right after a tier-1 release or a central-bank decision.
- **Updates:** Events Actual · affected Scorecard / Bias Builder numbers · that currency’s Bias Builder block · AI bias for affected pairs.

```text
Workbook: the newest Macro_Tracker_v*.xlsx in OneDrive › Desktop › Trading System (on the User’s computer; a copy may also live in the cloud later). Before starting, read the workbook’s Prompts sheet (UPDATE RULES) and Sources sheet (one fixed source per input + who fills each cell) and follow both exactly. After-event update for [EVENT, e.g. “US CPI Oct” or “BoE decision”]. 1) Fill Actual on the Events row (official release) and note forecast vs actual. 2) Update only the Scorecard / Bias Builder numbers this release changes (P3 rules). 3) If it was a central-bank decision or speech, rerun P4 for that currency. 4) Rerun P7 for the pairs that contain that currency. Reply in 5 lines: surprise vs forecast, what moved in the workbook, stance / bias flips, what the market did, next catalyst.
```

### P9 — WHAT CHANGED? (read-only)

- **When:** Any time.
- **Updates:** Nothing — read only.

```text
Workbook: the newest Macro_Tracker_v*.xlsx in OneDrive › Desktop › Trading System (on the User’s computer; a copy may also live in the cloud later). Read-only check of the Macro Tracker (do not write anything). Summarise: the last 3 Update Log rows; current FINAL BIAS, AI bias and User bias per pair and where they disagree; every Scorecard stance; the risk regime and barometer; any stale input (Hub Last checked > 14 days, LIVE DATA stamps > 3 days old, Bias status EXPIRED / NOT REVIEWED); and the high-impact events in the next 7 days from the Events sheet.
```

## Scheduling

- Schedule only P0. It already calls the others at the right frequency (P5 on Sundays, P6 monthly).
- Every 2 days at 07:00 Amsterdam (05:00 UTC in summer, 06:00 UTC in winter) gives fresh data before the London open.
- The workbook lives on the User’s computer, so a scheduled run needs that computer on and linked (or the workbook moved to cloud storage later).
- If Excel has the file open when a run starts, the run will not overwrite it — it reports the planned changes instead (rule 1). Close the workbook overnight.
- User can run any single prompt by copying it from column E (replace [CURRENCY] / [EVENT]).
