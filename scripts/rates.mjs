#!/usr/bin/env node
// rates.mjs — the macro backdrop: rates, the dollar, the curve, credit, and net liquidity.
//
// Everything a risk asset trades against. Crypto and equities do not move in a vacuum — a
// rising dollar and widening credit spreads drain risk appetite; falling real yields and
// expanding net liquidity feed it. This is the "what is the tide doing" layer.
//
// Data: FRED's fredgraph.csv download endpoint, which is KEYLESS (verified 2026-07-25 — no
// API key, unlike the FRED JSON API). One CSV per series, date,value.
//
// Usage: node scripts/rates.mjs [--json]   |   npm run rates
// Writes: data/rates/<YYYY-MM-DD>.json

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dir, '..', 'data', 'rates');
const has = (n) => process.argv.includes(`--${n}`);

// Each series: FRED id, label, unit, and how to read a RISE. `riskOnWhenFalling` marks
// series where a lower number is the risk-on signal (dollar, VIX, credit spread, fed funds).
const SERIES = [
  { id: 'DGS2', label: '2Y Treasury', unit: '%' },
  { id: 'DGS10', label: '10Y Treasury', unit: '%' },
  { id: 'T10Y2Y', label: '10Y-2Y spread', unit: '%', note: 'negative = inverted curve (recession signal); steepening = normalising' },
  { id: 'DFF', label: 'Fed funds rate', unit: '%', riskOnWhenFalling: true },
  { id: 'DTWEXBGS', label: 'Dollar (broad)', unit: 'idx', riskOnWhenFalling: true, note: 'rising dollar drains risk appetite; falling supports crypto/risk' },
  { id: 'VIXCLS', label: 'VIX', unit: '', riskOnWhenFalling: true, note: '>20 elevated fear' },
  { id: 'BAMLH0A0HYM2', label: 'High-yield spread', unit: '%', riskOnWhenFalling: true, note: 'widening = credit stress / risk-off' },
];

// Net liquidity = Fed balance sheet − reverse repo − Treasury general account. The single
// best macro tailwind/headwind for risk assets. FRED units differ per series (verified
// 2026-07-25): WALCL and WTREGEN in $ millions, RRPONTSYD already in $ billions. WALCL and
// WTREGEN are weekly; RRPONTSYD is daily — so the weekly change is computed by DATE, not by
// a fixed observation count, or the cadences would not line up.
const LIQUIDITY = [
  { id: 'WALCL', scaleToB: 1 / 1000 },
  { id: 'RRPONTSYD', scaleToB: 1 },
  { id: 'WTREGEN', scaleToB: 1 / 1000 },
];
// value of a series at/just before (lastDate − days)
function valueDaysAgo(rows, days) {
  if (!rows.length) return null;
  const target = new Date(rows[rows.length - 1].d).getTime() - days * 864e5;
  let pick = rows[0];
  for (const r of rows) { if (new Date(r.d).getTime() <= target) pick = r; else break; }
  return pick.v;
}

const warns = [];
async function fredSeries(id) {
  const cosd = new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10);
  const r = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${cosd}`,
    { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const rows = (await r.text()).trim().split(/\r?\n/).slice(1)
    .map(l => { const [d, v] = l.split(','); return { d, v: v === '.' || v === '' ? null : +v }; })
    .filter(x => x.v != null && isFinite(x.v));
  return rows;
}

// Latest value plus the value roughly a week and a month earlier (by observation count).
function summarize(rows) {
  if (!rows.length) return null;
  const last = rows[rows.length - 1];
  const back = (n) => rows[Math.max(0, rows.length - 1 - n)]?.v ?? null;
  return { date: last.d, value: last.v, prevWeek: back(5), prevMonth: back(20) };
}

(async () => {
  const out = { date: new Date().toISOString().slice(0, 10), generatedAt: new Date().toISOString(), indicators: [] };

  for (const s of SERIES) {
    try {
      const sum = summarize(await fredSeries(s.id));
      if (!sum) { warns.push(`${s.id}: no data`); continue; }
      const chgWeek = sum.prevWeek != null ? +(sum.value - sum.prevWeek).toFixed(3) : null;
      const chgMonth = sum.prevMonth != null ? +(sum.value - sum.prevMonth).toFixed(3) : null;
      // risk direction of the latest move: does the week's change favour risk assets?
      let riskDir = null;
      if (chgWeek != null && chgWeek !== 0) {
        const rising = chgWeek > 0;
        riskDir = (s.riskOnWhenFalling ? !rising : rising) ? 'risk-on' : 'risk-off';
      }
      out.indicators.push({
        id: s.id, label: s.label, unit: s.unit,
        value: +sum.value.toFixed(s.unit === 'idx' ? 2 : 2),
        changeWeek: chgWeek, changeMonth: chgMonth,
        riskDir, note: s.note || null, asOf: sum.date,
      });
    } catch (e) { warns.push(`${s.id}: ${e.message}`); }
  }

  // ---- net liquidity ----
  try {
    const parts = {};
    for (const l of LIQUIDITY) {
      const rows = await fredSeries(l.id);
      if (rows.length) {
        const now = rows[rows.length - 1].v;
        const wk = valueDaysAgo(rows, 7) ?? now;
        parts[l.id] = { nowB: now * l.scaleToB, weekB: wk * l.scaleToB };
      }
    }
    if (parts.WALCL && parts.RRPONTSYD && parts.WTREGEN) {
      const net = parts.WALCL.nowB - parts.RRPONTSYD.nowB - parts.WTREGEN.nowB;
      const netPrev = parts.WALCL.weekB - parts.RRPONTSYD.weekB - parts.WTREGEN.weekB;
      out.netLiquidity = {
        valueB: Math.round(net),
        changeWeekB: Math.round(net - netPrev),
        read: net - netPrev >= 0 ? 'EXPANDING — tailwind for risk assets' : 'CONTRACTING — headwind for risk assets',
        components: {
          fedBalanceSheetB: Math.round(parts.WALCL.nowB),
          reverseRepoB: Math.round(parts.RRPONTSYD.nowB),
          treasuryAccountB: Math.round(parts.WTREGEN.nowB),
        },
      };
    } else warns.push('net liquidity: missing a component');
  } catch (e) { warns.push(`net liquidity: ${e.message}`); }

  out.warns = warns;

  if (!has('no-write')) {
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(join(OUT_DIR, `${out.date}.json`), JSON.stringify(out, null, 2));
  }
  if (has('json')) { process.stdout.write(JSON.stringify(out)); return; }

  const line = '─'.repeat(76);
  console.log(`\n${line}\nMACRO — RATES, DOLLAR & LIQUIDITY — ${out.date}\n${line}`);
  const arrow = (c) => c == null ? ' ' : c > 0 ? '▲' : c < 0 ? '▼' : '·';
  for (const i of out.indicators) {
    console.log(`  ${i.label.padEnd(18)} ${String(i.value).padStart(8)}${i.unit.padEnd(4)} ${arrow(i.changeWeek)} ${(i.changeWeek >= 0 ? '+' : '') + i.changeWeek}/wk`
      + (i.riskDir ? `   ${i.riskDir}` : '') + (i.note ? `   (${i.note})` : ''));
  }
  if (out.netLiquidity) {
    const n = out.netLiquidity;
    console.log(`\n  NET LIQUIDITY   $${(n.valueB / 1000).toFixed(2)}T   ${n.changeWeekB >= 0 ? '+' : ''}$${n.changeWeekB}B/wk   ${n.read}`);
    console.log(`    = Fed $${(n.components.fedBalanceSheetB / 1000).toFixed(2)}T − RRP $${n.components.reverseRepoB}B − TGA $${n.components.treasuryAccountB}B`);
  }
  if (warns.length) { console.log('\nWARNINGS:'); for (const w of warns) console.log(`  ! ${w}`); }
  console.log(line);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
