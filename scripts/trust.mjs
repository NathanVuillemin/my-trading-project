#!/usr/bin/env node
// trust.mjs — rank Hyperliquid wallets by how much their positioning is worth believing.
//
// The leaderboard ranks on 30-day PnL alone, which is a poor trust signal:
//   - $14.3M on a $30M account (47% ROI) sits beside $47M on $13B (0.36%)
//   - one lucky month outranks years of consistency
//   - market makers and delta-neutral desks rank high while being directionally meaningless
//   - no drawdown, no sample size, no persistence
//
// This scores each wallet on evidence and emits a 0-100 trust score plus an inferred style.
//
// ON LABELING — a wrong label is worse than no label. Everything here is inferred from
// OBSERVED BEHAVIOUR (fill sizes, hold times, book balance), never from a claimed identity,
// and every component ships with the raw numbers that produced it so a classification can be
// checked and overridden. Style is a WEIGHT, not a filter: nothing is silently dropped.
//
// Usage:
//   node scripts/trust.mjs                # score top 60 leaderboard wallets
//   node scripts/trust.mjs --top 150
//   node scripts/trust.mjs --json
//
// Writes: data/trust/<YYYY-MM-DD>.json

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dir, '..', 'data', 'trust');
const API = 'https://api.hyperliquid.xyz/info';
const LEADERBOARD = 'https://stats-data.hyperliquid.xyz/Mainnet/leaderboard';

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  if (i === -1) return d;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
};
const has = (n) => process.argv.includes(`--${n}`);

const post = async (b) => {
  const r = await fetch(API, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(b), signal: AbortSignal.timeout(25000),
  });
  if (!r.ok) throw new Error(`${b.type} HTTP ${r.status}`);
  return r.json();
};
const pool = async (items, n, fn) => {
  const out = [];
  for (let i = 0; i < items.length; i += n) out.push(...await Promise.all(items.slice(i, i + n).map(fn)));
  return out;
};
const num = (v) => { const n = +v; return isFinite(n) ? n : 0; };
const clamp01 = (n) => Math.max(0, Math.min(1, n));
const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const std = (a) => { const m = mean(a); return a.length ? Math.sqrt(mean(a.map(x => (x - m) ** 2))) : 0; };
const short = (a) => a.slice(0, 6) + '…' + a.slice(-4);

// ---------------------------------------------------------------- round trips
// Same approach as portfolio.mjs: a trade is flat -> exposed -> flat. `startPosition`
// marks the boundaries. Counting closing fills instead would read one scaled-out
// position as dozens of trades.
function roundTrips(fills) {
  const byCoin = {};
  for (const f of fills) (byCoin[f.coin] ||= []).push(f);
  const trips = [];
  let openStubs = 0;
  for (const list of Object.values(byCoin)) {
    list.sort((a, b) => a.time - b.time);
    let cur = null;
    for (const f of list) {
      const before = num(f.startPosition);
      const after = before + (f.side === 'B' ? num(f.sz) : -num(f.sz));
      if (!cur) cur = { pnl: 0, fees: 0, fills: 0, start: f.time };
      cur.pnl += num(f.closedPnl); cur.fees += num(f.fee); cur.fills++;
      if (Math.abs(after) < 1e-9) {
        trips.push({ pnl: cur.pnl - cur.fees, fills: cur.fills, holdMs: f.time - cur.start });
        cur = null;
      }
    }
    if (cur) openStubs++;
  }
  return { trips, openStubs };
}

// ---------------------------------------------------------------- style inference
// Behavioural only. Each signal is reported with its raw value.
function inferStyle(fills, positions, trips) {
  const n = fills.length;
  const notionals = fills.map(f => Math.abs(num(f.sz)) * num(f.px)).filter(x => x > 0);
  const medNotional = notionals.length
    ? notionals.slice().sort((a, b) => a - b)[Math.floor(notionals.length / 2)] : 0;
  const grossPos = positions.reduce((s, p) => s + Math.abs(num(p.position?.positionValue)), 0);

  // Slicing: many fills per unit of position implies algorithmic execution.
  const fillsPerTrip = trips.trips.length ? mean(trips.trips.map(t => t.fills)) : null;
  // A tiny median fill against a large book is the clearest algo tell.
  const sliceRatio = grossPos > 0 && medNotional > 0 ? medNotional / grossPos : null;
  // Delta balance: a book that is near flat long-vs-short is hedged, not directional.
  const longU = positions.filter(p => num(p.position?.szi) > 0).reduce((s, p) => s + num(p.position?.positionValue), 0);
  const shortU = positions.filter(p => num(p.position?.szi) < 0).reduce((s, p) => s + num(p.position?.positionValue), 0);
  const netBias = (longU + shortU) > 0 ? Math.abs(longU - shortU) / (longU + shortU) : null;
  const medHoldH = trips.trips.length
    ? trips.trips.map(t => t.holdMs / 3.6e6).sort((a, b) => a - b)[Math.floor(trips.trips.length / 2)]
    : null;

  const evidence = {
    fillCount: n,
    medianFillUsd: Math.round(medNotional),
    grossPositionUsd: Math.round(grossPos),
    sliceRatio: sliceRatio == null ? null : +sliceRatio.toFixed(5),
    avgFillsPerRoundTrip: fillsPerTrip == null ? null : +fillsPerTrip.toFixed(1),
    netDirectionalBias: netBias == null ? null : +netBias.toFixed(3),
    medianHoldHours: medHoldH == null ? null : +medHoldH.toFixed(1),
  };

  // What actually distinguishes a market maker is being on BOTH SIDES and not holding —
  // delta-neutral inventory turned over quickly. Execution style does not.
  //
  // Slicing is deliberately NOT sufficient on its own: a large directional trader breaking a
  // position into small fills is good execution (TWAP), and an earlier version of this
  // demoted exactly the big conviction traders worth following. Slicing now only counts as
  // corroboration once the book already looks neutral or fast.
  const neutralBook = netBias != null && netBias < 0.45;
  const fastTurnover = medHoldH != null && medHoldH < 6;

  let algo = 0;
  if (netBias != null && netBias < 0.2) algo += 3;               // near delta-neutral: the core tell
  else if (neutralBook) algo += 2;
  if (medHoldH != null && medHoldH < 1) algo += 2;               // in and out within the hour
  else if (fastTurnover) algo += 1;
  // Corroborating evidence only — never enough by itself.
  if (neutralBook || fastTurnover) {
    if (sliceRatio != null && sliceRatio < 0.002) algo += 1;
    if (fillsPerTrip != null && fillsPerTrip > 25) algo += 1;
  }

  let style = 'directional';
  if (algo >= 5) style = 'market-maker';
  else if (algo >= 3) style = 'mixed';
  else if (fastTurnover) style = 'scalper';

  evidence.neutralBook = neutralBook;
  evidence.fastTurnover = fastTurnover;
  return { style, algoScore: algo, evidence };
}

// ---------------------------------------------------------------- main
(async () => {
  const top = Number(arg('top', 60));
  const quiet = has('json');
  const log = (...a) => { if (!quiet) console.log(...a); };

  log('Fetching leaderboard...');
  const lb = await (await fetch(LEADERBOARD, { signal: AbortSignal.timeout(30000) })).json();
  const rows = lb.leaderboardRows || lb;
  const win = (x, k) => (x.windowPerformances || []).find(w => w[0] === k)?.[1] || {};
  const ranked = rows.map(x => ({
    addr: x.ethAddress,
    accountValue: num(x.accountValue),
    day: num(win(x, 'day').pnl), week: num(win(x, 'week').pnl),
    month: num(win(x, 'month').pnl), allTime: num(win(x, 'allTime').pnl),
    monthRoi: num(win(x, 'month').roi), monthVlm: num(win(x, 'month').vlm),
  })).sort((a, b) => b.month - a.month).slice(0, top);

  log(`Scoring ${ranked.length} wallets...`);
  const scored = await pool(ranked, 5, async (r) => {
    let state = {}, fills = [], pf = [];
    try {
      [state, fills, pf] = await Promise.all([
        post({ type: 'clearinghouseState', user: r.addr }).catch(() => ({})),
        post({ type: 'userFills', user: r.addr }).catch(() => []),
        post({ type: 'portfolio', user: r.addr }).catch(() => []),
      ]);
    } catch { /* scored on what arrived */ }

    const positions = (state.assetPositions || []).filter(p => num(p.position?.szi) !== 0);
    const trips = roundTrips(fills || []);
    const styleInfo = inferStyle(fills || [], positions, trips);

    // --- equity curve: drawdown and risk-adjusted return ---
    const bucket = (pf || []).find(b => b[0] === 'month') || (pf || []).find(b => b[0] === 'week');
    const hist = (bucket?.[1]?.accountValueHistory || []).map(([t, v]) => num(v)).filter(v => v > 0);
    let maxDD = null, sharpe = null;
    if (hist.length > 5) {
      let peak = hist[0], dd = 0;
      for (const v of hist) { if (v > peak) peak = v; dd = Math.max(dd, (peak - v) / peak); }
      maxDD = dd;
      const rets = [];
      for (let i = 1; i < hist.length; i++) if (hist[i - 1] > 0) rets.push(hist[i] / hist[i - 1] - 1);
      const s = std(rets);
      // Annualised from the sample's own cadence; comparative only, not a formal Sharpe.
      if (s > 0) sharpe = mean(rets) / s * Math.sqrt(365);
    }

    // --- components, each 0..1 ---
    // Consistency: positive across day/week/month/allTime is what durable looks like.
    const posWindows = [r.day, r.week, r.month, r.allTime].filter(v => v > 0).length;
    const cConsistency = posWindows / 4;

    // Sample size. Completed round trips are the honest measure, but big traders hold
    // positions open, so the 2000-fill window often contains none at all. Falling back to
    // closing fills and markets traded keeps the component alive instead of scoring
    // everyone at zero — the fallback is weaker evidence and is recorded in `confidence`.
    const nTrips = trips.trips.length;
    const closingFills = (fills || []).filter(f => num(f.closedPnl) !== 0).length;
    const marketsTraded = new Set((fills || []).map(f => f.coin)).size;
    const sampleBasis = nTrips > 0 ? 'roundTrips' : closingFills > 0 ? 'closingFills' : 'markets';
    const cSample = nTrips > 0
      ? clamp01(Math.log10(nTrips + 1) / Math.log10(51))                    // saturates ~50 trips
      : closingFills > 0
        ? 0.6 * clamp01(Math.log10(closingFills + 1) / Math.log10(201))     // capped: weaker evidence
        : 0.3 * clamp01(marketsTraded / 10);

    // Risk-adjusted: reward smooth equity, punish deep drawdowns.
    const cRisk = maxDD == null ? 0.4 : clamp01(1 - maxDD * 2.5);       // 40% DD -> 0
    const cSharpe = sharpe == null ? 0.4 : clamp01((sharpe + 1) / 4);   // -1 -> 0, +3 -> 1

    // Efficiency: ROI matters more than absolute dollars on a huge account.
    const cRoi = clamp01((r.monthRoi + 0.1) / 0.6);                     // -10% -> 0, +50% -> 1

    // Directional: the whole point is copyable conviction, so algos are demoted.
    const cDirectional = styleInfo.style === 'directional' ? 1
      : styleInfo.style === 'scalper' ? 0.5
        : styleInfo.style === 'mixed' ? 0.35 : 0.1;

    const parts = {
      consistency: cConsistency, sample: cSample, drawdown: cRisk,
      riskAdjusted: cSharpe, efficiency: cRoi, directional: cDirectional,
    };
    const W = { consistency: 0.2, sample: 0.15, drawdown: 0.15, riskAdjusted: 0.15, efficiency: 0.1, directional: 0.25 };
    let score = Object.entries(W).reduce((s, [k, w]) => s + parts[k] * w, 0) * 100;

    // --- disqualifiers: some things a weighted average should not be allowed to average away ---
    const flags = [];

    // A near-total drawdown is not a component to be offset by a good ROI. Whatever the
    // cause, the equity curve was destroyed and the wallet is not something to follow.
    if (maxDD != null && maxDD >= 0.6) {
      flags.push(`max drawdown ${(maxDD * 100).toFixed(0)}% — capped`);
      score = Math.min(score, maxDD >= 0.9 ? 20 : 35);
    }

    // Accounts far outside any plausible trading size, earning near-zero percentage
    // returns on enormous capital, are treasuries/protocol wallets rather than traders.
    const looksProtocol = r.accountValue > 1e9 && Math.abs(r.monthRoi) < 0.02;
    if (looksProtocol) {
      flags.push('protocol/treasury profile — huge capital, negligible ROI');
      score = Math.min(score, 25);
    }

    // Confidence in the score itself, kept separate from the score. A high score built on
    // no completed trades is a hypothesis, not a track record.
    let confidence = 0.35;
    if (sampleBasis === 'roundTrips') confidence += 0.3;
    else if (sampleBasis === 'closingFills') confidence += 0.15;
    if (maxDD != null) confidence += 0.15;
    if (sharpe != null) confidence += 0.1;
    if (posWindows === 4) confidence += 0.1;
    confidence = clamp01(confidence);

    const wins = trips.trips.filter(t => t.pnl > 0).length;
    return {
      addr: r.addr, short: short(r.addr),
      trustScore: +score.toFixed(1),
      confidence: +confidence.toFixed(2),
      flags,
      sampleBasis, closingFills, marketsTraded,
      style: looksProtocol ? 'protocol' : styleInfo.style,
      accountValue: Math.round(r.accountValue),
      pnl: { day: Math.round(r.day), week: Math.round(r.week), month: Math.round(r.month), allTime: Math.round(r.allTime) },
      positiveWindows: posWindows,
      monthRoiPct: +(r.monthRoi * 100).toFixed(1),
      roundTrips: nTrips,
      winRatePct: nTrips ? +(100 * wins / nTrips).toFixed(1) : null,
      maxDrawdownPct: maxDD == null ? null : +(maxDD * 100).toFixed(1),
      sharpeish: sharpe == null ? null : +sharpe.toFixed(2),
      openPositions: positions.length,
      components: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, +v.toFixed(2)])),
      styleEvidence: styleInfo.evidence,
      algoScore: styleInfo.algoScore,
    };
  });

  scored.sort((a, b) => b.trustScore - a.trustScore);

  const payload = {
    date: new Date().toISOString().slice(0, 10),
    generatedAt: new Date().toISOString(),
    scored: scored.length,
    weights: { consistency: 0.2, sample: 0.15, drawdown: 0.15, riskAdjusted: 0.15, efficiency: 0.1, directional: 0.25 },
    styleCounts: scored.reduce((a, s) => (a[s.style] = (a[s.style] || 0) + 1, a), {}),
    wallets: scored,
  };

  if (!has('no-write')) {
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(join(OUT_DIR, `${payload.date}.json`), JSON.stringify(payload, null, 2));
  }
  if (quiet) { process.stdout.write(JSON.stringify(payload)); return; }

  const line = '─'.repeat(96);
  console.log(`\n${line}\nTRADER TRUST — ${payload.date}  (${scored.length} wallets)\n${line}`);
  console.log('Styles:', Object.entries(payload.styleCounts).map(([k, v]) => `${k} ${v}`).join('  |  '));
  console.log('\nscore conf  wallet          style          acct       mo.PnL     ROI   trips  maxDD  win  evidence');
  for (const w of scored.slice(0, 25)) {
    console.log(
      `${String(w.trustScore).padStart(5)} ${w.confidence.toFixed(2)}  ${w.short}  ${w.style.padEnd(13)} `
      + `$${(w.accountValue / 1e6).toFixed(1).padStart(7)}M `
      + `$${(w.pnl.month / 1e6).toFixed(2).padStart(8)}M `
      + `${String(w.monthRoiPct).padStart(6)}% `
      + `${String(w.roundTrips).padStart(5)} `
      + `${(w.maxDrawdownPct == null ? '  -' : String(w.maxDrawdownPct)).padStart(6)} `
      + `${w.positiveWindows}/4  ${w.sampleBasis}`
      + (w.flags.length ? `  ⚠ ${w.flags[0]}` : ''));
  }

  console.log(`\nDemoted as non-directional (evidence shown, nothing silently dropped):`);
  for (const w of scored.filter(s => s.style === 'market-maker' || s.style === 'mixed').slice(0, 6)) {
    const e = w.styleEvidence;
    console.log(`  ${w.short} ${w.style.padEnd(13)} algo=${w.algoScore}  medFill $${e.medianFillUsd?.toLocaleString()}  `
      + `slice=${e.sliceRatio}  fills/trip=${e.avgFillsPerRoundTrip}  bias=${e.netDirectionalBias}  hold=${e.medianHoldHours}h`);
  }
  console.log(line);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
