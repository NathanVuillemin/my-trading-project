#!/usr/bin/env node
// desk-positioning.mjs: how capital is positioned in Nathan's eight currencies and in the markets his ideas
// touch. Writes dashboard/desk/data/positioning.json for the desk's Positioning page.
//
// Sources, all official and keyless:
//   CFTC TFF (gpe5-46if)            FX majors, equity indices, US 10y, VIX: asset managers (slow, real money),
//                                   leveraged funds (fast, squeeze-prone), dealers (hedging flow, not a view).
//   CFTC disaggregated (72hh-3qpy)  commodities: managed money (speculative) and producers/merchants (the
//                                   physical side, hedging by nature).
//   Japan MoF weekly flows          Japanese buying of foreign bonds and stocks, foreigners buying Japan.
//                                   Real-money JPY flow that futures do not show.
//   Yahoo daily closes              only to put the seven currency legs into dollars for the derived USD line.
//
// Never the raw net alone: each group is read as its COT index, the percentile of its net inside its own
// three-year range, so contracts of different size compare. Tags are fixed rules (see tagFor), written out
// on the page, so the page reports positioning and never forms a bias.
//
// Legacy "commercials" are never used for FX: they lump dealer hedging in with real money and invert the read.
// There is no dollar-index contract in either CFTC dataset, so USD is derived, never fuzzy-matched.
//
// Usage: node scripts/desk-positioning.mjs [--years 3] [--out path]

import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1]; };
const YEARS = +arg('years', 3);
const OUT = arg('out', join(__dir, '..', 'dashboard', 'desk', 'data', 'positioning.json'));

const TFF = 'https://publicreporting.cftc.gov/resource/gpe5-46if.json';
const DISAGG = 'https://publicreporting.cftc.gov/resource/72hh-3qpy.json';
const MOF = 'https://www.mof.go.jp/policy/international_policy/reference/itn_transactions_in_securities/week.csv';
const UA = { 'User-Agent': 'Mozilla/5.0 (my-trading-project desk)' };
const num = (v) => { const n = +String(v ?? '').replace(/[,\s]/g, ''); return Number.isFinite(n) ? n : 0; };
const round = (n, d = 0) => (n == null ? null : Math.round(n * 10 ** d) / 10 ** d);
const getJson = async (u) => { const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(30000) }); if (!r.ok) throw new Error(`HTTP ${r.status} ${u.slice(0, 80)}`); return r.json(); };

// Exact CFTC names, checked against the live lists. A rename surfaces as a warning, never a silent swap.
// size = contract size in units of the currency (for the dollar conversion of the USD line).
const FX = [
  { key: 'EUR', name: 'EURO FX - CHICAGO MERCANTILE EXCHANGE', size: 125000, yahoo: 'EURUSD=X', inv: false },
  { key: 'GBP', name: 'BRITISH POUND - CHICAGO MERCANTILE EXCHANGE', size: 62500, yahoo: 'GBPUSD=X', inv: false },
  { key: 'JPY', name: 'JAPANESE YEN - CHICAGO MERCANTILE EXCHANGE', size: 12500000, yahoo: 'JPY=X', inv: true },
  { key: 'CHF', name: 'SWISS FRANC - CHICAGO MERCANTILE EXCHANGE', size: 125000, yahoo: 'CHF=X', inv: true },
  { key: 'CAD', name: 'CANADIAN DOLLAR - CHICAGO MERCANTILE EXCHANGE', size: 100000, yahoo: 'CAD=X', inv: true },
  { key: 'AUD', name: 'AUSTRALIAN DOLLAR - CHICAGO MERCANTILE EXCHANGE', size: 100000, yahoo: 'AUDUSD=X', inv: false },
  { key: 'NZD', name: 'NZ DOLLAR - CHICAGO MERCANTILE EXCHANGE', size: 100000, yahoo: 'NZDUSD=X', inv: false },
];
const MARKETS = [
  { key: 'NDX', label: 'Nasdaq 100', group: 'Equities', report: 'tff', name: 'NASDAQ-100 Consolidated - CHICAGO MERCANTILE EXCHANGE' },
  { key: 'SPX', label: 'S&P 500', group: 'Equities', report: 'tff', name: 'S&P 500 Consolidated - CHICAGO MERCANTILE EXCHANGE' },
  { key: 'VIX', label: 'VIX', group: 'Equities', report: 'tff', name: 'VIX FUTURES - CBOE FUTURES EXCHANGE' },
  { key: 'UST10', label: 'US 10y note', group: 'Rates', report: 'tff', name: 'UST 10Y NOTE - CHICAGO BOARD OF TRADE' },
  { key: 'UST2', label: 'US 2y note', group: 'Rates', report: 'tff', name: 'UST 2Y NOTE - CHICAGO BOARD OF TRADE' },
  { key: 'GOLD', label: 'Gold', group: 'Metals', report: 'disagg', name: 'GOLD - COMMODITY EXCHANGE INC.' },
  { key: 'SILVER', label: 'Silver', group: 'Metals', report: 'disagg', name: 'SILVER - COMMODITY EXCHANGE INC.' },
  { key: 'COPPER', label: 'Copper', group: 'Metals', report: 'disagg', name: 'COPPER- #1 - COMMODITY EXCHANGE INC.' },
  { key: 'PLATINUM', label: 'Platinum', group: 'Metals', report: 'disagg', name: 'PLATINUM - NEW YORK MERCANTILE EXCHANGE' },
  { key: 'WTI', label: 'WTI crude', group: 'Energy', report: 'disagg', name: 'WTI-PHYSICAL - NEW YORK MERCANTILE EXCHANGE' },
  { key: 'BRENT', label: 'Brent (NYMEX)', group: 'Energy', report: 'disagg', name: 'BRENT LAST DAY - NEW YORK MERCANTILE EXCHANGE' },
  { key: 'NATGAS', label: 'Natural gas', group: 'Energy', report: 'disagg', name: 'NAT GAS NYME - NEW YORK MERCANTILE EXCHANGE' },
];

// What each trader group's flow means. `read` is what the page shows next to the number.
const GROUPS = {
  tff: [
    { key: 'assetMgr', name: 'Asset managers', role: 'slow', read: 'real money, multi-month', long: 'asset_mgr_positions_long', short: 'asset_mgr_positions_short' },
    { key: 'levFunds', name: 'Leveraged funds', role: 'fast', read: 'hedge funds, crowded and squeeze-prone', long: 'lev_money_positions_long', short: 'lev_money_positions_short' },
    { key: 'dealer', name: 'Dealers', role: 'hedging', read: 'the other side of client flow, not a view', long: 'dealer_positions_long_all', short: 'dealer_positions_short_all' },
  ],
  disagg: [
    { key: 'managedMoney', name: 'Managed money', role: 'fast', read: 'speculators, crowded and squeeze-prone', long: 'm_money_positions_long_all', short: 'm_money_positions_short_all' },
    { key: 'producer', name: 'Producers / merchants', role: 'hedging', read: 'the physical side, hedging by nature', long: 'prod_merc_positions_long', short: 'prod_merc_positions_short' },
    { key: 'swap', name: 'Swap dealers', role: 'hedging', read: 'bank hedging flow, not a view', long: 'swap_positions_long_all', short: 'swap__positions_short_all' },
  ],
};

const warns = [];
const since = new Date(Date.now() - (YEARS * 365 + 60) * 864e5).toISOString().slice(0, 10);
const lookback = YEARS * 52;

async function cot(report, name) {
  const where = `market_and_exchange_names='${name.replace(/'/g, "''")}' AND report_date_as_yyyy_mm_dd>'${since}'`;
  const url = `${report === 'tff' ? TFF : DISAGG}?$where=${encodeURIComponent(where)}&$order=${encodeURIComponent('report_date_as_yyyy_mm_dd ASC')}&$limit=500`;
  const rows = await getJson(url);
  if (!rows.length) { warns.push(`CFTC: no rows for "${name}" (${report}); renamed or delisted?`); return null; }
  return rows.map((r) => {
    const o = { date: String(r.report_date_as_yyyy_mm_dd).slice(0, 10), oi: num(r.open_interest_all) };
    for (const g of GROUPS[report]) o[g.key] = num(r[g.long]) - num(r[g.short]);
    return o;
  });
}

// Percentile of v inside the window: 0 = lowest net of the window, 100 = highest.
const pct = (win, v) => Math.round((win.filter((x) => x <= v).length / win.length) * 100);

// The fixed rules the page shows. Index from 0 to 100.
//   crowded long / short: index at or beyond 80 / 20.
//   unwinding: was at an extreme in the last 8 weeks and has come back 15+ points, now off the extreme.
//   building: moved 20+ points in 4 weeks without being at an extreme.
function tagFor(idx) {
  const n = idx.length, now = idx[n - 1], ago4 = idx[Math.max(0, n - 5)];
  const recent = idx.slice(-9);
  const hi = Math.max(...recent), lo = Math.min(...recent);
  if (now >= 80) return 'crowded-long';
  if (now <= 20) return 'crowded-short';
  if (hi >= 80 && now <= hi - 15) return 'unwinding-long';
  if (lo <= 20 && now >= lo + 15) return 'unwinding-short';
  if (now - ago4 >= 20) return 'building-long';
  if (now - ago4 <= -20) return 'building-short';
  return 'neutral';
}

function groupStats(series, key, meta) {
  const nets = series.map((s) => s[key]);
  const win = nets.slice(-lookback);
  // Index trajectory, every point read against the same window, so the line and today's number agree.
  const idx = win.map((v) => pct(win, v));
  const n = nets.length, last = series[n - 1];
  return {
    key, name: meta.name, role: meta.role, read: meta.read,
    net: last[key], chg1w: n > 1 ? last[key] - nets[n - 2] : null,
    index: idx[idx.length - 1], index1w: idx[idx.length - 2] ?? null, index4w: idx[idx.length - 5] ?? null,
    shareOfOi: last.oi ? round((last[key] / last.oi) * 100, 1) : null,
    // Hedging groups take the other side of flow by obligation; an extreme there is size, not a crowd.
    tag: meta.role === 'hedging' ? null : tagFor(idx),
    spark: idx.slice(-26),
  };
}

function squeeze(groups) {
  const slow = groups.find((g) => g.role === 'slow'), fast = groups.find((g) => g.role === 'fast');
  if (!slow || !fast) return null;
  if (slow.index >= 75 && fast.index <= 25) return 'fast money short against real money long';
  if (slow.index <= 25 && fast.index >= 75) return 'fast money long against real money short';
  return null;
}

// ---------- Yahoo closes for the USD conversion ----------
async function usdPerUnit(f) {
  for (const host of ['query1', 'query2']) {
    try {
      const j = await getJson(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(f.yahoo)}?range=5y&interval=1d`);
      const r = j.chart.result[0], q = r.indicators.quote[0].close;
      const out = [];
      r.timestamp.forEach((t, i) => { if (q[i] != null) out.push([new Date(t * 1000).toISOString().slice(0, 10), f.inv ? 1 / q[i] : q[i]]); });
      return out;
    } catch { /* next host */ }
  }
  return null;
}
const priceOn = (px, date) => { let v = null; for (const [d, p] of px) { if (d > date) break; v = p; } return v; };

// ---------- Japan MoF weekly flows ----------
async function mofFlows() {
  const r = await fetch(MOF, { headers: UA, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`MoF HTTP ${r.status}`);
  const text = new TextDecoder('shift_jis').decode(await r.arrayBuffer());
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    // A data row starts with the period, e.g. "2026．11．1～11．7". Full-width dots and tilde (U+FF5E).
    const norm = line.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/．/g, '.');
    const m = norm.match(/^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\s*[〜～~]\s*(\d{1,2})\.\s*(\d{1,2})/);
    if (!m) continue;
    const cells = []; let cur = '', q = false;
    for (const ch of line) { if (ch === '"') q = !q; else if (ch === ',' && !q) { cells.push(cur); cur = ''; } else cur += ch; }
    cells.push(cur);
    const y = +m[1], endY = +m[4] < +m[2] ? y + 1 : y;
    const end = `${endY}-${String(m[4]).padStart(2, '0')}-${String(m[5]).padStart(2, '0')}`;
    // Unit 100 million yen; /10 gives yen billions.
    rows.push({ end, outStocks: num(cells[3]) / 10, outBonds: num(cells[6]) / 10, inStocks: num(cells[14]) / 10, inBonds: num(cells[17]) / 10 });
  }
  if (rows.length < 60) throw new Error(`MoF: parsed only ${rows.length} weeks`);
  const LINES = [
    { key: 'outBonds', label: 'Japanese buying foreign bonds', jpy: -1 },
    { key: 'outStocks', label: 'Japanese buying foreign stocks', jpy: -1 },
    { key: 'inStocks', label: 'Foreigners buying Japanese stocks', jpy: 1 },
    { key: 'inBonds', label: 'Foreigners buying Japanese bonds', jpy: 1 },
  ];
  const sum4 = (k, i) => rows.slice(Math.max(0, i - 3), i + 1).reduce((s, r) => s + r[k], 0);
  const n = rows.length;
  return {
    source: 'Japan Ministry of Finance, weekly, designated major investors',
    weekEnding: rows[n - 1].end, unit: 'JPY bn, net',
    lines: LINES.map((l) => {
      const sums = rows.map((_, i) => sum4(l.key, i)).slice(-lookback);
      const s = sums[sums.length - 1];
      return {
        ...l, week: round(rows[n - 1][l.key]), prevWeek: round(rows[n - 2][l.key]), sum4w: round(s),
        index: pct(sums, s),
        spark: rows.slice(-12).map((r) => round(r[l.key])),
      };
    }),
  };
}

// ---------- run ----------
const out = { generatedAt: new Date().toISOString(), lookbackYears: YEARS, cotDate: null, currencies: {}, markets: [], jpyFlows: null, warns };

const fxSeries = {};
for (const f of FX) {
  try {
    const s = await cot('tff', f.name);
    if (!s) continue;
    fxSeries[f.key] = s;
    const groups = GROUPS.tff.map((g) => groupStats(s, g.key, g));
    out.currencies[f.key] = { key: f.key, derived: false, market: f.name, date: s[s.length - 1].date, oi: s[s.length - 1].oi, groups, squeeze: squeeze(groups) };
  } catch (e) { warns.push(`CFTC ${f.key}: ${e.message}`); }
}

// USD: the dollar side of the seven legs, in dollars. Long EUR futures = short USD, so USD net = -sum.
try {
  const px = {};
  for (const f of FX) { if (fxSeries[f.key]) { px[f.key] = await usdPerUnit(f); if (!px[f.key]) throw new Error(`no Yahoo closes for ${f.yahoo}`); } }
  const legs = FX.filter((f) => fxSeries[f.key]);
  if (legs.length < 7) throw new Error(`only ${legs.length} of 7 legs`);
  const dates = fxSeries.EUR.map((s) => s.date).filter((d) => legs.every((f) => fxSeries[f.key].some((s) => s.date === d)));
  const usd = dates.map((date) => {
    const o = { date, oi: 0 };
    for (const g of ['assetMgr', 'levFunds']) {
      o[g] = -legs.reduce((sum, f) => { const row = fxSeries[f.key].find((s) => s.date === date); return sum + row[g] * f.size * priceOn(px[f.key], date); }, 0) / 1e9;
    }
    return o;
  });
  const groups = GROUPS.tff.slice(0, 2).map((g) => ({ ...groupStats(usd, g.key, g), shareOfOi: null, net: round(usd[usd.length - 1][g.key], 2), chg1w: round(usd[usd.length - 1][g.key] - usd[usd.length - 2][g.key], 2) }));
  out.currencies.USD = { key: 'USD', derived: true, unit: 'USD bn', market: 'Derived: dollar side of the seven CME currency futures, converted at each week\'s close', date: usd[usd.length - 1].date, groups, squeeze: squeeze(groups) };
} catch (e) { warns.push(`USD derived line: ${e.message}`); }

for (const m of MARKETS) {
  try {
    const s = await cot(m.report, m.name);
    if (!s) continue;
    const groups = GROUPS[m.report].map((g) => groupStats(s, g.key, g));
    out.markets.push({ key: m.key, label: m.label, group: m.group, report: m.report, market: m.name, date: s[s.length - 1].date, oi: s[s.length - 1].oi, groups, squeeze: squeeze(groups) });
  } catch (e) { warns.push(`CFTC ${m.key}: ${e.message}`); }
}

try { out.jpyFlows = await mofFlows(); } catch (e) { warns.push(`Japan MoF flows: ${e.message}`); }

const dates = [...Object.values(out.currencies), ...out.markets].map((x) => x.date).sort();
out.cotDate = dates[dates.length - 1] || null;
const stale = [...Object.values(out.currencies), ...out.markets].filter((x) => x.date !== out.cotDate).map((x) => x.key);
if (stale.length) warns.push(`Older report date than ${out.cotDate}: ${stale.join(', ')}`);

if (!Object.keys(out.currencies).length) { console.error('No currency positioning fetched; not writing.', warns); process.exit(1); }
writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');

const line = (k, x) => `${k.padEnd(9)} ${x.groups.map((g) => `${g.name.split(' ')[0]} ${String(g.index).padStart(3)} ${(g.tag || '-').padEnd(15)}`).join(' ')}${x.squeeze ? '  SQUEEZE: ' + x.squeeze : ''}`;
console.log(`COT report of ${out.cotDate}, index over ${YEARS}y`);
for (const [k, c] of Object.entries(out.currencies)) console.log(line(k, c));
for (const m of out.markets) console.log(line(m.key, m));
if (out.jpyFlows) for (const l of out.jpyFlows.lines) console.log(`MoF ${l.label.padEnd(36)} week ${l.week} 4w ${l.sum4w} idx ${l.index}`);
if (warns.length) console.log('Warnings:\n  ' + warns.join('\n  '));
console.log(`Wrote ${OUT}`);
