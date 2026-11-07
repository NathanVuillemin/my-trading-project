#!/usr/bin/env node
// fred-macro.mjs — fill the macro-stats lane of the bias engine from FRED.
//
// Pulls the macro numbers FRED is authoritative for (core CPI, unemployment, US 2Y,
// 10Y real yield, Fed target, VIX, S&P) and merges them INTO data/bias/inputs.json,
// touching only the fields it sources. PMI, ICE DXY and foreign 2Y/policy rates are
// NOT on FRED — they stay as they are (TradingView / manual) and are listed as gaps.
//
// Division of labour (brain: Macro Tracker): market inputs = TradingView; macro stats /
// real yield = FRED. Uses FRED's KEYLESS fredgraph.csv endpoint (same as rates.mjs) —
// no API key needed.
//
// Usage: node scripts/fred-macro.mjs [--dry] [--json]   |   npm run bias:fred
// Writes: data/bias/inputs.json  +  data/bias/history/<date>.json

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const BIAS_DIR = join(__dir, "..", "data", "bias");
const INPUTS = join(BIAS_DIR, "inputs.json");
const has = (n) => process.argv.includes(`--${n}`);

const warns = [];

async function fredSeries(id, days = 520) {
  const cosd = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const r = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${cosd}`,
    { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const rows = (await r.text()).trim().split(/\r?\n/).slice(1)
    .map((l) => { const [d, v] = l.split(","); return { d, v: v === "." || v === "" ? null : +v }; })
    .filter((x) => x.v !== null && Number.isFinite(x.v));
  if (!rows.length) throw new Error("no observations");
  return rows; // ascending by date
}

const last = (rows) => rows[rows.length - 1];
const nBack = (rows, n) => (rows.length > n ? rows[rows.length - 1 - n] : null);
const round = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

function valueDaysAgo(rows, days) {
  const target = new Date(last(rows).d).getTime() - days * 864e5;
  let pick = rows[0];
  for (const r of rows) { if (new Date(r.d).getTime() <= target) pick = r; else break; }
  return pick;
}

async function tryPull(id, days, label) {
  try { return await fredSeries(id, days); }
  catch (e) { warns.push(`${label} (${id}): ${e.message}`); return null; }
}

// Reject a series whose newest observation is older than maxAgeDays (discontinued /
// stale feed). Writing stale numbers as "current" is the worst failure mode here.
function fresh(rows, maxAgeDays, label) {
  if (!rows) return null;
  const age = (Date.now() - new Date(last(rows).d).getTime()) / 864e5;
  if (age > maxAgeDays) { warns.push(`${label}: STALE — last obs ${last(rows).d} (${Math.round(age)}d old) > ${maxAgeDays}d, skipped`); return null; }
  return rows;
}
const DAILY_MAX = 10, MONTHLY_MAX = 100;

async function main() {
  const input = JSON.parse(readFileSync(INPUTS, "utf8"));
  input.currencies ??= {};
  input.gold ??= {};
  input.risk ??= {};
  const sources = {};
  const set = (path, value, series, obsDate) => {
    if (value === null || !Number.isFinite(value)) return;
    const [obj, key] = path;
    obj[key] = value;
    sources[`${path[2]}`] = { series, obsDate };
  };

  // ── US block ──
  const cpi = fresh(await tryPull("CPILFESL", 560, "US core CPI"), MONTHLY_MAX, "US core CPI");
  if (cpi && cpi.length > 15) {
    const yoy = (i) => round((cpi[i].v / cpi[i - 12].v - 1) * 100, 2);
    const li = cpi.length - 1;
    input.currencies.USD ??= {};
    set([input.currencies.USD, "coreCPI", "USD.coreCPI"], yoy(li), "CPILFESL", cpi[li].d);
    set([input.currencies.USD, "coreCPI3moAgo", "USD.coreCPI3moAgo"], yoy(li - 3), "CPILFESL", cpi[li - 3].d);
  }
  const unrate = fresh(await tryPull("UNRATE", 400, "US unemployment"), MONTHLY_MAX, "US unemployment");
  if (unrate) {
    input.currencies.USD ??= {};
    set([input.currencies.USD, "unemployment", "USD.unemployment"], round(last(unrate).v, 1), "UNRATE", last(unrate).d);
    const u3 = nBack(unrate, 3);
    if (u3) set([input.currencies.USD, "unemployment3moAgo", "USD.unemployment3moAgo"], round(u3.v, 1), "UNRATE", u3.d);
  }
  const dgs2 = fresh(await tryPull("DGS2", 120, "US 2Y"), DAILY_MAX, "US 2Y");
  if (dgs2) {
    input.currencies.USD ??= {};
    set([input.currencies.USD, "twoYearYield", "USD.twoYearYield"], round(last(dgs2).v, 2), "DGS2", last(dgs2).d);
    const a = valueDaysAgo(dgs2, 30);
    set([input.currencies.USD, "twoYearYield1moAgo", "USD.twoYearYield1moAgo"], round(a.v, 2), "DGS2", a.d);
  }
  const fedtar = fresh(await tryPull("DFEDTARU", 120, "Fed target"), DAILY_MAX, "Fed target");
  if (fedtar) { input.currencies.USD ??= {}; set([input.currencies.USD, "policyRate", "USD.policyRate"], round(last(fedtar).v, 2), "DFEDTARU", last(fedtar).d); }

  // ── Gold real yield (US 10Y real, DFII10). DXY stays TradingView (ICE, not FRED). ──
  const dfii = fresh(await tryPull("DFII10", 120, "10Y real yield"), DAILY_MAX, "10Y real yield");
  if (dfii) {
    set([input.gold, "realYield", "gold.realYield"], round(last(dfii).v, 2), "DFII10", last(dfii).d);
    const a = valueDaysAgo(dfii, 30);
    set([input.gold, "realYield1moAgo", "gold.realYield1moAgo"], round(a.v, 2), "DFII10", a.d);
  }

  // ── Risk block (VIX, S&P + 200d MA) ──
  const vix = fresh(await tryPull("VIXCLS", 60, "VIX"), DAILY_MAX, "VIX");
  if (vix) set([input.risk, "vix", "risk.vix"], round(last(vix).v, 2), "VIXCLS", last(vix).d);
  const spx = fresh(await tryPull("SP500", 420, "S&P 500"), DAILY_MAX, "S&P 500");
  if (spx) {
    set([input.risk, "sp500", "risk.sp500"], round(last(spx).v, 2), "SP500", last(spx).d);
    const window = spx.slice(-200).map((r) => r.v);
    if (window.length >= 150) set([input.risk, "sp500_200dma", "risk.sp500_200dma"], round(window.reduce((a, b) => a + b, 0) / window.length, 2), "SP500 (200d avg)", last(spx).d);
  }

  // ── Foreign unemployment (OECD harmonized, monthly, lagged) ──
  const foreignU = { EUR: "LRHUTTTTEZM156S", GBP: "LMUNRRTTGBM156S", JPY: "LRUN64TTJPM156S" };
  for (const [ccy, id] of Object.entries(foreignU)) {
    const rows = fresh(await tryPull(id, 500, `${ccy} unemployment`), MONTHLY_MAX, `${ccy} unemployment`);
    if (rows) {
      input.currencies[ccy] ??= {};
      set([input.currencies[ccy], "unemployment", `${ccy}.unemployment`], round(last(rows).v, 1), id, last(rows).d);
      const a3 = nBack(rows, 3);
      if (a3) set([input.currencies[ccy], "unemployment3moAgo", `${ccy}.unemployment3moAgo`], round(a3.v, 1), id, a3.d);
    }
  }

  // ── Gaps: fields FRED does not source (left as-is, filled by TradingView/manual) ──
  const gaps = [
    "USD/EUR/GBP/JPY compositePMI (S&P Global — TradingView)",
    "gold.dxy + dxy1moAgo (ICE DXY — TradingView, FRED broad index differs)",
    "EUR/GBP/JPY coreCPI + 3moAgo (patchy on FRED — manual/TradingView)",
    "EUR/GBP/JPY twoYearYield + 1moAgo (foreign 2Y — TradingView)",
    "EUR/GBP/JPY policyRate (manual)",
  ];

  input.asOf = new Date().toISOString().slice(0, 10);
  input._sources = sources;
  input._gaps = gaps;
  input._updatedBy = "fred-macro.mjs";

  const sourced = Object.keys(sources);
  console.log(`FRED pull: ${sourced.length} fields updated` + (warns.length ? `, ${warns.length} warnings` : ""));
  for (const k of sourced) console.log(`  ${k.padEnd(24)} ${JSON.stringify(input._sources[k])}`);
  if (warns.length) { console.log("Warnings:"); for (const w of warns) console.log(`  ! ${w}`); }
  console.log(`Gaps left for TradingView/manual: ${gaps.length} (see _gaps).`);

  if (has("json")) console.log(JSON.stringify(input, null, 2));
  if (has("dry")) { console.log("\n--dry: nothing written."); return; }

  writeFileSync(INPUTS, JSON.stringify(input, null, 2) + "\n");
  const histDir = join(BIAS_DIR, "history");
  mkdirSync(histDir, { recursive: true });
  writeFileSync(join(histDir, `${input.asOf}.json`), JSON.stringify(input, null, 2) + "\n");
  console.log(`\nWritten: ${INPUTS}  +  data/bias/history/${input.asOf}.json`);
}

main().catch((e) => { console.error("fred-macro failed:", e.message); process.exit(1); });
