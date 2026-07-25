#!/usr/bin/env node
// macro-flows.mjs — aggregate institutional positioning that needs no wallet identity.
//
// Two free, official sources:
//   1. CFTC Commitments of Traders (weekly)  — commodities, FX, index and CME crypto futures.
//      Splits open interest into commercial hedgers (physical-side), large speculators
//      (managed money / trend followers) and small traders.
//   2. CoinMetrics Community API (daily)     — crypto exchange in/outflows and supply held
//      on exchanges.
//
// Why these rather than more wallet tracking: both are AGGREGATE. There is no address to
// label, so the "one wrong tag poisons the analysis" failure mode cannot occur. They also
// match a multi-month horizon, where a weekly or daily cadence is fine.
//
// The signal is NOT the raw position. It is where that position sits inside its own history —
// the COT index (percentile over a lookback). A commercial net long of 100k contracts means
// nothing alone; at the 95th percentile of three years it means something.
//
// Usage:
//   node scripts/macro-flows.mjs            # COT + exchange flows
//   node scripts/macro-flows.mjs --years 3  # COT lookback for the percentile
//   node scripts/macro-flows.mjs --json

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dir, '..', 'data', 'macro-flows');

// Two CFTC reports, because the informative trader category differs by market type.
//   legacy (6dca-aqww): commercials = producers/merchants/processors — the physical side.
//                       The right lens for commodities.
//   TFF    (gpe5-46if): splits financial futures into dealer / asset manager / leveraged
//                       funds. For FX and indices the legacy "commercial" bucket mixes
//                       dealers (hedging flow, not opinion) with real money, so reading it
//                       as conviction is misleading. Asset managers vs leveraged funds is
//                       the meaningful split there.
const COT_LEGACY = 'https://publicreporting.cftc.gov/resource/6dca-aqww.json';
const COT_TFF = 'https://publicreporting.cftc.gov/resource/gpe5-46if.json';
const CM = 'https://community-api.coinmetrics.io/v4/timeseries/asset-metrics';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); if (i === -1) return d; const v = process.argv[i + 1]; return v && !v.startsWith('--') ? v : true; };
const has = (n) => process.argv.includes(`--${n}`);
const num = (v) => { const n = +v; return isFinite(n) ? n : 0; };
const jget = (u) => fetch(u, { headers: { 'User-Agent': 'my-trading-project research' }, signal: AbortSignal.timeout(30000) }).then(r => {
  if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json();
});
const fmtK = (n) => (n >= 0 ? '+' : '-') + Math.abs(Math.round(n)).toLocaleString('en-US');
const fmtM = (n) => (n >= 0 ? '+$' : '-$') + (Math.abs(n) / 1e6).toFixed(1) + 'M';

// Markets to track. `match` is resolved against the live CFTC market list at runtime, so a
// venue renaming a contract surfaces as an unresolved warning instead of silently vanishing.
const MARKETS = [
  { label: 'GOLD', cls: 'COMMOD', match: /^GOLD - COMMODITY EXCHANGE/i },
  { label: 'SILVER', cls: 'COMMOD', match: /^SILVER - COMMODITY EXCHANGE/i },
  { label: 'COPPER', cls: 'COMMOD', match: /^COPPER- ?#1|^COPPER - COMMODITY/i },
  { label: 'PLATINUM', cls: 'COMMOD', match: /^PLATINUM - NEW YORK/i },
  { label: 'WTI CRUDE', cls: 'COMMOD', match: /^WTI FINANCIAL CRUDE OIL - NEW YORK/i },
  { label: 'NATGAS', cls: 'COMMOD', match: /^NAT GAS NYME|^NATURAL GAS - NEW YORK/i },
  { label: 'WHEAT', cls: 'COMMOD', match: /^WHEAT-SRW - CHICAGO/i },
  { label: 'CORN', cls: 'COMMOD', match: /^CORN - CHICAGO/i },
  { label: 'SOYBEANS', cls: 'COMMOD', match: /^SOYBEANS - CHICAGO/i },
  { label: 'EUR', cls: 'FX', match: /^EURO FX - CHICAGO/i },
  { label: 'JPY', cls: 'FX', match: /^JAPANESE YEN - CHICAGO/i },
  { label: 'GBP', cls: 'FX', match: /^BRITISH POUND - CHICAGO/i },
  { label: 'CHF', cls: 'FX', match: /^SWISS FRANC - CHICAGO/i },
  { label: 'CAD', cls: 'FX', match: /^CANADIAN DOLLAR - CHICAGO/i },
  { label: 'AUD', cls: 'FX', match: /^AUSTRALIAN DOLLAR - CHICAGO/i },
  // No dollar-index contract is published in either CFTC dataset, so it is deliberately
  // absent rather than fuzzy-matched onto something else.
  { label: 'S&P 500', cls: 'INDEX', match: /^E-MINI S&P 500 - CHICAGO/i },
  { label: 'NASDAQ 100', cls: 'INDEX', match: /^NASDAQ-100 Consolidated/i },
  { label: 'BITCOIN', cls: 'CRYPTO', match: /^BITCOIN - CHICAGO/i },
  { label: 'ETHER', cls: 'CRYPTO', match: /^ETHER - CHICAGO|^MICRO ETHER - CHICAGO/i },
];

// Percentile of `v` within `arr` — 0 = lowest in the window, 100 = highest. This is the
// COT index: it makes contracts of wildly different size comparable to each other.
function percentile(arr, v) {
  if (!arr.length) return null;
  const below = arr.filter(x => x <= v).length;
  return Math.round(below / arr.length * 100);
}

// FX and index futures read from TFF; everything else from the legacy report.
const reportFor = (cls) => (cls === 'FX' || cls === 'INDEX') ? 'tff' : 'legacy';
const urlFor = (report) => report === 'tff' ? COT_TFF : COT_LEGACY;

async function resolveMarkets() {
  const since = new Date(Date.now() - 200 * 864e5).toISOString().slice(0, 10);
  const names = {};
  for (const report of ['legacy', 'tff']) {
    const url = `${urlFor(report)}?$select=market_and_exchange_names&$where=report_date_as_yyyy_mm_dd>'${since}'&$group=market_and_exchange_names&$limit=1500`;
    names[report] = (await jget(url)).map(r => r.market_and_exchange_names);
  }
  const resolved = [], unresolved = [];
  for (const m of MARKETS) {
    const report = reportFor(m.cls);
    const hits = names[report].filter(n => m.match.test(n));
    if (!hits.length) { unresolved.push(`${m.label} (${report})`); continue; }
    // Shortest name is the primary contract; longer ones are spreads/micros/variants.
    hits.sort((a, b) => a.length - b.length);
    resolved.push({ ...m, name: hits[0], report });
  }
  return { resolved, unresolved, totalMarkets: names.legacy.length + names.tff.length };
}

async function fetchCot(mkt, years) {
  const since = new Date(Date.now() - years * 365 * 864e5).toISOString().slice(0, 10);
  // Market names contain characters that are structural in a URL — "E-MINI S&P 500" has an
  // ampersand, "COPPER- #1" a hash. encodeURI leaves both intact and the query silently
  // truncates, so the parameter value must be encodeURIComponent'd individually.
  const where = `market_and_exchange_names='${mkt.name.replace(/'/g, "''")}' AND report_date_as_yyyy_mm_dd>'${since}'`;
  const url = `${urlFor(mkt.report)}?$where=${encodeURIComponent(where)}`
    + `&$order=${encodeURIComponent('report_date_as_yyyy_mm_dd DESC')}&$limit=400`;
  const rows = await jget(url);
  if (!rows.length) return null;

  // Every trader category is tagged by what its flow MEANS, because the two kinds of
  // information are read completely differently:
  //
  //   role: 'hedging'    — flow driven by an obligation, not a view. Dealers intermediating
  //                        and producers locking in prices. This does NOT forecast direction;
  //                        it marks where size is being absorbed, i.e. where liquidity sits
  //                        and price is likely to react.
  //   role: 'conviction' — someone chose to be long or short. Directional intent.
  //                        Split slow (asset managers, multi-month) from fast (hedge funds,
  //                        crowded and prone to squeeze).
  //   role: 'noise'      — small non-reportable traders. Retail. Included for completeness.
  //
  // Commercials are the awkward case: their flow is hedging by nature, but they hold the best
  // information about physical supply and demand, so it is tagged 'hedging-informed' and read
  // as both — a liquidity marker AND a slow signal.
  const GROUPS = mkt.report === 'tff'
    ? [
      { key: 'dealer', name: 'dealers', role: 'hedging', long: 'dealer_positions_long_all', short: 'dealer_positions_short_all' },
      { key: 'assetMgr', name: 'asset managers', role: 'conviction-slow', long: 'asset_mgr_positions_long', short: 'asset_mgr_positions_short' },
      { key: 'levFunds', name: 'leveraged funds', role: 'conviction-fast', long: 'lev_money_positions_long', short: 'lev_money_positions_short' },
      { key: 'other', name: 'other reportable', role: 'noise', long: 'other_rept_positions_long', short: 'other_rept_positions_short' },
    ]
    : [
      { key: 'commercial', name: 'commercials', role: 'hedging-informed', long: 'comm_positions_long_all', short: 'comm_positions_short_all' },
      { key: 'largeSpec', name: 'large specs', role: 'conviction-fast', long: 'noncomm_positions_long_all', short: 'noncomm_positions_short_all' },
      { key: 'small', name: 'small traders', role: 'noise', long: 'nonrept_positions_long_all', short: 'nonrept_positions_short_all' },
    ];

  const series = rows.map(r => {
    const o = { date: String(r.report_date_as_yyyy_mm_dd).slice(0, 10), oi: num(r.open_interest_all) };
    for (const g of GROUPS) o[g.key] = num(r[g.long]) - num(r[g.short]);
    return o;
  });

  const latest = series[0], prev = series[1] || null;
  const groups = GROUPS.map(g => ({
    key: g.key, name: g.name, role: g.role,
    net: latest[g.key],
    change: prev ? latest[g.key] - prev[g.key] : null,
    index: percentile(series.map(s => s[g.key]), latest[g.key]),
    // Gross size relative to open interest — how much of the market this group holds.
    // A large hedging book is what makes a level matter.
    shareOfOi: latest.oi > 0 ? Math.abs(latest[g.key]) / latest.oi * 100 : null,
  }));

  const pick = (role) => groups.find(g => g.role === role) || null;
  const hedger = pick('hedging') || pick('hedging-informed');
  const slow = pick('conviction-slow') || pick('hedging-informed');
  const fast = pick('conviction-fast');

  return {
    label: mkt.label, cls: mkt.cls, market: mkt.name, report: mkt.report,
    date: latest.date, weeks: series.length, oi: latest.oi,
    groups,
    // Convenience handles for the two readings.
    hedging: hedger, conviction: slow, fast,
    history: series.slice(0, 52).reverse().map(s => [s.date, s[GROUPS[0].key], s[GROUPS[1].key]]),
  };
}

async function fetchExchangeFlows(assets = ['btc', 'eth']) {
  const metrics = ['FlowInExUSD', 'FlowOutExUSD', 'SplyExNtv', 'CapMVRVCur'];
  const url = `${CM}?assets=${assets.join(',')}&metrics=${metrics.join(',')}&frequency=1d&page_size=10000`;
  const j = await jget(url);
  const byAsset = {};
  for (const row of (j.data || [])) {
    (byAsset[row.asset] ||= []).push({
      time: row.time.slice(0, 10),
      inUsd: num(row.FlowInExUSD),
      outUsd: num(row.FlowOutExUSD),
      splyEx: num(row.SplyExNtv),
      mvrv: num(row.CapMVRVCur),
      // CoinMetrics marks recent values "flash" (preliminary, subject to revision).
      flash: row['FlowOutExUSD-status'] === 'flash',
    });
  }
  const out = [];
  for (const [asset, rows] of Object.entries(byAsset)) {
    rows.sort((a, b) => a.time.localeCompare(b.time));
    const netOf = (r) => r.outUsd - r.inUsd;     // positive = leaving exchanges = accumulation
    const last = rows[rows.length - 1];
    const sum = (n) => rows.slice(-n).reduce((s, r) => s + netOf(r), 0);
    const splyChange = (n) => {
      const a = rows[rows.length - 1 - n], b = last;
      return (a && b && a.splyEx) ? (b.splyEx - a.splyEx) / a.splyEx * 100 : null;
    };
    out.push({
      asset: asset.toUpperCase(),
      date: last.time,
      flash: last.flash,
      net1d: netOf(last),
      net7d: sum(7),
      net30d: sum(30),
      supplyOnExchanges: last.splyEx,
      supplyChange30dPct: splyChange(30),
      mvrv: last.mvrv,
      // Direction of the 30d flow, stated in plain terms.
      read: sum(30) > 0 ? 'ACCUMULATION (net leaving exchanges)' : 'DISTRIBUTION (net arriving on exchanges)',
      history: rows.slice(-90).map(r => [r.time, Math.round(netOf(r))]),
    });
  }
  return out;
}

(async () => {
  const years = Number(arg('years', 3));
  const asJson = has('json');
  const log = (...a) => { if (!asJson) console.log(...a); };

  log('Resolving CFTC markets...');
  const { resolved, unresolved, totalMarkets } = await resolveMarkets();
  log(`  matched ${resolved.length}/${MARKETS.length} of ${totalMarkets} active markets`
    + (unresolved.length ? `  |  UNRESOLVED: ${unresolved.join(', ')}` : ''));

  log(`Fetching ${years}y COT history...`);
  const cot = [];
  const warns = [];
  if (unresolved.length) warns.push(`COT markets not matched (contract renamed?): ${unresolved.join(', ')}`);
  for (const m of resolved) {
    try { const r = await fetchCot(m, years); if (r) cot.push(r); else warns.push(`${m.label}: no COT rows`); }
    catch (e) { warns.push(`${m.label}: ${e.message}`); }
  }

  log('Fetching exchange flows...');
  let flows = [];
  try { flows = await fetchExchangeFlows(); }
  catch (e) { warns.push(`exchange flows: ${e.message}`); }

  // Two separate readings, because they answer different questions.
  //
  // CONVICTION extremes: directional money at the edge of its own range. A view.
  const convictionExtremes = cot
    .filter(c => c.conviction?.index != null && (c.conviction.index >= 80 || c.conviction.index <= 20))
    .map(c => ({
      label: c.label, cls: c.cls, group: c.conviction.name,
      index: c.conviction.index, net: c.conviction.net,
      fastIndex: c.fast?.index ?? null, fastGroup: c.fast?.name ?? null,
      dir: c.conviction.index >= 80 ? 'LONG' : 'SHORT',
      // Slow money and fast money at opposite extremes — the classic squeeze setup.
      opposed: c.fast?.index != null && Math.abs(c.conviction.index - c.fast.index) >= 60,
    }))
    .sort((a, b) => Math.abs(b.index - 50) - Math.abs(a.index - 50));

  // HEDGING concentration: not a direction call. Large hedging books mark where size is
  // being absorbed — the levels price is most likely to react around.
  const hedgingZones = cot
    .filter(c => c.hedging?.shareOfOi != null)
    .map(c => ({
      label: c.label, cls: c.cls, group: c.hedging.name,
      net: c.hedging.net, index: c.hedging.index,
      shareOfOi: c.hedging.shareOfOi,
      change: c.hedging.change,
      // Hedgers adding aggressively into a level is the absorption signal.
      building: c.hedging.change != null && Math.abs(c.hedging.change) > Math.abs(c.hedging.net) * 0.1,
    }))
    .sort((a, b) => b.shareOfOi - a.shareOfOi);

  const payload = {
    date: new Date().toISOString().slice(0, 10),
    generatedAt: new Date().toISOString(),
    cotLookbackYears: years,
    cot, flows, convictionExtremes, hedgingZones, warns,
  };

  if (!has('no-write')) {
    mkdirSync(OUT_DIR, { recursive: true });
    const p = join(OUT_DIR, `${payload.date}.json`);
    writeFileSync(p, JSON.stringify(payload, null, 2));
    log(`\nSnapshot written: ${p}`);
  }
  if (asJson) { process.stdout.write(JSON.stringify(payload)); return; }

  const line = '─'.repeat(86);

  // ---- 1. CONVICTION: directional intent ----
  console.log(`\n${line}\n1. CONVICTION — directional positioning vs own ${years}y range (index 0-100)\n${line}`);
  console.log('Someone chose this exposure. Slow = asset managers / commercials (multi-month).');
  console.log('Fast = leveraged funds / large specs (crowded, squeeze-prone).\n');
  console.log('market        cls        slow net  idx      fast net  idx   weekly Δ');
  for (const c of cot.sort((a, b) => a.cls.localeCompare(b.cls) || a.label.localeCompare(b.label))) {
    const s = c.conviction, f = c.fast;
    if (!s) continue;
    const mark = (s.index >= 80 || s.index <= 20) ? ' ★' : '';
    console.log(
      `${c.label.padEnd(13)} ${c.cls.padEnd(7)}${fmtK(s.net).padStart(12)} ${String(s.index).padStart(4)}`
      + `${fmtK(f ? f.net : 0).padStart(14)} ${String(f ? f.index : '—').padStart(4)}`
      + `${(s.change == null ? 'n/a' : fmtK(s.change)).padStart(11)}${mark}`);
  }

  if (convictionExtremes.length) {
    console.log(`\n★ CONVICTION EXTREMES:`);
    for (const e of convictionExtremes) {
      console.log(`  ${e.label.padEnd(13)} ${e.cls.padEnd(7)} ${e.group} net ${e.dir} at idx ${e.index}`
        + (e.opposed ? `  ⚡ ${e.fastGroup} opposed (idx ${e.fastIndex}) — squeeze setup` : ''));
    }
  } else console.log('\nNo conviction extremes right now.');

  // ---- 2. HEDGING: liquidity location, not direction ----
  console.log(`\n${line}\n2. HEDGING — where size is absorbed (NOT a direction call)\n${line}`);
  console.log('Obligation-driven flow. Large books mark levels where price is likely to react.');
  console.log('Note: in commodities the commercials line appears in BOTH sections by design — their');
  console.log('flow is hedging, but they hold the best physical supply/demand information.\n');
  console.log('market        cls       hedger net   %OI   idx   weekly Δ   building?');
  for (const h of hedgingZones) {
    console.log(
      `${h.label.padEnd(13)} ${h.cls.padEnd(7)}${fmtK(h.net).padStart(12)}`
      + `${h.shareOfOi.toFixed(0).padStart(6)}%${String(h.index).padStart(6)}`
      + `${(h.change == null ? 'n/a' : fmtK(h.change)).padStart(11)}   ${h.building ? 'YES — adding fast' : ''}`);
  }

  console.log(`\n${line}\nCRYPTO EXCHANGE FLOWS  (positive = coins LEAVING exchanges = accumulation)\n${line}`);
  for (const f of flows) {
    console.log(`${f.asset.padEnd(5)} 1d ${fmtM(f.net1d).padStart(10)}   7d ${fmtM(f.net7d).padStart(10)}   30d ${fmtM(f.net30d).padStart(11)}`
      + `   supply on exch ${(f.supplyChange30dPct == null ? 'n/a' : (f.supplyChange30dPct >= 0 ? '+' : '') + f.supplyChange30dPct.toFixed(2) + '% 30d').padStart(14)}`
      + `   MVRV ${f.mvrv ? f.mvrv.toFixed(2) : 'n/a'}${f.flash ? '  [flash]' : ''}`);
    console.log(`      ${f.read}`);
  }

  if (warns.length) {
    console.log('\nNOTES:');
    for (const w of warns) console.log(`  ! ${w}`);
  }
  console.log(line);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
