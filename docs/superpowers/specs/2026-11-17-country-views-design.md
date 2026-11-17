# Country views on Countries, shown on the Scorecard — design (small change)

Approved by Nathan 2026-11-17.

## Intent
The Scorecard should be a page Nathan reads to compare currencies and pick pairs, not a page he types into.
First step: his per-currency view ("my sentence") is written on the Countries page and shows on the Scorecard.
Weeks without an update are fine; the Scorecard marks how old the view is.

Also: text boxes on every desk page grow with their text instead of scrolling.

## Goals
- Countries page: "My read" box per country, saved with a date; earlier entries kept as a history list.
- Scorecard: sentence shown read-only with its date and age, link to edit on Countries.
- History stays honest: each week's card shows the view in force that week.
- All textareas auto-grow, no inner scrollbar.

## Non-goals
- Moving the other Scorecard inputs (priced 12m, week's change, call, strong, crowded). Later, maybe.
- Logging individual economic data points on Countries. Later, maybe.

## Approaches
1. **Separate `data/views.json` with dated history per currency (picked).** Own file, own commits; weekly view
   resolved by date.
2. Inside `countries.json`: rejected, that file is hand-written yearly reference and would clash with refreshes.
3. Keep it on each weekly scorecard: rejected, a week without an update would show blank, and it is the thing being
   moved away from.

## Design
- `data/views.json`: `{ views: { CCY: [{ date: 'YYYY-MM-DD', text }] } }`, newest first. Saved through `ghUpdate`
  (or local test mode). A save on a day that already has an entry replaces it; empty text is not saved.
- View for a scorecard week = newest entry dated on or before that week's Friday (monday + 4). For the running week
  this is the latest view. Fallback for old cards: the card's own `sentence`, labelled "written on the scorecard".
- Scorecard card: textarea replaced by a read-only block: "My view · written <date> · N days old", amber when the
  date is before the week's Monday; "No view written" with a link otherwise. Link: `countries.html#CCY`.
- Countries detail: "My read" panel at the top of the selected country: textarea with the template placeholder, this
  week's Market Context labels for that currency (from the current scorecard card's `auto`), Save button, history list.
- Seed: this week's USD sentence copied into `views.json` dated from the card.
- Auto-grow: CSS `field-sizing: content` where supported; otherwise a small script sizes each textarea to its
  `scrollHeight` on input and when it appears. `resize: none; overflow: hidden`. `rows` stays as the minimum.

## Left to the builder
Exact styling, wording of empty states, the age threshold wording.
