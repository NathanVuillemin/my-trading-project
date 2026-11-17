# Country views Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nathan writes his per-currency view on Countries; the Scorecard shows it read-only with its age; all desk textareas auto-grow.

**Architecture:** New data file `dashboard/desk/data/views.json` saved through the existing `ghUpdate`/local-test store. Helpers in `assets/desk.js` resolve the view in force for a week. Countries gets a "My read" panel; Scorecard replaces its sentence textarea with a read-only block. Auto-grow is CSS `field-sizing: content` plus a JS fallback.

**Tech Stack:** Vanilla JS (no build), static pages, GitHub contents API.

**Spec:** `docs/superpowers/specs/2026-11-17-country-views-design.md`

## Global Constraints
- Zero dependencies; everything in `assets/desk.js` and `assets/desk.css`.
- `views.json` shape: `{ "views": { "CCY": [{ "date": "YYYY-MM-DD", "text": "..." }] } }`, newest first.
- Week's view = newest entry with `date <= monday + 4 days`. Fallback: card row `sentence`.
- Age amber when the view's date is before the week's Monday.
- Never overwrite what Nathan typed: saves go through `ghUpdate` (re-read, one change).

## Review Focus
- No `views.json` yet (404 / missing): both pages render, Scorecard shows "No view written".
- Past week selected on Scorecard: shows the view dated that week or earlier, not a later one.
- Old card with a typed `sentence` and no view: still shown, labelled as written on the scorecard.
- Save with empty text: refused with a message, nothing committed.
- Textarea already holding long text when a page draws (Today daily note, kill switch): sized to fit at once, not only after typing.

No unit-test harness exists for `desk.js` (browser-only); each task is verified in the local desk preview with `?store=local`.

---

### Task 1: Views store and helpers
**Files:** Modify `dashboard/desk/assets/desk.js` (new section before `render.scorecard`). Create `dashboard/desk/data/views.json` (seed: USD entry from `scorecard-2026-11-16.json`, date `2026-11-16`).

**Interfaces — Produces:**
- `loadViews(): Promise<{views: Record<string, {date,text}[]>}>` — `loadLive('views', true)` or `{views:{}}`.
- `viewFor(views, code, monday): {date,text} | null` — newest entry dated `<= monday+4`.
- `saveView(code, text): Promise<{data, commit}>` — `ghUpdate('views', …)`, today's date (local `ymd()`), replaces same-date entry, keeps newest first.
- `viewAge(date): string` — "today", "1 day old", "N days old".

- [ ] Implement, then in the browser console on any page: `viewFor({views:{USD:[{date:'2026-11-20',text:'b'},{date:'2026-11-12',text:'a'}]}}, 'USD', '2026-11-09')` → `null`; with `'2026-11-16'` → entry `b`.

### Task 2: Countries "My read" panel
**Files:** Modify `render.countries` in `desk.js`; styles in `desk.css`.
- Panel at the top of the selected country's detail: heading "My read", textarea `#view-text` (placeholder "Growth is __, inflation is __, labour is __, so the bank leans __."), this week's Market Context labels for that currency from the current scorecard card's `auto` (if present), Save button, status line, history list (date + text) of earlier entries.
- Save: refuses empty text; otherwise `saveView`, then redraw. Unsaved-change warning on leaving (beforeunload) when the textarea differs from the latest entry.
- [ ] Verify in preview (`?store=local`): write USD text, save, history shows it; reload keeps it.

### Task 3: Scorecard read-only view
**Files:** Modify `rowPanel` in `render.scorecard`.
- Replace the "My sentence" textarea with a `.sc-view` block: "My view · written <fmtDate> · <viewAge>" (pill `warn` when date < monday, else `flat`), text, link `countries.html#CCY` "edit on Countries →". Fallback to `r.sentence` labelled "written on the scorecard". Empty: "No view written. Write one on Countries →".
- [ ] Verify: current week shows Task 2's text with age; switch to week of Nov 9 shows nothing newer than Nov 13.

### Task 4: Auto-growing textareas
**Files:** `desk.css` (textarea rule), `desk.js` (one global helper near the top-level boot).
- CSS: `textarea { resize: none; overflow: hidden; field-sizing: content; min-height: 3.2em; }`.
- JS fallback only when `!CSS.supports('field-sizing','content')`: size `el.style.height = el.scrollHeight + 'px'` on `input` (document listener) and for textareas added to the DOM (MutationObserver on `document.body`).
- [ ] Verify: Today daily note with long text shows no scrollbar and grows on typing; same on Scorecard events, Levels, Kill Switches, Ideas, Countries.

### Task 5: Docs and commit
- README: Countries row (now holds "My read"), Scorecard row (sentence from Countries), Data table row for `views.json`.
- [ ] Commit spec, plan, code, seed.
