# my-trading-project

**In one sentence:** you describe a trading strategy in plain English, and this workspace turns it into a
real TradingView script (Pine Script) — while automatically checking whether the strategy's good performance
is real skill or just luck from historical events like COVID or a war.

This file is a complete guide to everything in this folder. No prior coding experience assumed — jargon is
explained the first time it shows up.

---

## The idea in plain English

Imagine you backtest a strategy on NVIDIA stock over the last 10 years and it looks amazing. But part of that
"amazing" result might just be because NVIDIA happened to rocket upward during the 2023 AI boom, or crashed
and recovered hard during COVID in 2020. Those were one-off historical events — not something your strategy
"predicted," just something it happened to be riding.

This workspace automatically finds those historical event windows (wars, pandemics, crashes, sudden interest
rate news, etc.) for whatever stock you're testing, and re-runs your strategy **with those windows removed**.
If the strategy still performs well without them, that's a real signal. If performance collapses once the
lucky windows are removed, you just found out your strategy was riding noise, not skill — before you risked
real money on it.

## Who does what (you vs. the computer)

- **You** are the "orchestrator" — you describe the strategy idea (what indicators, what rules, what stock
  ticker, how many years back) in plain language.
- **Claude Code** (the AI assistant you're talking to) does the research, writes the actual script, checks it
  for mistakes, and runs a first-pass test — using the tools described below.
- **TradingView** (the website/app most traders already use) is where you get the final, official, trustworthy
  results — this workspace prepares everything so that step is as smooth as possible.

## A few terms used throughout this doc

| Term | What it means here |
|---|---|
| **Pine Script** | The programming language TradingView uses for custom indicators and strategies. Files end in `.pine`. You don't need to write it yourself — the AI writes it for you. |
| **Backtest** | Running a strategy against historical price data to see how it would have performed. |
| **Skill** | A set of instructions that tells the AI assistant exactly how to do one job well (here: building a script, or reviewing one). Lives in a file, gets "loaded" automatically when relevant. |
| **Agent** (a.k.a. subagent) | Like a skill, but runs as its own separate assistant with its own focused job and its own toolbox — useful for delegating a task so it doesn't clutter your main conversation. |
| **MCP server** | A small helper program that gives the AI assistant a new capability — here, the ability to ask TradingView's own system "does this code actually compile?" |
| **Cache** | A saved copy of research results so the same question doesn't need to be looked up again every time. |

## Quick start — how you'd actually use this

Just talk to Claude Code in plain English from inside this folder, for example:

> "Build and backtest a strategy for NVDA over the last 10 years: buy when RSI crosses above 30 and price is
> above the 50-day moving average, sell when RSI crosses above 70. Exclude major macro noise."

That single request is enough to trigger the full pipeline described below. You'll get back:

1. A ready-to-use `.pine` file you can paste directly into TradingView.
2. A plain-language notes file explaining what historical events were excluded and why.
3. A first-pass sanity check of the results.
4. Clear instructions for the one manual step left — running it inside TradingView for the official numbers.

---

## Every file and folder in this workspace, explained

```
my-trading-project/
├── README.md                        ← you are here
├── .gitignore                       tells version control which files to ignore (like node_modules/)
├── .mcp.json                        turns on the "ask TradingView if this compiles" helper tool
├── package.json                     the project's settings file — lists what software tools it needs
├── pnpm-lock.yaml                   records exact versions of those tools, so setup is reproducible
├── node_modules/                    downloaded copies of those tools (auto-generated — never edit by hand)
│
├── .claude/
│   ├── skills/                      instructions the AI follows directly in this conversation
│   │   ├── strategy-rule-writer/    → saves a new reusable strategy definition (rules only, no code)
│   │   ├── strategy-builder/        → writes a new strategy script (asks: preset or custom rules?)
│   │   ├── strategy-reviewer/       → checks an existing script for mistakes
│   │   └── pine-backtest-orchestrator/  → does builder + reviewer automatically, back to back
│   └── agents/                      the same jobs, as separate delegatable mini-assistants
│       ├── event-researcher.md      → finds historical events for a stock
│       ├── pine-builder.md          → writes the script (also asks: preset or custom rules?)
│       ├── pine-reviewer.md         → checks the script
│       └── pine-backtester.md       → actually runs a first-pass test of the script
│
├── strategy-rules/                  reusable strategy definitions — describe a rule once, reuse it by name
│   ├── README.md                    how this folder works and how new entries get picked up
│   ├── _TEMPLATE.md                 copy this to start a new one
│   └── <your-strategy-name>.md      one file per saved strategy (starts empty — none pre-seeded)
│
├── scripts/
│   └── pinets-sanity-check.mjs      a small program that does the first-pass test mentioned above
│
├── pine/                            every strategy script ever generated lands here
│   └── <strategy-name>/
│       ├── v1.pine, v2.pine, ...    the actual TradingView-ready files (never overwritten, only added to)
│       └── notes.md                 plain-language summary: what it does, what was excluded, and why
│
├── data/
│   ├── events/                      one file per stock ticker: the historical "noisy" date ranges found
│   │   └── <TICKER>.json
│   └── research/                    the detailed research notes behind each entry in events/
│
└── docs/                            reserved for longer write-ups later — empty for now
```

A short version, if you only remember one thing about each: **`.claude/`** holds the AI's instructions,
**`strategy-rules/`** holds strategies worth reusing, **`pine/`** holds your finished strategy scripts,
**`data/`** holds the cached research, everything else (`package.json`, `node_modules/`, `pnpm-lock.yaml`,
`.mcp.json`) is plumbing that makes the tools work and can be safely ignored day to day.

## Reusing a strategy instead of redescribing it every time

The first time you describe a strategy in detail, you can ask to have it saved (`strategy-rule-writer`
handles this) as a file under `strategy-rules/`. From then on, whenever a strategy needs to be built,
`strategy-builder` will always ask first: **pick one of your saved strategies, or describe a custom one this
time?** — it lists whatever's already saved so you don't have to remember exact names. See
`strategy-rules/README.md` for the file format if you want to write one by hand instead.

---

## The problem this solves, in more detail

A strategy backtest over 10 years of data mixes real signal with noise from things that can't be traded on
systematically — wars, pandemics, crash liquidity events, sudden monetary-policy shocks. A strategy that
"backtests well" only because it caught the COVID recovery or an AI-boom melt-up isn't a strategy, it's
survivorship on one lucky window. This workspace's core design goal is to make that distinction visible: every
generated strategy runs in **two modes** — raw (every historical bar, i.e. every single day/candle of price
data) and clean (macro/news event windows excluded from trade entries) — so you can see whether performance
survives with the noise removed.

## Full pipeline, end to end

This is what happens, step by step, after you describe a strategy:

```
 you: "build me a strategy for NVDA, 10 years, momentum + volume, filter out macro noise"
   │
   ▼
 pine-backtest-orchestrator (the default thing that runs — chains everything below automatically)
   │
   ├─▶ STEP 1 — strategy-builder (writes the script)
   │     │
   │     ├─ a. check data/events/<TICKER>.json — have we already researched this stock's history?
   │     │      if not (or it's out of date) → search the web for what really happened
   │     │      (e.g. "NVDA blew up — was that the 2020 gaming/COVID demand spike, the
   │     │      2022 crypto-mining/gaming drawdown, or the 2023 AI boom?" — attributed
   │     │      to the real cause, not just tagged "COVID" because the year matches)
   │     │      → save the answer to data/events/<TICKER>.json so it's never re-researched
   │     │
   │     ├─ b. write the actual Pine Script v6 code, following TradingView's best practices
   │     │      - includes a toggle: "exclude the noisy historical windows, yes/no"
   │     │      - tracks performance both ways at the same time, so nothing needs re-running twice
   │     │      - includes the standard performance stats every trader expects: profit/loss,
   │     │        win rate, number of trades, worst drawdown, an equity curve chart
   │     │
   │     └─ c. save the file to pine/<strategy-name>/v1.pine, plus a notes.md explaining it all
   │
   ├─▶ STEP 2 — strategy-reviewer (checks the script for mistakes before you trust it)
   │     │
   │     ├─ a. ask TradingView's own system: "does this code actually compile?" (catches real errors)
   │     ├─ b. check it follows good coding practice (no code that would silently misbehave)
   │     └─ c. double-check the "exclude noisy windows" logic is wired up correctly
   │
   ├─▶ STEP 3 — pine-backtester (a first-pass test run, before you go to TradingView)
   │     │
   │     ├─ a. run the script through a local test tool to catch obvious problems early
   │     ├─ b. compare the "with noise" vs "without noise" results from that test run
   │     └─ c. write those results into the notes.md file, dated, so history builds up over time
   │
   ├─▶ if the checker found real problems: fix them automatically and re-check
   │     (tries up to 2 times — if still broken after that, it stops and asks you, because at
   │      that point it's usually a decision about the strategy logic, not a typo to fix)
   │
   └─▶ you get: the finished file, a plain-language explanation of what was excluded and why,
       a first-pass result, and clear next steps for the one thing that still needs TradingView
```

## Where "skills" and "agents" fit into that pipeline

Both do the exact same 4 jobs — research, build, review, test — just packaged two different ways:

| | Skills (`.claude/skills/`) | Agents (`.claude/agents/`) |
|---|---|---|
| What it is | Instructions the assistant follows right in this conversation | A separate mini-assistant with its own focused job |
| When it's used | By default, for the normal end-to-end flow | When you want to delegate one specific piece on its own |
| Example | "Build and backtest a strategy for NVDA" | "Have `pine-backtester` re-run the strategy we already built" |

**Skills available:**

| Skill | What it's for |
|---|---|
| `strategy-rule-writer` | Saves a trading idea as a reusable file under `strategy-rules/` — rules only, no Pine code. Use this to build up your library of go-to strategies. |
| `strategy-builder` | Writes one new `.pine` strategy file. Always asks first: use one of your saved `strategy-rules/` presets, or describe something custom this time? |
| `strategy-reviewer` | Checks an existing `.pine` file for mistakes — real compile errors plus best-practice issues. |
| `pine-backtest-orchestrator` | **The default.** Runs builder, then reviewer, then fixes anything broken automatically. Use this unless you specifically want just one step. |

**Agents available** (same jobs, as standalone delegatable helpers):

| Agent | What it's for |
|---|---|
| `event-researcher` | Finds and saves the historical "noisy" date ranges for a given stock ticker. |
| `pine-builder` | Writes or edits the `.pine` script itself. |
| `pine-reviewer` | Checks a script for mistakes — read-only, doesn't fix anything itself. |
| `pine-backtester` | **The one that actually runs a test of the strategy.** Compares "with noise" vs "without noise" results from a real run of the code, and explains what that comparison means. Reach for this specifically when you say "backtest this" about a strategy that already exists. |

---

## How the historical-event research gets saved and reused (the "cache")

Every stock ticker gets its own saved file: `data/events/<TICKER>.json` (colons and slashes in the ticker
name get replaced with underscores, so `NASDAQ:NVDA` becomes the file `NASDAQ_NVDA.json`). It looks like this:

```json
{
  "ticker": "NASDAQ:NVDA",
  "generated_at": "2026-07-18",
  "events": [
    {
      "start": "2020-02-20",
      "end": "2020-04-07",
      "label": "COVID crash",
      "category": "pandemic-macro",
      "rationale": "Broad market liquidity crisis, not company-specific signal",
      "confidence": "high",
      "sources": ["https://..."]
    }
  ]
}
```

In plain terms: for each "noisy" period found, it records when it started and ended, a short label, what
category of event it was, why it doesn't reflect the strategy's own skill, how confident the research is, and
where that information came from.

Rules this research step follows:

- **Reuse what's already saved, always.** If a stock's history has already been researched and covers the
  period you're asking about, it's reused instantly instead of researching again. Anything about the last 2
  years gets refreshed after 90 days (recent events sometimes get reinterpreted as more information comes
  out); anything older than 2 years is considered settled and is never re-researched.
- **The cause is verified, not guessed from the calendar.** A 2020 dip isn't automatically labeled "COVID" —
  the research checks what actually moved that specific stock (a pandemic-driven demand spike is different
  from a company-specific earnings miss that happened to land the same year).
- **Windows are kept tight** — days to a few weeks, not entire years — so the "clean" version of the backtest
  doesn't lose more real trading history than necessary.
- The categories used are: `pandemic-macro`, `war-geopolitical`, `monetary-policy`, `earnings-shock`,
  `sector-rotation`, `liquidity-crisis`, `other`.
- The full research notes behind each entry (search results, reasoning) are kept separately in
  `data/research/`, so the main `data/events/` file stays short and easy to read.

## Backtesting — what actually happens, and what still needs TradingView

Important honesty check: **there is no official way to run a real TradingView backtest outside of
TradingView itself.** This workspace does not pretend otherwise, and it's built around that limitation rather
than hiding it. There are three layers here, in order of how much you should trust each one:

1. **The compile checker** — asks TradingView's own systems "does this code actually work?" and gets back a
   real, accurate answer (down to the exact line of any mistake). This is fully trustworthy for catching
   broken code. It runs automatically with no extra setup or login needed.
2. **The first-pass test run** (`pine-backtester` / `scripts/pinets-sanity-check.mjs`) — runs the strategy on
   a computer here (not on TradingView) using an independent, open-source tool that understands Pine Script.
   It's useful for catching obvious problems early and getting a rough sense of the "with noise" vs "without
   noise" comparison — but it's a newer tool and its results can occasionally differ slightly from what
   TradingView itself would show, especially for the newest Pine Script version. Treat it as a helpful preview,
   not the final answer.
3. **TradingView itself (the real, official test)** — paste the finished script into TradingView, run it once
   with the "exclude noisy windows" toggle on, and once with it off, and compare the results side by side.
   **This comparison is the actual point of this whole project** — if turning the toggle on makes the good
   results disappear, the strategy was leaning on lucky historical timing rather than a repeatable edge.

Nothing in steps 1–2 replaces step 3. Every skill and agent in this workspace is written to keep reminding you
of that, rather than let an early "looks good" reading get mistaken for a real result.

---

## What's installed on this computer, and why (for reference)

To make all of the above work, a few free tools were installed system-wide this session. Nothing existing on
your computer was changed or removed — these were clean additions:

- **Node.js** and **pnpm** — the runtime and package manager needed to run the first-pass test script.
- **Python** and **pip** — needed for the compile-checker tool.
- **`pinescript-syntax-checker`** — the compile-checker tool itself (layer 1 above). No login or account
  needed; it talks to TradingView's public systems anonymously.
- **`pinets`** — the first-pass test tool (layer 2 above), an open-source project that can run Pine Script
  code on this computer instead of inside TradingView.

## Where these patterns came from (credit + reference)

Before writing anything, existing open-source projects were researched so this workspace wouldn't reinvent
things that already exist:

- **[TradersPost/pinescript-agents](https://github.com/TradersPost/pinescript-agents)** — an existing project
  with a very similar builder/reviewer/orchestrator structure. Its coding checklist (best practices for the
  latest Pine Script version, required safety checks, standard performance stats) was adapted into the
  `strategy-builder` and `strategy-reviewer` instructions here.
- **[LuxAlgo/PineTS](https://github.com/LuxAlgo/PineTS)** — the open-source tool used for the first-pass test
  run (layer 2 above). Its license (AGPL-3.0) is fine for using it privately like this; it would only matter
  if this workspace were ever turned into a public online service.
- **[erevus-cn/pinescript_syntax_checker](https://github.com/erevus-cn/pinescript_syntax_checker)** — the
  compile-checker tool (layer 1 above).

Also checked and specifically **not** relied on: a page called `skills.rest/skill/pinescript` (couldn't be
verified — the page blocked automated access); a package literally named `pine-lint` (turned out not to
exist — the compile-checker above is the real equivalent); a general resource list called
`awesome-pinescript` (skimmed for any existing "exclude historical noise" backtesting idea — found none,
meaning the core idea of this whole workspace is original, not copied from somewhere).

## Key decisions made while building this, and why

- **This folder's location and setup**: kept separate from the rest of your Windows user folder, with version
  control (git) turned on, so every change to a strategy or to the AI's instructions is tracked over time.
- **Latest Pine Script version (v6)** used throughout, since that's what TradingView's editor uses by default
  now.
- **The "exclude noisy windows" toggle only blocks new trades, never closes existing ones** — a strategy
  should always be allowed to exit a position it's already in, even during a flagged event, since forcing it
  to stay in a trade would be unrealistic and no real trader would accept that.
- **Research is reused, not repeated**, to keep things fast — with a 90-day refresh window for recent events,
  since how a very recent event gets understood can still change shortly after it happens.
- **Automatic fixing stops after 2 tries**, so the process doesn't loop forever — if a script still has
  problems after 2 fix attempts, that usually means a decision about the strategy's actual logic, which only
  you can make.
