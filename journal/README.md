# Trade journal

One markdown file per entry: `journal/YYYY-MM-DD.md`. Multiple entries in a day are fine —
add a suffix: `2026-07-25-b.md`.

The dashboard reads every file here and renders the newest ones. Git gives you free version
history, and the whole journal stays greppable from the command line.

## Format

Frontmatter is optional but makes entries filterable. Keys are plain `key: value` lines
between `---` fences — no nested YAML, since the parser is deliberately dependency-free.

```markdown
---
date: 2026-07-25
tags: BTC, short, liquidity-sweep
mood: patient
result: open
---

## Setup
What you saw. Which level, which timeframe, what made it valid.

## Execution
Entry, size, stop, target. What you actually did versus what you planned.

## Notes
What you got wrong. What you'd repeat.
```

Recognised frontmatter keys (all optional):

| Key | Use |
|---|---|
| `date` | Overrides the filename date |
| `tags` | Comma-separated. Shown as chips |
| `result` | `win` / `loss` / `open` / `scratch` — colour-coded |
| `mood` | Free text. Worth tracking against results over time |

Everything below the frontmatter is free-form markdown. The first heading becomes the
entry title in the dashboard.

## Why files rather than an app

A static dashboard has no backend to accept input. Files in the repo cost nothing, version
themselves, survive any tool change, and work offline. You can edit them from the GitHub
mobile app when you're away from the machine.

## Writing entries from your phone

Open the repo in the GitHub app, navigate to `journal/`, tap **Add file**. The dashboard
picks it up on the next build.
