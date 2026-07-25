#!/usr/bin/env node
// health.mjs — one command that answers "is any of this data actually trustworthy right now?"
//
// Every collector is non-fatal in CI, which is the right call (one dead API should not cost
// the other five feeds) but it means a run goes green whether the data is good or not. Feeds
// can also degrade *without* failing: a throttled API returns empty rather than erroring, a
// geo-blocked source drops out of a composite, a baseline is too short for its own z-scores.
// This inspects what actually landed on disk and reports staleness plus quality.
//
// Usage:
//   node scripts/health.mjs            # report
//   node scripts/health.mjs --json
//   node scripts/health.mjs --strict   # exit 1 if anything is ERROR (for CI gating)
//
// Adds nothing to the pipeline and changes no other file — read-only diagnostics.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');
const DATA = join(ROOT, 'data');

const has = (n) => process.argv.includes(`--${n}`);
const DAY = 864e5;
const daysOld = (d) => Math.floor((Date.now() - new Date(d + 'T00:00:00Z').getTime()) / DAY);

// OK / WARN / ERROR, plus a human reason. Staleness thresholds differ per feed because
// their sources update at different cadences — COT is weekly, Form 4 is per business day.
const FEEDS = {
  'whale-flow': { staleWarn: 2, staleErr: 4, check: (d) => {
    const out = [];
    const wallets = d.wallets_with_fills ?? 0;
    if (!wallets) out.push(['ERROR', 'no wallets returned fills']);
    else if (wallets < 40) out.push(['WARN', `only ${wallets} wallets had fills`]);
    if (!(d.coins || []).length) out.push(['ERROR', 'no coins in snapshot']);
    const flags = (d.flags?.coinFlags || []).length;
    const cold = (d.flags?.coinFlags || []).some(f => f.z == null);
    if (cold) out.push(['WARN', 'baseline still cold — flags are $-floor only, z-scores not active yet']);
    out.push(['INFO', `${(d.coins || []).length} markets, ${flags} flagged`]);
    return out;
  }},
  'smart-money': { staleWarn: 2, staleErr: 4, check: (d) => {
    const out = [];
    const c = d.coverage;
    if (!c) { out.push(['WARN', 'no coverage block — older snapshot format']); return out; }

    // Why a source is absent matters more than how many are absent. Three cases behave
    // very differently, and collapsing them into one ERROR means the check screams daily
    // about something unfixable and stops being read.
    //
    //   geo-blocked  — the venue refuses datacentre IPs (Binance 451, Bybit 403 from
    //                  GitHub runners). Permanent for this environment, not a regression.
    //   needs a key  — connector self-skipped. Actionable, but a choice, not a fault.
    //   unexplained  — present yesterday, gone today with no reason given. THIS is the
    //                  one worth an ERROR.
    const warns = d.warns || [];
    const reasonFor = (id) => warns.find(w => w.startsWith(id + ':')) || '';
    const geo = [], keyed = [], unexplained = [];
    for (const id of (c.missing || [])) {
      const r = reasonFor(id);
      if (/HTTP (451|403)/.test(r)) geo.push(id);
      else if (/skipped \(set /.test(r)) keyed.push(id);
      else unexplained.push(id);
    }

    if (geo.length) out.push(['WARN', `geo-blocked in this environment (expected, not a regression): ${geo.join(', ')}`]);
    if (keyed.length) out.push(['WARN', `awaiting API keys: ${keyed.join(', ')}`]);
    if (unexplained.length) out.push(['ERROR', `source vanished with no reason given: ${unexplained.join(', ')}`]);

    // Coverage still matters even when every absence is explained — the composite means
    // something different at 53% than at 100%, and that has to stay visible.
    if (c.smartPct < 40) out.push(['ERROR', `only ${c.smartPct}% of smart-tier weight present — composite is mostly crowd data`]);
    else if (c.smartPct < 100) out.push(['INFO', `${c.smartPct}% smart-tier coverage — reads are directionally usable but thinner than designed`]);
    else out.push(['INFO', 'full smart-tier coverage']);

    if (!(d.composite || []).length) out.push(['ERROR', 'empty composite']);
    return out;
  }},
  trust: { staleWarn: 3, staleErr: 7, check: (d) => {
    const out = [];
    const w = d.wallets || [];
    if (!w.length) return [['ERROR', 'no wallets scored']];
    // The tell for throttling: userFills comes back empty, so nothing has round-trip evidence
    // and confidence collapses. A healthy run has a spread of bases.
    const byBasis = w.reduce((a, x) => (a[x.sampleBasis] = (a[x.sampleBasis] || 0) + 1, a), {});
    const weakest = (byBasis.markets || 0) / w.length;
    const avgConf = w.reduce((s, x) => s + (x.confidence || 0), 0) / w.length;
    if (weakest > 0.9) out.push(['ERROR', `${Math.round(weakest * 100)}% of wallets on weakest evidence basis — likely rate-limited during collection`]);
    else if (weakest > 0.6) out.push(['WARN', `${Math.round(weakest * 100)}% of wallets on weakest evidence basis`]);
    if (avgConf < 0.5) out.push(['WARN', `mean confidence ${avgConf.toFixed(2)} — scores rest on thin evidence`]);
    out.push(['INFO', `${w.length} scored, mean confidence ${avgConf.toFixed(2)}, bases: ${Object.entries(byBasis).map(([k, v]) => k + ' ' + v).join(', ')}`]);
    return out;
  }},
  portfolio: { staleWarn: 2, staleErr: 4, check: (d) => {
    // DATA-quality checks only. Trade risk (near-liquidation etc.) is real and important,
    // but it is a different axis — it must not drive the data-health verdict, or a green
    // pipeline reads ERROR simply because a leveraged position is open, and the ERROR
    // stops meaning "the data broke". Position risk is surfaced separately (see the banner).
    const out = [];
    if (d.usingPlaceholder) out.push(['WARN', 'still tracking the PLACEHOLDER address — edit config/portfolio.json to use your own']);
    if (!(d.positions || []).length) out.push(['INFO', 'no open positions']);
    out.push(['INFO', `${(d.positions || []).length} positions, ${d.trades?.tradeCount ?? 0} completed round trips`]);
    return out;
  }},
  insiders: { staleWarn: 4, staleErr: 8, check: (d) => {
    const out = [];
    if (!d.filingsParsed) out.push(['ERROR', 'no filings parsed — SEC may be blocking or rate-limiting']);
    if (d.filingsFailed > d.filingsParsed * 0.2) out.push(['WARN', `${d.filingsFailed} filings failed to parse`]);
    const p = d.codeCensus?.P || 0;
    if (!p) out.push(['WARN', 'no open-market purchases (code P) in window — normal on quiet days, but check the window length']);
    out.push(['INFO', `${d.filingsParsed} filings, ${d.counts?.buys ?? 0} buys, ${(d.clusters || []).length} clusters`]);
    return out;
  }},
  'macro-pulse': { staleWarn: 2, staleErr: 4, check: (d) => {
    const out = [];
    if (!d.stablecoins) out.push(['WARN', 'stablecoins section missing']);
    if (!(d.options || []).length) out.push(['WARN', 'options section missing']);
    if (!d.sentiment) out.push(['WARN', 'sentiment section missing']);
    for (const w of (d.warns || [])) out.push(['WARN', w]);
    if (d.stablecoins) out.push(['INFO', `stablecoins $${(d.stablecoins.totalUsd / 1e9).toFixed(0)}B, ${d.stablecoins.weekChangeUsd >= 0 ? 'expanding' : 'contracting'}; F&G ${d.sentiment?.fngValue ?? '?'}`]);
    return out;
  }},
  'macro-flows': { staleWarn: 8, staleErr: 15, check: (d) => {
    const out = [];
    if (!(d.cot || []).length) out.push(['ERROR', 'no COT markets']);
    if (!(d.flows || []).length) out.push(['WARN', 'no exchange-flow rows']);
    // COT is published weekly on a lag; a stale report date is expected, a very old one is not.
    const rep = (d.cot || [])[0]?.date;
    if (rep) {
      const age = daysOld(rep);
      if (age > 12) out.push(['WARN', `latest COT report is ${age}d old (${rep})`]);
      else out.push(['INFO', `COT report date ${rep} (${age}d old — weekly release, lag is normal)`]);
    }
    for (const w of (d.warns || [])) out.push(['WARN', w]);
    out.push(['INFO', `${(d.cot || []).length} markets, ${(d.convictionExtremes || []).length} conviction extremes`]);
    return out;
  }},
};

const results = [];
let positionRisk = [];   // trade risk, tracked separately from the data verdict
for (const [feed, spec] of Object.entries(FEEDS)) {
  const dir = join(DATA, feed);
  if (!existsSync(dir)) { results.push({ feed, level: 'ERROR', date: null, notes: [['ERROR', 'directory missing — collector never ran']] }); continue; }
  const files = readdirSync(dir).filter(f => f.endsWith('.json')).sort();
  if (!files.length) { results.push({ feed, level: 'ERROR', date: null, notes: [['ERROR', 'no snapshots']] }); continue; }

  const latest = files[files.length - 1];
  const date = latest.replace(/\.json$/, '');
  const age = daysOld(date);
  let data;
  try { data = JSON.parse(readFileSync(join(dir, latest), 'utf8')); }
  catch (e) { results.push({ feed, level: 'ERROR', date, notes: [['ERROR', `unparseable JSON: ${e.message}`]] }); continue; }

  if (feed === 'portfolio') positionRisk = data.risk?.alerts || [];

  const notes = [];
  if (age >= spec.staleErr) notes.push(['ERROR', `stale: ${age}d old`]);
  else if (age >= spec.staleWarn) notes.push(['WARN', `${age}d old`]);
  try { notes.push(...spec.check(data)); }
  catch (e) { notes.push(['ERROR', `health check threw: ${e.message}`]); }

  const level = notes.some(n => n[0] === 'ERROR') ? 'ERROR'
    : notes.some(n => n[0] === 'WARN') ? 'WARN' : 'OK';
  results.push({ feed, level, date, age, snapshots: files.length, notes });
}

// Dashboard freshness relative to the newest snapshot it should be showing.
const dash = join(ROOT, 'dashboard', 'index.html');
let dashNote = null;
if (!existsSync(dash)) dashNote = ['ERROR', 'dashboard/index.html missing — run npm run dashboard'];
else {
  const built = statSync(dash).mtimeMs;
  const newestData = results.filter(r => r.date).map(r => {
    const p = join(DATA, r.feed, r.date + '.json');
    try { return statSync(p).mtimeMs; } catch { return 0; }
  });
  const newest = Math.max(0, ...newestData);
  if (newest > built) dashNote = ['WARN', 'dashboard is older than the newest snapshot — run npm run dashboard'];
  else dashNote = ['OK', 'dashboard newer than all snapshots'];
}

const worst = results.some(r => r.level === 'ERROR') || dashNote[0] === 'ERROR' ? 'ERROR'
  : results.some(r => r.level === 'WARN') || dashNote[0] === 'WARN' ? 'WARN' : 'OK';

if (has('json')) {
  process.stdout.write(JSON.stringify({ overall: worst, positionRisk, dashboard: dashNote, feeds: results }, null, 2));
} else {
  const line = '─'.repeat(78);
  const mark = { OK: 'OK   ', WARN: 'WARN ', ERROR: 'ERROR', INFO: '     ' };
  console.log(`\n${line}\nSYSTEM HEALTH — overall ${worst}   (data quality only)\n${line}`);
  // Position risk is your money, not the data — printed loud and first, but it never
  // sets the data verdict above.
  if (positionRisk.length) {
    console.log('\n⚠ POSITION RISK (your own book — not a data problem):');
    for (const a of positionRisk) console.log(`   ${a.level === 'critical' ? '‼ CRITICAL' : '! ' + a.level}  ${a.msg}`);
  }
  for (const r of results) {
    console.log(`\n${mark[r.level]} ${r.feed.padEnd(14)} ${r.date || '—'}${r.age != null ? `  (${r.age}d old, ${r.snapshots} snapshots)` : ''}`);
    for (const [lvl, msg] of r.notes) console.log(`      ${lvl === 'INFO' ? '·' : lvl}  ${msg}`);
  }
  console.log(`\n${mark[dashNote[0]] || ''} dashboard      ${dashNote[1]}`);
  console.log(line);
}

if (has('strict') && worst === 'ERROR') process.exit(1);
