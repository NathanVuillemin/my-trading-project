# 25 · AI × Macro — tokens and building macro models with an LLM
Condensed summary in my own words. `[Claude+]` = my additions.

## Core points
- **Tokens** are the unit models read, write and bill in (~4 characters of English prose each). **Numbers fragment into many tokens**, so raw time series are the most expensive input.
- **Two meters**: input and output; output costs ~5× more. The course quotes mid-2026 tier prices per million tokens of roughly $1/$5 (Haiku), $3/$15 (Sonnet), $5/$25 (Opus) and $10/$50 (a flagship tier). Check current pricing. Context windows are large (~1M), but every token costs money on every call, and models reason better on dense signal than raw dumps.
- **Match the tier to the job**: small models for classification, mid for daily briefs/regime scoring, frontier for synthesis/stress-tests; batch mode (~50% off) for anything that can wait.
- **Format matters**: one year of daily 10y yields ≈ ~8k tokens as JSON, ~2.5k as compact CSV, ~200 as a derived summary. **Compute in code, reason in the model**: models read a z-score well but make arithmetic slips computing one from 252 numbers.
- **Compression playbook**: send features (level, RoC, z-score, percentile, regime flag) not series; resample to the decision frequency; round hard; summary + short recent window; CSV over JSON; send only deltas on daily runs. Use the token-count endpoint to measure.
- **Prompt caching**: stable prefix (framework) read at ~0.1× price after a ~1.25× write. It's a prefix match, so **never put dates/timestamps at the top**. Freeze the framework; append volatile data at the end.
- **Good call anatomy**: (1) cached system/framework, (2) compact context, (3) one precise task, (4) enforced JSON schema. **Always require a falsifier field.**
- **Control output**: forbid restating the input, prefer JSON to prose, set max tokens and effort level, summarise once and reuse.
- **Patterns**: Daily Brief (prose), Regime Classifier (small model, JSON, on every print), Attribution Engine (then vs now), Thesis Stress-Tester (frontier model, weekly).
- Never ask a model to *recall* market data; always send it.

> `[Claude+]` **Direct application to your setup**: your Macro Tracker (v5) is the "compute in code" layer. Next step would be a sheet/tab that outputs one compact feature row per currency + gold (level, 1m change, z-score, impulse sign, surprise z-score), which is exactly the payload to paste into a chat or feed to an automated regime classifier. I can help build that tab and a frozen framework prompt that includes your four-layer gate, and add a required "falsifier" field to every bias call.

## Self-test
1. Why are numbers expensive in tokens?
2. What does "compute in code, reason in the model" mean?
3. How do you avoid breaking the prompt cache?
4. List the four layers of a good macro model call.
5. Why require a falsifier field?
6. Which model tier for (a) classifying each CPI print, (b) a weekly thesis stress-test?
