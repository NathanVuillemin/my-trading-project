#!/usr/bin/env node
// correlations.mjs: rolling correlations for the Trading Desk Drivers page.
//
// The pairs that normally move together (or against each other) and each currency's outside
// driver. For every pair: 20-day and 60-day correlation of daily returns, the 60-day value a
// month ago, and ~6 months of 60-day history (weekly points), so a weakening or flipping
// relationship shows up early. Measured, never assumed.
//
// Data (keyless, verified 2026-11-09):
//   Yahoo Finance chart API: FX, DXY, futures (oil, gold, copper, iron ore), VIX, NDX.
//   FRED fredgraph.csv: US 2Y / 10Y yields, 10Y real yield (yields use daily change, not % return).
// Not available daily for free: TTF gas (EUR driver), GDT dairy (NZD), UK gilts (GBP). Those
// drivers keep their manual values.
//
// Usage: node scripts/correlations.mjs [--json]
// Writes: dashboard/desk/data/correlations.json (page) + data/correlations/<YYYY-MM-DD>.json (archive)

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');
const has = (n) => process.argv.includes(`--${n}`);

// Series: key -> where it comes from. kind 'yield' = correlate daily changes, else log returns.
const SERIES = {
  EURUSD: { yahoo: 'EURUSD=X' }, GBPUSD: { yahoo: 'GBPUSD=X' }, AUDUSD: { yahoo: 'AUDUSD=X' },
  NZDUSD: { yahoo: 'NZDUSD=X' }, USDJPY: { yahoo: 'JPY=X' }, USDCHF: { yahoo: 'CHF=X' },
  USDCAD: { yahoo: 'CAD=X' }, AUDJPY: { yahoo: 'AUDJPY=X' }, DXY: { yahoo: 'DX-Y.NYB' },
  XAUUSD: { yahoo: 'GC=F', label: 'Gold' }, WTI: { yahoo: 'CL=F', label: 'WTI oil' },
  COPPER: { yahoo: 'HG=F', label: 'Copper' }, IRONORE: { yahoo: 'TIO=F', label: 'Iron ore' },
  VIX: { yahoo: '^VIX' }, NDX: { yahoo: '^NDX', label: 'Nasdaq 100' },
  US2Y: { fred: 'DGS2', kind: 'yield', label: 'US 2Y yield' }, US10Y: { fred: 'DGS10', kind: 'yield', label: 'US 10Y yield' },
  USREAL10Y: { fred: 'DFII10', kind: 'yield', label: 'US 10Y real yield' },
};

// typical: how the pair normally moves. drivers: currencies (or XAU) whose driver this pair speaks to.
// driverOf: set when the pair IS that currency's outside driver on the Drivers page.
const PAIRS = [
  { id: 'eurusd-gbpusd', a: 'EURUSD', b: 'GBPUSD', typical: 'positive', drivers: ['EUR', 'GBP'], why: 'Both quoted against USD; European block moves together.' },
  { id: 'audusd-nzdusd', a: 'AUDUSD', b: 'NZDUSD', typical: 'positive', drivers: ['AUD', 'NZD'], why: 'Commodity bloc, same region, same China exposure.' },
  { id: 'eurusd-usdchf', a: 'EURUSD', b: 'USDCHF', typical: 'inverse', drivers: ['EUR', 'CHF'], why: 'CHF tracks EUR against the dollar; quotes are flipped.' },
  { id: 'usdjpy-usdchf', a: 'USDJPY', b: 'USDCHF', typical: 'positive', drivers: ['JPY', 'CHF'], why: 'Both low-yield havens / funders against USD.' },
  { id: 'eurusd-dxy', a: 'EURUSD', b: 'DXY', typical: 'inverse', drivers: ['USD', 'EUR'], why: 'EUR is about 58% of the dollar index.' },
  { id: 'audusd-usdcad', a: 'AUDUSD', b: 'USDCAD', typical: 'inverse', drivers: ['AUD', 'CAD'], why: 'Commodity currencies against USD; USDCAD quote is flipped.' },
  { id: 'audjpy-ndx', a: 'AUDJPY', b: 'NDX', typical: 'positive', drivers: ['AUD', 'JPY'], why: 'Risk barometer: risk-on lifts AUD, sells JPY, lifts equities.' },
  { id: 'dxy-us2y', a: 'DXY', b: 'US2Y', typical: 'positive', drivers: ['USD'], driverOf: 'USD', why: 'Dollar follows front-end rate expectations.' },
  { id: 'usdjpy-us10y', a: 'USDJPY', b: 'US10Y', typical: 'positive', drivers: ['JPY'], driverOf: 'JPY', why: 'Wider US-Japan yield gap lifts USDJPY.' },
  { id: 'usdcad-wti', a: 'USDCAD', b: 'WTI', typical: 'inverse', drivers: ['CAD'], driverOf: 'CAD', why: 'Oil up = Canada terms of trade up = CAD up (USDCAD down).' },
  { id: 'audusd-ironore', a: 'AUDUSD', b: 'IRONORE', typical: 'positive', drivers: ['AUD'], driverOf: 'AUD', why: "Iron ore is Australia's biggest export." },
  { id: 'audusd-copper', a: 'AUDUSD', b: 'COPPER', typical: 'positive', drivers: ['AUD'], why: 'Copper = China / global growth read.' },
  { id: 'usdchf-vix', a: 'USDCHF', b: 'VIX', typical: 'inverse', drivers: ['CHF'], driverOf: 'CHF', why: 'Fear spikes pull haven money into CHF (USDCHF down).' },
  { id: 'xauusd-dxy', a: 'XAUUSD', b: 'DXY', typical: 'inverse', drivers: ['XAU', 'USD'], why: 'Gold is priced in dollars.' },
  { id: 'xauusd-real10y', a: 'XAUUSD', b: 'USREAL10Y', typical: 'inverse', drivers: ['XAU'], why: 'Gold pays no yield; higher real yields raise its cost.' },
];

const STRONG = 0.5, MODERATE = 0.3, SHIFT = 0.2, W_SHORT = 20, W_LONG = 60, HIST_OBS = 130, HIST_STEP = 5;

function prevBusinessDay(iso) {
  const d = new Date(iso + 'T12:00:00Z');
  do d.setUTCDate(d.getUTCDate() - 1); while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}
async function yahoo(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1y&interval=1d`;
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (my-trading-project desk)' } });
  if (!r.ok) throw new Error(`Yahoo ${symbol}: HTTP ${r.status}`);
  const res = (await r.json()).chart?.result?.[0];
  if (!res) throw new Error(`Yahoo ${symbol}: no result`);
  // Bars are stamped at local midnight of the exchange, so the date must be read in the
  // exchange's own time zone (a fixed gmtoffset breaks across summer time: London FX bars sit
  // at 23:00 UTC in summer). Weekend bars (futures' Sunday open) are dropped.
  // Forex (=X) daily bars are midnight-London snapshots: the bar dated D holds the price at the
  // END of the previous business day (checked against hourly bars 2026-11-09; unshifted,
  // EURUSD vs DXY read -0.06 instead of -0.88). So for FX, the bar's OPEN is used as the close
  // of the previous business day; this also recovers Friday's close from Monday's live bar.
  const tz = res.meta?.exchangeTimezoneName || 'UTC', q = res.indicators.quote[0];
  const fx = symbol.endsWith('=X');
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' });
  const out = new Map();
  res.timestamp.forEach((t, i) => {
    const v = fx ? q.open[i] : q.close[i];
    if (v == null) return;
    const p = Object.fromEntries(fmt.formatToParts(new Date(t * 1000)).map((x) => [x.type, x.value]));
    if (p.weekday === 'Sat' || p.weekday === 'Sun') return;
    let date = `${p.year}-${p.month}-${p.day}`;
    if (fx) date = prevBusinessDay(date);
    out.set(date, v);
  });
  return out;
}
async function fred(id) {
  const r = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`);
  if (!r.ok) throw new Error(`FRED ${id}: HTTP ${r.status}`);
  const since = new Date(Date.now() - 400 * 864e5).toISOString().slice(0, 10), out = new Map();
  for (const line of (await r.text()).trim().split('\n').slice(1)) {
    const [d, v] = line.split(',');
    if (d >= since && v && v !== '.') out.set(d, +v);
  }
  return out;
}
function pearson(x, y) {
  const n = x.length; if (n < 3) return null;
  const mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = x[i] - mx, dy = y[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}
const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);

// Aligned daily moves for two series on the dates both have a close (and a previous close).
function moves(sa, sb, kindA, kindB) {
  const dates = [...sa.keys()].filter((d) => sb.has(d)).sort();
  const step = (s, k, d0, d1) => (k === 'yield' ? s.get(d1) - s.get(d0) : Math.log(s.get(d1) / s.get(d0)));
  const out = { dates: [], a: [], b: [] };
  for (let i = 1; i < dates.length; i++) {
    out.dates.push(dates[i]); out.a.push(step(sa, kindA, dates[i - 1], dates[i])); out.b.push(step(sb, kindB, dates[i - 1], dates[i]));
  }
  return out;
}
const corrAt = (m, end, w) => (end + 1 >= w ? pearson(m.a.slice(end + 1 - w, end + 1), m.b.slice(end + 1 - w, end + 1)) : null);

function status(r60, typical) {
  if (r60 == null) return 'no data';
  const aligned = r60 * (typical === 'inverse' ? -1 : 1);
  return aligned >= STRONG ? 'strong' : aligned >= MODERATE ? 'moderate' : aligned > -MODERATE ? 'weak' : 'flipped';
}

async function main() {
  const data = {}, errors = [];
  await Promise.all(Object.entries(SERIES).map(async ([k, s]) => {
    try { data[k] = s.fred ? await fred(s.fred) : await yahoo(s.yahoo); } catch (e) { errors.push(`${k}: ${e.message}`); }
  }));
  const pairs = PAIRS.map((p) => {
    const base = { ...p, labelA: SERIES[p.a].label || p.a, labelB: SERIES[p.b].label || p.b };
    if (!data[p.a] || !data[p.b]) return { ...base, status: 'no data' };
    const m = moves(data[p.a], data[p.b], SERIES[p.a].kind, SERIES[p.b].kind), end = m.a.length - 1;
    const r20 = corrAt(m, end, W_SHORT), r60 = corrAt(m, end, W_LONG), r60ago = corrAt(m, end - W_SHORT, W_LONG);
    const history = [];
    for (let i = Math.max(W_LONG - 1, end - HIST_OBS); i <= end; i += HIST_STEP) history.push({ date: m.dates[i], r60: r2(corrAt(m, i, W_LONG)), r20: r2(corrAt(m, i, W_SHORT)) });
    if (history.at(-1)?.date !== m.dates[end]) history.push({ date: m.dates[end], r60: r2(r60), r20: r2(r20) });
    const change1m = r60 != null && r60ago != null ? r2(r60 - r60ago) : null;
    const sign = p.typical === 'inverse' ? -1 : 1;
    const shift = change1m == null || Math.abs(change1m) < SHIFT ? 'stable' : change1m * sign > 0 ? 'strengthening' : 'weakening';
    return { ...base, asOf: m.dates[end], obs: m.a.length, r20: r2(r20), r60: r2(r60), r60MonthAgo: r2(r60ago), change1m, shift, status: status(r60, p.typical), history };
  });
  const asOf = new Date().toISOString().slice(0, 10);
  const out = {
    mock: false, asOf, generatedAt: new Date().toISOString(),
    method: `Pearson correlation of daily moves (log returns; daily change for yields) on dates both series traded. r20 = last ${W_SHORT} days, r60 = last ${W_LONG}. Strength is read against the pair's typical direction: strong |r| ≥ ${STRONG}, moderate ≥ ${MODERATE}, weak below, flipped = ${MODERATE}+ the wrong way. Shifting = r60 moved ${SHIFT}+ in a month.`,
    sources: 'Yahoo Finance daily closes; FRED (DGS2, DGS10, DFII10).',
    missing: ['TTF gas (EUR driver)', 'GDT dairy (NZD driver)', 'UK gilts (GBP driver)'],
    errors, pairs,
  };
  if (has('json')) { console.log(JSON.stringify(out, null, 2)); return; }
  writeFileSync(join(ROOT, 'dashboard', 'desk', 'data', 'correlations.json'), JSON.stringify(out, null, 2) + '\n');
  mkdirSync(join(ROOT, 'data', 'correlations'), { recursive: true });
  const slim = { asOf, pairs: pairs.map(({ id, r20, r60, change1m, status: s }) => ({ id, r20, r60, change1m, status: s })) };
  writeFileSync(join(ROOT, 'data', 'correlations', `${asOf}.json`), JSON.stringify(slim, null, 2) + '\n');
  for (const p of pairs) console.log(`${p.id.padEnd(16)} r20 ${String(p.r20).padStart(5)}  r60 ${String(p.r60).padStart(5)}  1m ${String(p.change1m).padStart(5)}  ${p.status} / ${p.shift ?? ''}`);
  if (errors.length) { console.error('Missing series:\n  ' + errors.join('\n  ')); if (errors.length >= Object.keys(SERIES).length / 2) process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(1); });
