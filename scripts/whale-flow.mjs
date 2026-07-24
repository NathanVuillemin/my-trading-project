#!/usr/bin/env node
// whale-flow.mjs — daily whale directional-flow collector + outlier flagger for Hyperliquid.
//
// What it does:
//   1. Pulls the top-N traders from the Hyperliquid global leaderboard (by 30D PnL).
//   2. Fetches each trader's fills over a time window (default last 24h).
//   3. Aggregates NET DIRECTIONAL FLOW (buy pressure - sell pressure) per coin, per
//      asset class, and per wallet, splitting "new risk opened" from total signed flow.
//   4. Persists the daily snapshot to data/whale-flow/<YYYY-MM-DD>.json
//      (per-coin net + top wallet drivers + asset-class rollup).
//   5. Loads prior snapshots, builds a rolling baseline (mean + std) per coin, and flags
//      outlier days where |today's net flow| exceeds BOTH mean + k*std AND an absolute $ floor.
//      Flagged coins list the wallets that drove the move.
//
// Usage:
//   node scripts/whale-flow.mjs                 # collect last 24h, write snapshot, print report
//   node scripts/whale-flow.mjs --hours 24      # window length
//   node scripts/whale-flow.mjs --top 150       # how many leaderboard wallets
//   node scripts/whale-flow.mjs --no-write      # dry run, don't persist
//   node scripts/whale-flow.mjs --date 2026-07-24   # label the snapshot (default: today UTC)
//   node scripts/whale-flow.mjs --json          # print machine-readable JSON (for the dashboard)
//
// Notes:
//   - Outlier flags only become meaningful after ~2 weeks of history (cold start builds baseline).
//   - Requires Node 18+ (global fetch).

import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------- config ----------
const CFG = {
  top: 150,            // leaderboard wallets to scan
  hours: 24,           // flow window
  concurrency: 8,      // parallel fill requests
  lookbackDays: 20,    // baseline window for z-score
  k: 2.0,              // z-score threshold
  floorUsd: 5_000_000, // absolute $ floor for a coin flag
  classFloorUsd: 15_000_000, // absolute $ floor for an asset-class rollup flag
  minTradersForConsensus: 4, // wallets same side same day to tag "consensus"
  topDriversPerCoin: 6, // wallet contributors stored per coin
};

const API = 'https://api.hyperliquid.xyz/info';
const LEADERBOARD = 'https://stats-data.hyperliquid.xyz/Mainnet/leaderboard';

const __dir = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dir, '..', 'data', 'whale-flow');

// ---------- asset-class map ----------
const FX = new Set(['DXY', 'EUR', 'GBP', 'JPY', 'KRW', 'NOK']);
const COMMOD = new Set(['GOLD', 'SILVER', 'PLATINUM', 'PALLADIUM', 'COPPER', 'ALUMINIUM', 'CL',
  'BRENTOIL', 'NATGAS', 'TTF', 'WHEAT', 'CORN', 'URANIUM', 'URNM', 'XLE']);
const INDEX = new Set(['SP500', 'XYZ100', 'VIX', 'VOL', 'NIFTY', 'JP225', 'KR200', 'IBOV',
  'EWY', 'EWJ', 'EWT', 'EWZ', 'SMH']);
const CLASSES = ['CRYPTO', 'STOCK', 'INDEX', 'COMMOD', 'FX'];
const classOf = (raw) => {
  const c = raw.replace(/^xyz:/, '');
  if (FX.has(c)) return 'FX';
  if (COMMOD.has(c)) return 'COMMOD';
  if (INDEX.has(c)) return 'INDEX';
  // crypto perps live on the main dex without a prefix; xyz: prefix => equities/other
  return raw.startsWith('xyz:') ? 'STOCK' : 'CRYPTO';
};
const cleanCoin = (raw) => raw.replace(/^xyz:/, '');
const short = (a) => a.slice(0, 6) + '…' + a.slice(-4);

// ---------- helpers ----------
const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
};
const post = async (body) => {
  const r = await fetch(API, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`info ${body.type} -> HTTP ${r.status}`);
  return r.json();
};
const pool = async (items, n, fn) => {
  const out = [];
  for (let i = 0; i < items.length; i += n) {
    out.push(...await Promise.all(items.slice(i, i + n).map(fn)));
  }
  return out;
};
const fmt = (n) => (n >= 0 ? '+$' : '-$') + (Math.abs(n) / 1e6).toFixed(2) + 'M';
const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const std = (a) => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); };

// ---------- collect ----------
async function collect() {
  const top = Number(arg('top', CFG.top));
  const hours = Number(arg('hours', CFG.hours));
  const quiet = arg('json', false) !== false;
  const log = (...a) => { if (!quiet) console.log(...a); };
  const endTime = Date.now();
  const startTime = endTime - hours * 3600_000;

  log(`Fetching leaderboard, top ${top} by 30D PnL...`);
  const lb = await (await fetch(LEADERBOARD)).json();
  const rows = lb.leaderboardRows || lb;
  const monthPnl = (x) => {
    const w = (x.windowPerformances || []).find(p => p[0] === 'month');
    return +(w?.[1]?.pnl || 0);
  };
  const addrs = rows
    .map(x => ({ a: x.ethAddress, p: monthPnl(x) }))
    .sort((a, b) => b.p - a.p)
    .slice(0, top)
    .map(x => x.a);

  log(`Pulling ${hours}h fills for ${addrs.length} wallets...`);
  // coin -> { net, opened, bulls:Set, bears:Set, wallets: Map(addr->signed) }
  const agg = {};
  const bump = (coin, signed, isOpen, addr) => {
    const k = cleanCoin(coin);
    const e = agg[k] || (agg[k] = {
      coin: k, cls: classOf(coin), net: 0, opened: 0,
      bulls: new Set(), bears: new Set(), wallets: new Map(),
    });
    e.net += signed;
    if (isOpen) e.opened += signed;
    (signed >= 0 ? e.bulls : e.bears).add(addr);
    e.wallets.set(addr, (e.wallets.get(addr) || 0) + signed);
  };

  let ok = 0;
  await pool(addrs, CFG.concurrency, async (a) => {
    let fills;
    try {
      fills = await post({ type: 'userFillsByTime', user: a, startTime, endTime });
    } catch { return; }
    ok++;
    for (const f of (fills || [])) {
      if (typeof f.coin === 'string' && f.coin.startsWith('@')) continue; // skip spot index pairs
      const notional = Math.abs(+f.sz) * +f.px;
      if (!isFinite(notional) || notional < 1000) continue; // ignore dust fills
      const signed = (f.side === 'B' ? 1 : -1) * notional; // buy = bullish, sell = bearish
      const isOpen = typeof f.dir === 'string' && f.dir.startsWith('Open');
      bump(f.coin, signed, isOpen, a);
    }
  });
  log(`Got fills for ${ok}/${addrs.length} wallets.`);

  // per-coin shape, with top wallet drivers (attribution)
  const coins = Object.values(agg).map(e => {
    const drivers = [...e.wallets.entries()]
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .slice(0, CFG.topDriversPerCoin)
      .map(([a, usd]) => ({ w: short(a), addr: a, usd: Math.round(usd) }));
    return {
      coin: e.coin, cls: e.cls,
      net: Math.round(e.net), opened: Math.round(e.opened),
      bulls: e.bulls.size, bears: e.bears.size,
      drivers,
    };
  }).sort((a, b) => Math.abs(b.net) - Math.abs(a.net));

  // asset-class rollup
  const rollup = Object.fromEntries(CLASSES.map(c => [c, { net: 0, buy: 0, sell: 0, coins: 0 }]));
  for (const c of coins) {
    const r = rollup[c.cls];
    r.net += c.net; r.coins++;
    if (c.net >= 0) r.buy += c.net; else r.sell += c.net;
  }
  for (const c of CLASSES) { rollup[c].net = Math.round(rollup[c].net); rollup[c].buy = Math.round(rollup[c].buy); rollup[c].sell = Math.round(rollup[c].sell); }

  return {
    date: String(arg('date', new Date().toISOString().slice(0, 10))),
    generatedAt: new Date().toISOString(),
    window_hours: hours,
    wallets_scanned: addrs.length,
    wallets_with_fills: ok,
    rollup,
    coins,
  };
}

// ---------- baseline + flag ----------
function baselineSeries(todayDate) {
  if (!existsSync(DATA_DIR)) return { coin: {}, cls: {} };
  const files = readdirSync(DATA_DIR).filter(f => f.endsWith('.json') && f !== `${todayDate}.json`).sort();
  const recent = files.slice(-CFG.lookbackDays).map(f => {
    try { return JSON.parse(readFileSync(join(DATA_DIR, f), 'utf8')); } catch { return null; }
  }).filter(Boolean);
  const coin = {}, cls = {};
  for (const snap of recent) {
    for (const c of (snap.coins || [])) (coin[c.coin] ||= []).push(c.net);
    for (const [k, v] of Object.entries(snap.rollup || {})) (cls[k] ||= []).push(v.net);
  }
  return { coin, cls };
}

function flag(today) {
  const base = baselineSeries(today.date);

  // per-coin flags
  const coinFlags = [];
  for (const c of today.coins) {
    const series = base.coin[c.coin] || [];
    const passFloor = Math.abs(c.net) >= CFG.floorUsd;
    let z = null, passZ = false;
    if (series.length >= 5) {
      const m = mean(series), s = std(series) || 1;
      z = (c.net - m) / s;
      passZ = Math.abs(z) >= CFG.k;
    } else {
      passZ = passFloor; // cold start: floor only
    }
    if (passFloor && passZ) {
      coinFlags.push({
        coin: c.coin, cls: c.cls, net: c.net,
        dir: c.net >= 0 ? 'BULLISH' : 'BEARISH',
        z: z == null ? null : +z.toFixed(1),
        baselineDays: series.length,
        consensus: (c.net >= 0 ? c.bulls : c.bears) >= CFG.minTradersForConsensus,
        drivers: c.drivers,
      });
    }
  }
  coinFlags.sort((a, b) => Math.abs(b.net) - Math.abs(a.net));

  // asset-class rollup flags
  const classFlags = [];
  for (const [k, v] of Object.entries(today.rollup)) {
    const series = base.cls[k] || [];
    const passFloor = Math.abs(v.net) >= CFG.classFloorUsd;
    let z = null, passZ = false;
    if (series.length >= 5) {
      const m = mean(series), s = std(series) || 1;
      z = (v.net - m) / s;
      passZ = Math.abs(z) >= CFG.k;
    } else {
      passZ = passFloor;
    }
    if (passFloor && passZ) {
      classFlags.push({ cls: k, net: v.net, dir: v.net >= 0 ? 'BULLISH' : 'BEARISH', z: z == null ? null : +z.toFixed(1), baselineDays: series.length });
    }
  }
  classFlags.sort((a, b) => Math.abs(b.net) - Math.abs(a.net));

  return { coinFlags, classFlags };
}

// ---------- report ----------
function report(today, flags) {
  const line = '─'.repeat(64);
  console.log(`\n${line}\nWHALE FLOW — ${today.date}  (${today.window_hours}h, ${today.wallets_with_fills} wallets)\n${line}`);

  // asset-class rollup
  console.log('\nASSET-CLASS FLOW (net = buy pressure − sell pressure):');
  for (const c of CLASSES) {
    const r = today.rollup[c];
    const fl = flags.classFlags.find(f => f.cls === c);
    console.log(`  ${c.padEnd(6)} ${fmt(r.net).padStart(11)}  (${r.coins} mkts)${fl ? `  🚩 ${fl.dir} z=${fl.z ?? 'n/a'}` : ''}`);
  }

  // coin outliers
  if (!flags.coinFlags.length) {
    console.log('\nNo per-coin outliers flagged (need history + a move past the $ floor).');
  } else {
    console.log('\n🚩 COIN OUTLIERS (broke baseline AND $ floor):');
    for (const f of flags.coinFlags) {
      const tag = f.consensus ? ' [CONSENSUS]' : '';
      const zs = f.z == null ? '(cold start, floor only)' : `z=${f.z}, ${f.baselineDays}d base`;
      console.log(`  ${f.dir.padEnd(7)} ${f.coin.padEnd(9)} ${fmt(f.net).padStart(11)}  ${f.cls.padEnd(6)} ${zs}${tag}`);
      const drv = f.drivers.map(d => `${d.w} ${fmt(d.usd)}`).join(', ');
      console.log(`          drivers: ${drv}`);
    }
  }

  // context
  console.log('\nTop net flows today (context):');
  for (const c of today.coins.slice(0, 12)) {
    console.log(`  ${(c.net >= 0 ? 'buy ' : 'sell').padEnd(4)} ${c.coin.padEnd(9)} ${fmt(c.net).padStart(11)}  ${c.cls.padEnd(6)} (${c.bulls}L/${c.bears}S)`);
  }
  console.log(line);
}

// ---------- main ----------
(async () => {
  const today = await collect();
  const flags = flag(today);
  const asJson = arg('json', false) !== false;

  if (arg('no-write', false) === false) {
    mkdirSync(DATA_DIR, { recursive: true });
    const path = join(DATA_DIR, `${today.date}.json`);
    // fold flags into the persisted snapshot so the dashboard can read them directly
    writeFileSync(path, JSON.stringify({ ...today, flags }, null, 2));
    if (!asJson) console.log(`\nSnapshot written: ${path}`);
  }

  if (asJson) process.stdout.write(JSON.stringify({ ...today, flags }));
  else report(today, flags);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
