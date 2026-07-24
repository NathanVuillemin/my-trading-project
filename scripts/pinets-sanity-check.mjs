// Headless sanity check for a .pine strategy file using PineTS (npm: pinets).
// NOT authoritative — PineTS v6 strategy() support is experimental (per LuxAlgo/PineTS README).
// This only confirms the script parses and runs without throwing, and produces a rough
// equity shape. Final numbers must come from TradingView's own Strategy Tester.
//
// Usage: node scripts/pinets-sanity-check.mjs <path-to-file.pine> <symbol> <from> <to>
// Example: node scripts/pinets-sanity-check.mjs pine/nvda-momentum/v1.pine NASDAQ:NVDA 2016-01-01 2026-01-01

import { readFileSync } from 'node:fs';
import { PineTS } from 'pinets';

const [, , filePath, symbol = 'NASDAQ:AAPL', from = '2020-01-01', to = '2026-01-01'] = process.argv;

if (!filePath) {
  console.error('Usage: node scripts/pinets-sanity-check.mjs <file.pine> [symbol] [from] [to]');
  process.exit(1);
}

const source = readFileSync(filePath, 'utf8');

try {
  const pinets = new PineTS(source, symbol, '1D', new Date(from), new Date(to));
  const result = await pinets.run();
  console.log(`[sanity-check] ${filePath} ran without throwing.`);

  // strategy-builder emits plot() series named exactly "Raw Equity (all bars)" and
  // "Clean Equity (event-excluded)" so both can be read from a single run — see
  // .claude/skills/strategy-builder/SKILL.md Step 3. PineTS's exact result shape for named
  // plots hasn't been hand-verified against a real generated strategy yet; if the lookup
  // below comes back empty, inspect `result` directly and adjust the key names/paths here
  // rather than assuming the script itself is broken.
  const plots = result?.plots ?? {};
  const raw = plots['Raw Equity (all bars)'];
  const clean = plots['Clean Equity (event-excluded)'];

  if (raw && clean) {
    const rawFinal = Array.isArray(raw) ? raw.at(-1) : raw;
    const cleanFinal = Array.isArray(clean) ? clean.at(-1) : clean;
    console.log(`[sanity-check] raw equity (final):   ${rawFinal}`);
    console.log(`[sanity-check] clean equity (final):  ${cleanFinal}`);
    console.log(`[sanity-check] gap (raw - clean):     ${rawFinal - cleanFinal}`);
    console.log('[sanity-check] a large gap means performance leans on event-window bars — noise, not durable signal.');
  } else {
    console.log('[sanity-check] could not find rawEquity/cleanEquity plot series — script may predate the dual-plot convention, or PineTS names plots differently than expected. Inspect manually.');
  }

  console.log('[sanity-check] REMINDER: this is a parity-limited sanity check, not the real backtest. Confirm final numbers in TradingView (run both excludeEventWindows = true/false there too).');
} catch (err) {
  console.error(`[sanity-check] FAILED to run ${filePath}:`);
  console.error(err.message ?? err);
  process.exit(1);
}
