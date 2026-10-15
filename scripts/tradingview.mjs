#!/usr/bin/env node
// tradingview.mjs — market inputs for the Macro Tracker, from TradingView.
//
// One request to TradingView's scanner endpoint (the same feed the site's screener uses)
// returns the latest close, the 1-month % change and the 200-day SMA for every symbol the
// tracker needs: FX pairs, gold, the dollar index, 2Y yields, VIX, the S&P 500 and the
// risk-barometer ETFs. KEYLESS — no login, no session token (verified 2026-10-15). FX,
// yields, DXY and gold stream real-time; US stocks/indices are 10–15 min delayed, which is
// fine for a weekly macro sheet.
//
// "1 month ago" is derived from TradingView's own Perf.1M: prev = close / (1 + Perf.1M/100).
// For yields Perf.1M is the % change of the yield itself, so the bp move is close − prev.
//
// What this does NOT cover: macro statistics (CPI, jobs, PMI) — TradingView's ECONOMICS
// series use different definitions than the Sources sheet (e.g. Japan core vs core-core,
// ECB refi vs deposit rate), so those stay on the official sources. US 10Y real yield and
// the HY credit spread stay on FRED (rates.mjs) — TradingView has no equivalent series.
//
// Usage: node scripts/tradingview.mjs [--json] [--no-write]   |   npm run tradingview
// Writes: data/tradingview/<YYYY-MM-DD>.json

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dir, '..', 'data', 'tradingview');
const has = (n) => process.argv.includes(`--${n}`);

// key = name used in the output (and by the workbook update), kind = how to read the move.
const SYMBOLS = [
  { key: 'EURUSD', tv: 'FX:EURUSD', kind: 'price' },
  { key: 'GBPUSD', tv: 'FX:GBPUSD', kind: 'price' },
  { key: 'USDJPY', tv: 'FX:USDJPY', kind: 'price' },
  { key: 'AUDJPY', tv: 'FX:AUDJPY', kind: 'price', note: 'risk barometer: rising = risk-on' },
  { key: 'XAUUSD', tv: 'OANDA:XAUUSD', kind: 'price' },
  { key: 'NAS100', tv: 'NASDAQ:NDX', kind: 'price' },
  { key: 'DXY', tv: 'TVC:DXY', kind: 'price', note: 'ICE US Dollar Index' },
  { key: 'US02Y', tv: 'TVC:US02Y', kind: 'yield' },
  { key: 'DE02Y', tv: 'TVC:DE02Y', kind: 'yield', note: 'EUR 2Y proxy (German Schatz)' },
  { key: 'GB02Y', tv: 'TVC:GB02Y', kind: 'yield' },
  { key: 'JP02Y', tv: 'TVC:JP02Y', kind: 'yield' },
  { key: 'VIX', tv: 'TVC:VIX', kind: 'price' },
  { key: 'SPX', tv: 'SP:SPX', kind: 'price' },
  { key: 'XLY', tv: 'AMEX:XLY', kind: 'price' },
  { key: 'XLP', tv: 'AMEX:XLP', kind: 'price' },
  { key: 'CPER', tv: 'AMEX:CPER', kind: 'price' },
  { key: 'GLD', tv: 'AMEX:GLD', kind: 'price' },
];
const COLUMNS = ['close', 'Perf.1M', 'Perf.W', 'SMA200', 'update_mode'];

const round = (x, d) => (x == null || !isFinite(x) ? null : +x.toFixed(d));
const prevFromPerf = (close, perf) => (close == null || perf == null ? null : close / (1 + perf / 100));
const warns = [];

async function scan() {
  const r = await fetch('https://scanner.tradingview.com/global/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
    body: JSON.stringify({ symbols: { tickers: SYMBOLS.map(s => s.tv) }, columns: COLUMNS }),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  return Object.fromEntries((j.data || []).map(x => [x.s, Object.fromEntries(COLUMNS.map((c, i) => [c, x.d[i]]))]));
}

// 1-month % change between two series, for the ratio gauges (XLY÷XLP, CPER÷GLD).
function ratioPerf(a, b) {
  if (!a || !b || a.prevMonth == null || b.prevMonth == null) return null;
  return round(((a.value / b.value) / (a.prevMonth / b.prevMonth) - 1) * 100, 2);
}
const readPct = (pct, cut = 1) => pct == null ? null : pct > cut ? 'RISK-ON' : pct < -cut ? 'RISK-OFF' : 'NEUTRAL';

(async () => {
  const out = { date: new Date().toISOString().slice(0, 10), generatedAt: new Date().toISOString(), source: 'TradingView scanner', symbols: {} };
  let raw = {};
  try { raw = await scan(); } catch (e) { console.error('FAILED:', e.message); process.exit(1); }

  for (const s of SYMBOLS) {
    const d = raw[s.tv];
    if (!d || d.close == null) { warns.push(`${s.key} (${s.tv}): no data`); continue; }
    const prev = prevFromPerf(d.close, d['Perf.1M']);
    const dp = s.kind === 'yield' ? 3 : d.close < 10 ? 5 : 2;
    out.symbols[s.key] = {
      tv: s.tv, kind: s.kind,
      value: round(d.close, dp),
      prevMonth: round(prev, dp),
      changeMonthPct: round(d['Perf.1M'], 2),
      changeMonthBp: s.kind === 'yield' && prev != null ? round((d.close - prev) * 100, 1) : undefined,
      changeWeekPct: round(d['Perf.W'], 2),
      sma200: s.kind === 'price' ? round(d.SMA200, dp) : undefined,
      feed: d.update_mode,
      note: s.note,
    };
  }

  // Hub risk barometer — same fixed rules as the workbook's Sources sheet (1-month change, ±1%).
  const S = out.symbols;
  const xlyXlp = ratioPerf(S.XLY, S.XLP);
  const cperGld = ratioPerf(S.CPER, S.GLD);
  out.barometer = {
    AUDJPY: { changeMonthPct: S.AUDJPY?.changeMonthPct ?? null, read: readPct(S.AUDJPY?.changeMonthPct) },
    CPER_GLD: { changeMonthPct: cperGld, read: readPct(cperGld) },
    XLY_XLP: { changeMonthPct: xlyXlp, read: readPct(xlyXlp) },
  };
  out.warns = warns;

  if (!has('no-write')) {
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(join(OUT_DIR, `${out.date}.json`), JSON.stringify(out, null, 2));
  }
  if (has('json')) { process.stdout.write(JSON.stringify(out)); return; }

  const line = '─'.repeat(76);
  console.log(`\n${line}\nTRADINGVIEW — MACRO TRACKER MARKET INPUTS — ${out.date}\n${line}`);
  for (const [k, v] of Object.entries(S)) {
    const move = v.kind === 'yield' ? `${v.changeMonthBp >= 0 ? '+' : ''}${v.changeMonthBp} bp/1M` : `${v.changeMonthPct >= 0 ? '+' : ''}${v.changeMonthPct}%/1M`;
    console.log(`  ${k.padEnd(8)} ${String(v.value).padStart(11)}   1M ago ${String(v.prevMonth).padStart(11)}   ${move.padEnd(14)}`
      + (v.sma200 ? `  200d ${v.sma200}` : '') + (v.feed !== 'streaming' ? `  [${v.feed}]` : ''));
  }
  console.log('\n  BAROMETER');
  for (const [k, v] of Object.entries(out.barometer)) console.log(`    ${k.padEnd(9)} ${String(v.changeMonthPct).padStart(6)}%   ${v.read}`);
  if (warns.length) { console.log('\nWARNINGS:'); for (const w of warns) console.log(`  ! ${w}`); }
  console.log(line);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
