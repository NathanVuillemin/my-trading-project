#!/usr/bin/env node
// correlations.mjs: "who is driving" for the Trading Desk's Drivers page.
//
// For each link that normally holds (a currency against its real-world driver, gold against the dollar and
// real yields, Bitcoin against the Nasdaq): the 3-day correlation from hourly bars against its 2-year normal,
// the 20- and 60-day correlation from daily closes against their 5-year normal, whether the driver is in
// control (and since when), an early warning when the 3-day reading breaks, the typical size of the move,
// and how the link behaved by market regime. Plus the market regime itself (Nathan's VIX rule and the
// "where is money moving" barometer from Macro Tracker v5, with safe havens added).
// Spec: docs/superpowers/specs/2026-11-17-drivers-correlations-design.md. Maths: scripts/lib/corr-math.mjs.
//
// Sources, all keyless: Yahoo Finance (daily 6 years, hourly 2 years), FRED, central-bank 2Y yields
// (BoC, BoE, RBA, Japan MoF, Bundesbank), Global Dairy Trade.
// Usage: node scripts/correlations.mjs [--json]   |   npm run correlations
// Writes: dashboard/desk/data/correlations.json (page) + data/correlations/<YYYY-MM-DD>.json (slim archive)

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { yahooDaily, yahooHourly, fred, cb2y, gdt } from './lib/corr-sources.mjs';
import { buildRegime, buildLink } from './lib/corr-math.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const has = (n) => process.argv.includes(`--${n}`);

// Daily series: key -> source. kind 'yield' = correlate daily changes, else log returns.
const DAILY = {
  EURUSD: { y: 'EURUSD=X' }, GBPUSD: { y: 'GBPUSD=X' }, AUDUSD: { y: 'AUDUSD=X' }, NZDUSD: { y: 'NZDUSD=X' },
  USDJPY: { y: 'JPY=X' }, USDCHF: { y: 'CHF=X' }, USDCAD: { y: 'CAD=X' }, AUDJPY: { y: 'AUDJPY=X' },
  DXY: { y: 'DX-Y.NYB', label: 'Dollar index' }, GOLD: { y: 'GC=F', label: 'Gold' }, WTI: { y: 'CL=F', label: 'WTI oil' },
  COPPER: { y: 'HG=F', label: 'Copper' }, IRONORE: { y: 'TIO=F', label: 'Iron ore' }, TTF: { y: 'TTF=F', label: 'TTF gas' },
  USDCNY: { y: 'CNY=X', label: 'USDCNY (yuan)' }, SPX: { y: '^GSPC', label: 'S&P 500' }, NDX: { y: '^NDX', label: 'Nasdaq 100' },
  VIX: { y: '^VIX' }, BTC: { y: 'BTC-USD', label: 'Bitcoin' }, XLY: { y: 'XLY' }, XLP: { y: 'XLP' }, TLT: { y: 'TLT' },
  US2Y: { fred: 'DGS2', kind: 'yield', label: 'US 2Y yield' }, US10Y: { fred: 'DGS10', kind: 'yield', label: 'US 10Y yield' },
  REAL10Y: { fred: 'DFII10', kind: 'yield', label: 'US 10Y real yield' }, HY: { fred: 'BAMLH0A0HYM2', kind: 'yield', label: 'US high-yield spread' },
};
// Hourly series (2 years): same keys where a daily key has an hourly twin.
const HOURLY = {
  EURUSD: 'EURUSD=X', GBPUSD: 'GBPUSD=X', AUDUSD: 'AUDUSD=X', NZDUSD: 'NZDUSD=X', USDJPY: 'JPY=X', USDCHF: 'CHF=X',
  USDCAD: 'CAD=X', AUDJPY: 'AUDJPY=X', DXY: 'DX-Y.NYB', GOLD: 'GC=F', WTI: 'CL=F', COPPER: 'HG=F', SPX: '^GSPC',
  NDX: '^NDX', VIX: '^VIX', US10Y: '^TNX', BTC: 'BTC-USD',
};
const SPREADS = ['EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD']; // <CCY> 2Y minus US 2Y

// The links. typical = the usual sign of the correlation as quoted. story = the real-world reason.
const L = (group, target, driver, typical, story, extra = {}) => ({ id: `${target}-${driver}`.toLowerCase(), group, target, driver, typical, story, ...extra });
const LINKS = [
  L('USD', 'DXY', 'US2Y', 'positive', 'Dollar follows the expected Fed path.'),
  L('EUR', 'EURUSD', 'SPREAD_EUR', 'positive', 'Germany-US 2Y gap: what the market expects the ECB to do against the Fed.'),
  L('EUR', 'EURUSD', 'TTF', 'inverse', 'Europe imports its energy: dearer gas, weaker euro.'),
  L('GBP', 'GBPUSD', 'SPREAD_GBP', 'positive', 'Gilt-Treasury 2Y gap: Bank of England against the Fed.'),
  L('GBP', 'GBPUSD', 'SPX', 'positive', 'Sterling leans risk-on.'),
  L('JPY', 'USDJPY', 'US10Y', 'positive', 'Wider US-Japan yield gap lifts USDJPY.'),
  L('JPY', 'USDJPY', 'SPREAD_JPY', 'inverse', 'Japan-US 2Y gap: rising Japanese yields pull the yen up.'),
  L('JPY', 'USDJPY', 'WTI', 'positive', 'Japan imports its oil: dearer oil weakens the yen.'),
  L('JPY', 'AUDJPY', 'SPX', 'positive', 'Risk barometer: risk-on sells the yen.'),
  L('CHF', 'USDCHF', 'VIX', 'inverse', 'Fear pulls haven money into the franc.'),
  L('CHF', 'USDCHF', 'SPREAD_CHF', 'inverse', 'Swiss-US 2Y gap.'),
  L('CAD', 'USDCAD', 'WTI', 'inverse', "Oil is Canada's biggest export: oil up, CAD up."),
  L('CAD', 'USDCAD', 'SPREAD_CAD', 'inverse', 'Canada-US 2Y gap: Bank of Canada against the Fed.'),
  L('CAD', 'USDCAD', 'SPX', 'inverse', "The US is Canada's main customer: US growth lifts CAD."),
  L('AUD', 'AUDUSD', 'IRONORE', 'positive', "Iron ore is Australia's biggest export."),
  L('AUD', 'AUDUSD', 'COPPER', 'positive', 'Copper: China and global building demand.'),
  L('AUD', 'AUDUSD', 'USDCNY', 'inverse', "China is Australia's biggest customer: a firmer yuan lifts AUD."),
  L('AUD', 'AUDUSD', 'SPREAD_AUD', 'positive', 'Australia-US 2Y gap: RBA against the Fed.'),
  L('NZD', 'NZDUSD', 'GDT', 'positive', "Dairy is New Zealand's biggest export (Global Dairy Trade auctions, every two weeks).", { kind: 'level' }),
  L('NZD', 'NZDUSD', 'USDCNY', 'inverse', "China is New Zealand's biggest dairy customer."),
  L('NZD', 'NZDUSD', 'SPREAD_NZD', 'positive', 'New Zealand-US 2Y gap.'),
  L('NZD', 'NZDUSD', 'SPX', 'positive', 'The kiwi leans risk-on.'),
  L('Gold', 'GOLD', 'DXY', 'inverse', 'Gold is priced in dollars.'),
  L('Gold', 'GOLD', 'REAL10Y', 'inverse', 'Gold pays no yield: higher real yields raise the cost of holding it.'),
  L('Bitcoin', 'BTC', 'NDX', 'positive', 'Bitcoin trades as a high-beta risk asset.'),
];
const label = (k) => (k.startsWith('SPREAD_') ? `${k.slice(7)}-US 2Y spread` : DAILY[k]?.label || k);
const kindOf = (k) => (k.startsWith('SPREAD_') ? 'yield' : DAILY[k]?.kind || 'price');

async function main() {
  const daily = {}, hourly = {}, errors = [], missing = [];
  const tryGet = async (name, fn) => { try { return await fn(); } catch (e) { errors.push(`${name}: ${e.message}`); return null; } };
  const twoY = {};
  await Promise.all([
    ...Object.entries(DAILY).map(async ([k, s]) => { daily[k] = await tryGet(k, () => (s.fred ? fred(s.fred) : yahooDaily(s.y))); }),
    ...Object.entries(HOURLY).map(async ([k, sym]) => { hourly[k] = await tryGet(`${k} hourly`, () => yahooHourly(sym)); }),
    ...SPREADS.map(async (c) => { twoY[c] = await tryGet(`${c} 2Y`, () => cb2y(c)); }),
    (async () => { daily.GDT = await tryGet('GDT', () => gdt()); })(),
  ]);
  for (const c of SPREADS) {
    if (!twoY[c] || !daily.US2Y) { missing.push(`${c} 2Y yield (no free daily source)`); continue; }
    const m = new Map();
    for (const [d, v] of twoY[c]) if (daily.US2Y.has(d)) m.set(d, v - daily.US2Y.get(d));
    daily[`SPREAD_${c}`] = m;
  }
  for (const k of Object.keys(daily)) if (!daily[k]) delete daily[k];
  for (const k of Object.keys(hourly)) if (!hourly[k]) delete hourly[k];

  const regime = buildRegime({
    vix: daily.VIX, spx: daily.SPX, us2y: daily.US2Y, dxy: daily.DXY, audjpy: daily.AUDJPY, copper: daily.COPPER,
    gold: daily.GOLD, hy: daily.HY, xly: daily.XLY, xlp: daily.XLP, usdjpy: daily.USDJPY, usdchf: daily.USDCHF, tlt: daily.TLT,
  });

  const r2 = (x, d = 2) => (x == null ? null : Number(x.toFixed(d)));
  const links = LINKS.map((cfg) => {
    const base = { ...cfg, labelT: label(cfg.target), labelD: label(cfg.driver), kindT: kindOf(cfg.target), kindD: kindOf(cfg.driver) };
    if (cfg.kind === 'level') {
      const g = daily[cfg.driver];
      if (!g) return { ...base, status: 'no data' };
      const k = [...g.keys()].sort(), last = k.at(-1), ago = k.at(-7) ?? k[0];
      return { ...base, level: { value: g.get(last), asOf: last, chg3mPct: r2((g.get(last) / g.get(ago) - 1) * 100, 1), history: k.slice(-52).map((d) => [d, g.get(d)]) } };
    }
    const out = buildLink({ ...base, hT: HOURLY[cfg.target] ? cfg.target : null, hD: HOURLY[cfg.driver] ? cfg.driver : null }, daily, hourly, regime.byDate);
    delete out.hT; delete out.hD;
    return out;
  });

  const asOf = new Date().toISOString().slice(0, 10);
  const out = {
    asOf, generatedAt: new Date().toISOString(),
    method: 'Pearson correlation of moves (log returns; daily change for yields and spreads). 3 days = hourly moves over the last 3 trading days both traded (at least 18), against its 2-year normal. 20 and 60 days = daily moves, against their 5-year normal (10th-90th percentile band). In control: 20-day correlation, read in the link\'s usual direction, at 0.5 or more; not in control below 0.3; in between the state holds. Breaking: in control, but the 3-day reading below the bottom of its normal band.',
    sources: 'Yahoo Finance (daily, hourly); FRED (DGS2, DGS10, DFII10, BAMLH0A0HYM2); 2Y yields: Bank of Canada, Bank of England, RBA, Japan Ministry of Finance, Bundesbank; Global Dairy Trade.',
    missing, errors,
    regime: { ...regime.now, history: regime.history },
    links,
  };
  if (has('json')) { console.log(JSON.stringify(out, null, 2)); return; }
  const file = join(ROOT, 'dashboard', 'desk', 'data', 'correlations.json');
  writeFileSync(file, JSON.stringify(out) + '\n');
  mkdirSync(join(ROOT, 'data', 'correlations'), { recursive: true });
  const slim = { asOf, regime: { rule: regime.now.vix.rule, verdict: regime.now.verdict }, links: links.map((l) => ({ id: l.id, r3d: l.r3d?.r ?? null, r20: l.r20?.r ?? null, r60: l.r60?.r ?? null, state: l.state ?? null })) };
  writeFileSync(join(ROOT, 'data', 'correlations', `${asOf}.json`), JSON.stringify(slim, null, 2) + '\n');

  const rn = regime.now;
  console.log(`regime ${rn.asOf}: VIX ${rn.vix.value} -> ${rn.vix.rule}; barometer ${rn.verdict} (${rn.gauges.map((g) => `${g.key} ${g.read}`).join(', ')}); agree ${rn.agree}; rates ${rn.rates.split}; dollar ${rn.dollar.split}`);
  for (const l of links) {
    if (l.level) { console.log(`${l.id.padEnd(22)} level ${l.level.value} (${l.level.chg3mPct}% vs 6 auctions ago)`); continue; }
    if (l.status) { console.log(`${l.id.padEnd(22)} ${l.status}`); continue; }
    console.log(`${l.id.padEnd(22)} 3d ${String(l.r3d?.r ?? '-').padStart(5)} (n${l.r3d?.n ?? 0})  20d ${String(l.r20.r).padStart(5)}  60d ${String(l.r60.r).padStart(5)}  ${l.state} since ${l.since}${l.breaking ? ' BREAKING' : ''}${l.wrongWay ? ' wrong-way' : ''}`);
  }
  if (errors.length) console.error('Errors:\n  ' + errors.join('\n  '));
  const total = Object.keys(DAILY).length + Object.keys(HOURLY).length + SPREADS.length + 1;
  if (errors.length >= total / 2) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
