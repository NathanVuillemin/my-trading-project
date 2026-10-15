# Notion trading journal — setup

**Built already** — the workspace was created directly through the Notion connector on
2026-09-07, so the import steps below are only a rebuild recipe. The CSV and Markdown files
in this folder are the offline copy of what lives in Notion.

Notion page: https://app.notion.com/p/3d4530da046b80baabc7e8a9bf1992fd

Import-ready files. Notion imports Markdown as pages and CSV as databases.

## Structure

```
Trading System                (your existing page — the hub)
├── System Playbook           page   — the rulebook
│   └── Playbook Rules        database (from playbook-rules.csv)
├── Trade Log                 database (from trade-log.csv)
├── Journal                   database of pages, one per entry
└── Reviews                   page — daily / weekly / monthly templates
```

Four databases is the whole system. Resist adding more.

## Build order

**1. Trade Log**
On your page: `/database - inline`, name it `Trade Log`. Then `···` → Merge with CSV →
`trade-log.csv`. Notion imports every column as Text — fix the types after:

| Property | Type |
|---|---|
| Date | Date |
| Ticker | Select |
| Direction | Select (Long / Short) |
| Setup | Relation → Playbook Rules |
| Timeframe | Select |
| Entry, Stop, Target, Size, Exit | Number |
| R Multiple | Number |
| Result | Select (Win / Loss / Scratch / Open) — colour these |
| Rules Followed | Checkbox |
| Mistake Tag | Multi-select |
| Emotion | Select |
| Context, Notes | Text |

Delete the two example rows once the types are set.

**2. Playbook Rules**
Same import flow with `playbook-rules.csv`. Set `Status` to Select, `Trades Logged` to
Rollup (count of related Trade Log rows). Fields mirror `strategy-rules/_TEMPLATE.md` in the
repo, so a rule can be copied either direction without translation.

**3. System Playbook**
Import `system-playbook.md` as a page. Fill in the blanks — the `__` placeholders are your
actual risk numbers, and leaving them blank is how a rulebook becomes decoration.

**4. Journal**
`/database - inline`, name it `Journal`. Properties: Date (Date), Result (Select), Tags
(Multi-select), Mood (Select), Trade (Relation → Trade Log).
Then: `···` → Templates → New template, and paste the body of `journal-entry-template.md`
into it. Name the template `Entry`. Set it as the default for new pages.

**5. Reviews**
Import `review-templates.md` as a page. Make each of the three sections a database template
in a `Reviews` database (Date + Type properties), or keep it a simple page and duplicate the
block — the simple version survives longer.

## Handwritten pages

The notebook stays the primary surface. Notion is the index over it.

- Photograph the page, drop the image into that day's Journal entry.
- Write two lines of gist under the photo. Notion cannot search your handwriting; it can
  search the gist. Skipping the gist makes the photo unfindable in three months.
- Anything with a number in it (entry, stop, size, R) goes into Trade Log as a real property,
  not only in the photo. Charts and stats need typed numbers.

Rule of thumb: notebook is where you think, Notion is where you can find it again.

## Formula properties worth adding

On Trade Log:

```
R Multiple (if you'd rather compute than type):
if(prop("Direction") == "Long",
   (prop("Exit") - prop("Entry")) / (prop("Entry") - prop("Stop")),
   (prop("Entry") - prop("Exit")) / (prop("Stop") - prop("Entry")))
```

```
Planned R:
if(prop("Direction") == "Long",
   (prop("Target") - prop("Entry")) / (prop("Entry") - prop("Stop")),
   (prop("Entry") - prop("Target")) / (prop("Stop") - prop("Entry")))
```

## Views to create on Trade Log

- **This week** — filter Date is within past week
- **By setup** — group by Setup, show sum of R Multiple. This is the view that retires setups.
- **Broke rules** — filter Rules Followed is unchecked. Compare its average R against the
  full table; the gap is the cost of your discipline.
- **Open** — filter Result is Open. Should be empty at the end of every session.

## Relationship to the repo

The repo's `journal/` and `strategy-rules/` folders and the dashboard read from files, and
Notion has no automatic link to them. Two options:

- **Notion as primary.** Journal in Notion, and the repo dashboard's journal panel goes stale.
- **Repo as primary, Notion as the readable layer.** Keep writing `journal/YYYY-MM-DD.md`,
  paste into Notion when you want it on your phone.

Pick one and write it into the Playbook. Maintaining both by hand fails within a month.
