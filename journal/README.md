# Trade journal — archive

**The journal lives in Notion.** Since 2026-09-07 all writing happens there:

https://app.notion.com/p/3d4530da046b80baabc7e8a9bf1992fd

This folder is the frozen archive of entries written before the move. Nothing new goes here.
The dashboard still renders these files under the Journal panel, labelled as archive, and
links out to Notion for anything current.

Why the move: the notebook is handwritten, and photographs of notebook pages need somewhere
that holds images, works on a phone, and can relate an entry to a trade row. Markdown files in
a repo do none of those. What the repo was good at — versioning, grep — Notion trades away,
which is the cost of the decision.

## What went where

| Was | Now |
|---|---|
| `journal/YYYY-MM-DD.md` | Journal database, one page per entry |
| Frontmatter `result` / `tags` / `mood` | Journal properties of the same name |
| `strategy-rules/*.md` | Playbook Rules database (same fields — still mirrored both ways) |
| — | Trade Log database: typed numbers, R multiples, rules-followed rate |

`strategy-rules/` is **not** archived — it still feeds the Pine Script builders, and the Notion
Playbook Rules database deliberately uses the same field names so a rule can be copied either
direction without translation.

## Reading the archive

Format of these files is documented by the entries themselves: optional `---` frontmatter with
flat `key: value` lines, then free-form markdown. The dashboard's parser
(`readJournal` in `scripts/build-dashboard.mjs`) is the reference implementation.

## If you ever move back

The parser and the panel are both intact. Drop new `.md` files in here and they render — the
only thing that changed is the copy telling you where to write.
