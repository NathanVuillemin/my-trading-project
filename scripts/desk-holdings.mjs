#!/usr/bin/env node
// desk-holdings.mjs: the slow official data behind the desk's "Yields & Holdings" page.
// Writes dashboard/desk/data/holdings.json.
//
//   yields  Government 2-year yield per currency, last ~400 days, so the page can show the yield gap of any pair
//           and whether it backs the pair (the Macro Tracker's rule: gap moved 10bp or more its way over a month).
//           Daily: FRED (US), Bundesbank (EUR), Bank of England, Japan Ministry of Finance, Bank of Canada, RBA.
//           CHF is monthly (SNB month averages); NZD has no free source (RBNZ blocks scripts).
//   tic     Major foreign holders of US Treasuries, by country, last 13 months (US Treasury TIC table 5).
//   gold    Central-bank gold holdings by country in tonnes, last 25 months (IMF International Liquidity, RGV_REVS).
//   cofer   World reserve-currency shares, last 16 quarters (IMF COFER).
//
// Every block is fetched on its own; a failure is recorded in `warns` and the other blocks still publish.
// Usage: node scripts/desk-holdings.mjs [--out path]

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fred, cb2y } from './lib/corr-sources.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1]; };
const OUT = arg('out', join(__dir, '..', 'dashboard', 'desk', 'data', 'holdings.json'));
const UA = { 'User-Agent': 'Mozilla/5.0 (my-trading-project desk)' };
const IMF = 'https://api.imf.org/external/sdmx/2.1';
const CSV = { Accept: 'application/vnd.sdmx.data+csv;version=1.0.0' };
const TONNE_OZ = 32150.7466;
const warns = [];

const get = async (url, headers = {}) => {
  const r = await fetch(url, { headers: { ...UA, ...headers }, signal: AbortSignal.timeout(90000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url.split('?')[0]}`);
  return r.text();
};
const monthsAgo = (n) => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - n); return d.toISOString().slice(0, 7); };
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
// SDMX CSV with dataonly detail has no quoted multi-line fields, so a plain split is safe.
const sdmxRows = (text) => {
  const [head, ...lines] = text.trim().split('\n');
  const cols = head.split(',');
  return lines.map((l) => Object.fromEntries(l.split(',').map((v, i) => [cols[i], v])));
};
const block = async (name, fn) => {
  try { return await fn(); } catch (e) { warns.push(`${name}: ${e.message}`); console.warn(`! ${name}: ${e.message}`); return null; }
};

// ---------- 2Y yields ----------
async function snbChf2y() {
  const t = await get('https://data.snb.ch/api/cube/rendeiduebm/data/csv/en');
  const out = new Map();
  for (const line of t.split('\n')) {
    const m = line.match(/^"(\d{4}-\d{2})";"CHF";"2J";"([-\d.]+)"/);
    if (m) {
      const [y, mo] = m[1].split('-').map(Number);
      out.set(new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10), +m[2]); // month average, dated month end
    }
  }
  if (!out.size) throw new Error('SNB CHF 2Y: empty');
  return out;
}

async function yields() {
  const since = daysAgo(400), ccys = {};
  const src = {
    USD: ['FRED DGS2', 'daily', () => fred('DGS2', 2)], EUR: ['Bundesbank (German 2Y)', 'daily', () => cb2y('EUR')],
    GBP: ['Bank of England', 'daily', () => cb2y('GBP')], JPY: ['Japan Ministry of Finance', 'daily', () => cb2y('JPY')],
    CAD: ['Bank of Canada', 'daily', () => cb2y('CAD')], AUD: ['RBA', 'daily', () => cb2y('AUD')],
    CHF: ['SNB (month average)', 'monthly', snbChf2y],
  };
  await Promise.all(Object.entries(src).map(async ([c, [source, freq, fn]]) => {
    const m = await block(`${c} 2Y`, fn);
    if (!m) { ccys[c] = { source, freq, missing: `${source} unavailable today` }; return; }
    const pts = [...m].filter(([d]) => d >= (freq === 'monthly' ? daysAgo(800) : since)).sort(([a], [b]) => (a < b ? -1 : 1));
    ccys[c] = { source, freq, dates: pts.map(([d]) => d), values: pts.map(([, v]) => +v.toFixed(3)) };
  }));
  ccys.NZD = { source: 'none', freq: 'none', missing: 'No free 2Y source: the RBNZ blocks automated downloads.' };
  return ccys;
}

// ---------- TIC: major foreign holders of Treasuries ----------
async function tic() {
  const t = await get('https://ticdata.treasury.gov/resource-center/data-chart-center/tic/Documents/slt_table5.txt');
  const lines = t.split('\n').map((l) => l.replace(/\r$/, '').split('\t'));
  const head = lines.find((c) => c[0] === 'Country');
  if (!head) throw new Error('TIC: no header row');
  const months = head.slice(1).filter(Boolean);
  const holders = [];
  for (const c of lines.slice(lines.indexOf(head) + 1)) {
    const vals = c.slice(1, months.length + 1).map((v) => (v.trim() === '' ? null : +v));
    if (c[0]?.trim() && vals.some((v) => Number.isFinite(v))) holders.push({ country: c[0].trim(), values: vals });
  }
  if (holders.length < 10) throw new Error(`TIC: only ${holders.length} rows`);
  return { asOf: months[0], unit: 'USD bn', months, holders };
}

// ---------- IMF: gold holdings by country ----------
async function countryNames() {
  const x = await get(`${IMF}/codelist/IMF/CL_COUNTRY/latest`);
  const names = {};
  for (const m of x.matchAll(/<str:Code id="([^"]+)"[^>]*>([\s\S]*?)<\/str:Code>/g)) {
    const n = m[2].match(/<com:Name xml:lang="en">([^<]*)/);
    if (n) names[m[1]] = n[1].replace(/&amp;/g, '&').replace(/, [^,]*Republic of( China)?$|, Kingdom of( the)?$|, State of$|, The$/, '');
  }
  return { ...names, EZB: 'European Central Bank', TWN: 'Taiwan' };
}

async function gold() {
  const [text, names] = await Promise.all([
    get(`${IMF}/data/IMF.STA,IL,latest/.RGV_REVS.FTO.M?startPeriod=${monthsAgo(26).replace('-', '-M')}&detail=dataonly`, CSV),
    block('IMF country names', countryNames),
  ]);
  const by = {};
  for (const r of sdmxRows(text)) {
    if (!r.OBS_VALUE || !/^[A-Z]{3}$/.test(r.COUNTRY) || r.COUNTRY === 'IMF' || r.COUNTRY === 'BIS') continue; // countries only: no aggregates, no IMF or BIS (BIS gold is largely central-bank deposits)
    (by[r.COUNTRY] ||= []).push([r.TIME_PERIOD.replace('-M', '-'), +r.OBS_VALUE / TONNE_OZ]);
  }
  const countries = Object.entries(by).map(([code, pts]) => {
    pts.sort(([a], [b]) => (a < b ? -1 : 1));
    return { code, name: names?.[code] || code, months: pts.map(([m]) => m), tonnes: pts.map(([, v]) => +v.toFixed(1)) };
  }).filter((c) => c.tonnes.at(-1) > 0).sort((a, b) => b.tonnes.at(-1) - a.tonnes.at(-1));
  if (countries.length < 30) throw new Error(`IMF gold: only ${countries.length} countries`);
  return { asOf: countries.map((c) => c.months.at(-1)).sort().at(-1), unit: 'tonnes', countries };
}

// ---------- IMF: COFER reserve-currency shares ----------
async function cofer() {
  const text = await get(`${IMF}/data/IMF.STA,COFER,latest/G001.AFXRA..SHRO_PT.Q?startPeriod=${new Date().getUTCFullYear() - 4}&detail=dataonly`, CSV);
  const shares = {}, qs = new Set();
  for (const r of sdmxRows(text)) {
    const c = r.FXR_CURRENCY?.replace('CI_', '');
    if (!c || !r.OBS_VALUE) continue;
    (shares[c] ||= {})[r.TIME_PERIOD] = +(+r.OBS_VALUE).toFixed(2);
    qs.add(r.TIME_PERIOD);
  }
  const quarters = [...qs].sort().slice(-16);
  if (!shares.USD) throw new Error('COFER: no USD share');
  return { asOf: quarters.at(-1), unit: '% of allocated reserves', quarters, shares: Object.fromEntries(Object.entries(shares).map(([c, m]) => [c, quarters.map((q) => m[q] ?? null)])) };
}

// ---------- write ----------
const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
const [y, t, g, c] = await Promise.all([block('yields', yields), block('tic', tic), block('gold', gold), block('cofer', cofer)]);
const out = {
  generatedAt: new Date().toISOString(),
  sources: 'FRED, Bundesbank, Bank of England, Japan MoF, Bank of Canada, RBA, SNB (2Y yields); US Treasury TIC table 5; IMF International Liquidity (gold, fine troy ounces); IMF COFER.',
  // A block that failed today keeps yesterday's copy rather than vanishing.
  yields: y || prev.yields || null, tic: t || prev.tic || null, gold: g || prev.gold || null, cofer: c || prev.cofer || null,
  warns,
};
writeFileSync(OUT, JSON.stringify(out) + '\n');
console.log(`Wrote ${OUT}`);
console.log(`yields: ${Object.entries(out.yields || {}).map(([k, v]) => `${k} ${v.values?.at(-1) ?? 'missing'}`).join(', ')}`);
console.log(`tic ${out.tic?.asOf} (${out.tic?.holders.length} rows) · gold ${out.gold?.asOf} (${out.gold?.countries.length} countries) · cofer ${out.cofer?.asOf}`);
if (warns.length) console.log(`warnings: ${warns.join(' | ')}`);
