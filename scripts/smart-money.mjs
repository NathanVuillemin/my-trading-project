#!/usr/bin/env node
// smart-money.mjs — aggregate every connector into a cross-venue smart-money read.
//
// Two views, both always computed:
//   1. COMPOSITE — weighted score per asset. Sources weighted by reliability
//      (per-wallet whale flow > top-trader ratios > market structure).
//   2. UNION — every source's read per asset, side by side, tagged. No weighting;
//      you eyeball agreement yourself.
//
// Signal kinds:
//   smart = whales / top traders. Followed directly.
//   crowd = funding, retail L/S, taker flow. Often CONTRARIAN — crowded longs mean
//           liquidity resting below. --invert-crowd flips them into the composite.
//
// Usage:
//   node scripts/smart-money.mjs                    # composite + union, default assets
//   node scripts/smart-money.mjs --assets BTC,ETH   # restrict universe
//   node scripts/smart-money.mjs --invert-crowd     # treat crowd positioning as contrarian
//   node scripts/smart-money.mjs --min-sources 3    # only assets confirmed by N+ sources
//   node scripts/smart-money.mjs --json             # machine-readable (for the dashboard)
//
// Data notes:
//   - Hyperliquid tier reads the newest data/whale-flow snapshot — run `npm run whale:flow` first.
//   - Key-gated sources (coinglass, dune) self-skip unless their env vars are set.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAll, DEFAULT_ASSETS, CONNECTORS } from './connectors.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dir, '..', 'data', 'smart-money');

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
};
const has = (name) => process.argv.includes(`--${name}`);

const fmtScore = (s) => (s >= 0 ? '+' : '') + s.toFixed(2);
const bar = (s) => {
  const n = Math.round(Math.abs(s) * 10);
  return (s >= 0 ? '▲' : '▼').repeat(Math.max(1, n)).padEnd(10);
};
const label = (s) => s > 0.35 ? 'BULLISH' : s < -0.35 ? 'BEARISH' : 'NEUTRAL';

(async () => {
  const assets = String(arg('assets', DEFAULT_ASSETS.join(','))).split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  const invertCrowd = has('invert-crowd');
  const minSources = Number(arg('min-sources', 1));
  const asJson = has('json');
  const log = (...a) => { if (!asJson) console.log(...a); };

  log(`Querying ${CONNECTORS.length} connectors for ${assets.length} assets...`);
  const { signals, warns, coverage } = await runAll(assets);

  // ---- group by asset ----
  const byAsset = {};
  for (const s of signals) {
    if (!assets.includes(s.asset)) continue;         // keep the universe tight
    (byAsset[s.asset] ||= []).push(s);
  }

  // ---- COMPOSITE ----
  const composite = Object.entries(byAsset).map(([asset, sigs]) => {
    let num = 0, den = 0;
    for (const s of sigs) {
      const dir = (s.kind === 'crowd' && invertCrowd) ? -1 : 1;
      num += s.score * s.weight * dir;
      den += s.weight;
    }
    const score = den ? num / den : 0;
    const smart = sigs.filter(s => s.kind === 'smart');
    const smartScore = smart.length
      ? smart.reduce((a, s) => a + s.score * s.weight, 0) / smart.reduce((a, s) => a + s.weight, 0)
      : null;
    const bulls = sigs.filter(s => s.score > 0.05).length;
    const bears = sigs.filter(s => s.score < -0.05).length;
    return {
      asset, cls: sigs[0].cls, score, smartScore,
      sources: sigs.length, bulls, bears,
      // every source agrees in sign AND we have enough of them
      agreement: sigs.length > 1 && (bulls === 0 || bears === 0),
      sigs,
    };
  })
    .filter(a => a.sources >= minSources)
    .sort((a, b) => Math.abs(b.score) - Math.abs(a.score));

  const payload = {
    generatedAt: new Date().toISOString(),
    invertCrowd, minSources,
    connectors: CONNECTORS.map(c => ({ id: c.id, weight: c.weight, kind: c.kind, note: c.note })),
    coverage,
    warns,
    composite: composite.map(({ sigs, ...rest }) => ({
      ...rest,
      union: sigs.map(s => ({ source: s.source, kind: s.kind, tier: s.tier, score: +s.score.toFixed(3), detail: s.detail })),
    })),
  };

  if (!has('no-write')) {
    mkdirSync(OUT_DIR, { recursive: true });
    const p = join(OUT_DIR, `${new Date().toISOString().slice(0, 10)}.json`);
    writeFileSync(p, JSON.stringify(payload, null, 2));
    log(`\nSnapshot written: ${p}`);
  }

  if (asJson) { process.stdout.write(JSON.stringify(payload)); return; }

  // ---- report ----
  const line = '─'.repeat(74);
  const cov = coverage.smartPct >= 60 ? '' : `  ⚠ DEGRADED — ${coverage.smartPct}% smart coverage`;
  console.log(`\n${line}\nSMART MONEY COMPOSITE${invertCrowd ? '  (crowd inverted = contrarian)' : ''}${cov}\n${line}`);
  console.log(`Sources live: ${coverage.live.join(', ') || 'none'}`
    + (coverage.missing.length ? `   |   MISSING: ${coverage.missing.join(', ')}` : '')
    + `\nSmart-tier weight present: ${coverage.smartPresent.toFixed(1)}/${coverage.smartExpected.toFixed(1)} (${coverage.smartPct}%)`);
  console.log('asset      composite            smart-only  sources  agree');
  for (const a of composite) {
    console.log(
      `${a.asset.padEnd(9)} ${bar(a.score)} ${fmtScore(a.score).padStart(6)}  `
      + `${(a.smartScore == null ? '  n/a' : fmtScore(a.smartScore)).padStart(7)}   `
      + `${String(a.sources).padStart(5)}   ${a.agreement ? '✓ ALL' : `${a.bulls}L/${a.bears}S`}  ${label(a.score)}`);
  }

  console.log(`\n${line}\nUNION — every source, tagged\n${line}`);
  for (const a of composite) {
    console.log(`\n${a.asset}  [${a.cls}]  composite ${fmtScore(a.score)}`);
    for (const s of a.sigs.sort((x, y) => y.weight - x.weight)) {
      const kindTag = s.kind === 'smart' ? '🧠smart' : '👥crowd';
      console.log(`   ${kindTag} ${s.source.padEnd(14)} T${s.tier} w${s.weight.toFixed(1)}  ${fmtScore(s.score).padStart(6)}  ${s.detail}`);
    }
  }

  if (warns.length) {
    console.log(`\n${line}\nSOURCE NOTES`);
    for (const w of warns) console.log(`  ! ${w}`);
  }
  console.log(line);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
