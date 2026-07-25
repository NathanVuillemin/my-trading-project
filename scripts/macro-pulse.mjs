#!/usr/bin/env node
// macro-pulse.mjs — the "where is capital positioned right now" layer, all free, no keys.
//
// Complements the existing feeds, which show WHO is trading (whale-flow, trust) and the
// SLOW institutional picture (COT, insiders). This adds the fast macro backdrop a daily/
// weekly thesis needs:
//
//   stablecoins — total stablecoin supply and its weekly change. Rising supply = capital
//                 sitting in crypto ready to deploy (dry powder); falling = capital leaving.
//                 The cleanest read on money entering/leaving the whole asset class.
//   options     — Deribit put/call open-interest ratio and total OI for BTC and ETH. A
//                 put-heavy book is defensive/hedged positioning; call-heavy is risk-seeking.
//   sentiment   — Fear & Greed (contrarian at extremes) plus BTC dominance (rising = risk-off
//                 inside crypto, money huddling in BTC; falling = risk-on rotation into alts).
//
// Each section is isolated: one dead source records a warning and the rest still write.
//
// Usage: node scripts/macro-pulse.mjs [--json]   |   npm run macro:pulse
// Writes: data/macro-pulse/<YYYY-MM-DD>.json

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dir, '..', 'data', 'macro-pulse');

const has = (n) => process.argv.includes(`--${n}`);
const jget = async (url, opts = {}) => {
  const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};
const num = (v) => { const n = +v; return isFinite(n) ? n : 0; };
const warns = [];

// ---------------------------------------------------------------- stablecoins
async function stablecoins() {
  const j = await jget('https://stablecoins.llama.fi/stablecoins?includePrices=false');
  const assets = j.peggedAssets || [];
  const usd = (a, k) => num(a?.[k]?.peggedUSD);
  const total = assets.reduce((s, a) => s + usd(a, 'circulating'), 0);
  const prevDay = assets.reduce((s, a) => s + usd(a, 'circulatingPrevDay'), 0);
  const prevWeek = assets.reduce((s, a) => s + usd(a, 'circulatingPrevWeek'), 0);
  const prevMonth = assets.reduce((s, a) => s + usd(a, 'circulatingPrevMonth'), 0);
  const top = assets
    .map(a => ({ sym: a.symbol, usd: usd(a, 'circulating'), weekChange: usd(a, 'circulating') - usd(a, 'circulatingPrevWeek') }))
    .sort((x, y) => y.usd - x.usd).slice(0, 6);
  const weekChange = total - prevWeek;
  return {
    totalUsd: Math.round(total),
    dayChangeUsd: Math.round(total - prevDay),
    weekChangeUsd: Math.round(weekChange),
    monthChangeUsd: Math.round(total - prevMonth),
    weekChangePct: prevWeek ? +(weekChange / prevWeek * 100).toFixed(2) : null,
    read: weekChange > 0 ? 'EXPANDING — capital entering crypto (dry powder building)'
      : 'CONTRACTING — capital leaving crypto',
    top,
  };
}

// ---------------------------------------------------------------- options positioning
async function optionsFor(currency) {
  const j = await jget(`https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=${currency}&kind=option`);
  const rows = j.result || [];
  let callOi = 0, putOi = 0, volUsd = 0, spot = 0;
  for (const r of rows) {
    const oi = num(r.open_interest);
    const isPut = /-P$/.test(r.instrument_name);
    if (isPut) putOi += oi; else callOi += oi;
    volUsd += num(r.volume_usd);
    if (r.underlying_price) spot = num(r.underlying_price);
  }
  const totalOi = callOi + putOi;
  return {
    currency,
    putCallOi: callOi ? +(putOi / callOi).toFixed(2) : null,
    totalOiCoins: Math.round(totalOi),
    totalOiUsd: Math.round(totalOi * spot),
    dayVolumeUsd: Math.round(volUsd),
    read: callOi && putOi / callOi > 1 ? 'defensive — put-heavy (hedged/bearish)'
      : 'risk-seeking — call-heavy',
  };
}

// ---------------------------------------------------------------- sentiment
async function sentiment() {
  const [fng, cg] = await Promise.all([
    jget('https://api.alternative.me/fng/?limit=1'),
    jget('https://api.coingecko.com/api/v3/global'),
  ]);
  const f = fng.data?.[0] || {};
  const d = cg.data || {};
  const btcDom = num(d.market_cap_percentage?.btc);
  return {
    fngValue: num(f.value),
    fngClass: f.value_classification || null,
    btcDominance: +btcDom.toFixed(2),
    ethDominance: +num(d.market_cap_percentage?.eth).toFixed(2),
    totalMcapUsd: Math.round(num(d.total_market_cap?.usd)),
    mcapChange24hPct: +num(d.market_cap_change_percentage_24h_usd).toFixed(2),
    // Fear & Greed is a contrarian tool at the extremes, not a trend-follower.
    fngRead: num(f.value) <= 25 ? 'extreme fear — contrarian buy zone'
      : num(f.value) >= 75 ? 'extreme greed — contrarian caution' : 'neutral',
  };
}

// ---------------------------------------------------------------- main
(async () => {
  const out = { date: new Date().toISOString().slice(0, 10), generatedAt: new Date().toISOString() };

  try { out.stablecoins = await stablecoins(); }
  catch (e) { warns.push(`stablecoins: ${e.message}`); }

  out.options = [];
  for (const c of ['BTC', 'ETH']) {
    try { out.options.push(await optionsFor(c)); }
    catch (e) { warns.push(`options ${c}: ${e.message}`); }
  }

  try { out.sentiment = await sentiment(); }
  catch (e) { warns.push(`sentiment: ${e.message}`); }

  out.warns = warns;

  if (!has('no-write')) {
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(join(OUT_DIR, `${out.date}.json`), JSON.stringify(out, null, 2));
  }
  if (has('json')) { process.stdout.write(JSON.stringify(out)); return; }

  const line = '─'.repeat(72);
  const B = (n) => (n >= 0 ? '+$' : '-$') + (Math.abs(n) / 1e9).toFixed(2) + 'B';
  console.log(`\n${line}\nMACRO PULSE — ${out.date}\n${line}`);
  if (out.stablecoins) {
    const s = out.stablecoins;
    console.log(`\nSTABLECOIN SUPPLY (dry powder): $${(s.totalUsd / 1e9).toFixed(1)}B`);
    console.log(`  week ${B(s.weekChangeUsd)} (${s.weekChangePct}%)   month ${B(s.monthChangeUsd)}   day ${B(s.dayChangeUsd)}`);
    console.log(`  ${s.read}`);
    console.log(`  top: ${s.top.map(t => `${t.sym} $${(t.usd / 1e9).toFixed(1)}B (${B(t.weekChange)}/wk)`).join(', ')}`);
  }
  if (out.options?.length) {
    console.log(`\nOPTIONS POSITIONING (Deribit):`);
    for (const o of out.options) {
      console.log(`  ${o.currency}  put/call OI ${o.putCallOi}   OI $${(o.totalOiUsd / 1e9).toFixed(2)}B   ${o.read}`);
    }
  }
  if (out.sentiment) {
    const s = out.sentiment;
    console.log(`\nSENTIMENT:`);
    console.log(`  Fear & Greed ${s.fngValue} (${s.fngClass}) — ${s.fngRead}`);
    console.log(`  BTC dominance ${s.btcDominance}%   ETH ${s.ethDominance}%   total mcap $${(s.totalMcapUsd / 1e12).toFixed(2)}T (${s.mcapChange24hPct}% 24h)`);
  }
  if (warns.length) { console.log('\nWARNINGS:'); for (const w of warns) console.log(`  ! ${w}`); }
  console.log(line);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
