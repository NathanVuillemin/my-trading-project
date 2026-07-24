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
  // coin -> aggregate. Two very different quantities are tracked deliberately:
  //   net    = all signed flow (opens AND closes)
  //   opened = signed flow from OPENING fills only — i.e. genuinely new risk
  // These routinely point in OPPOSITE directions: a market rallying on whales closing
  // shorts shows net BUYING while the fresh risk being put on is new SHORTS. Flagging on
  // `net` therefore reports the direction of new positioning backwards. Flags use `opened`.
  const agg = {};
  const bump = (coin, signed, isOpen, addr) => {
    const k = cleanCoin(coin);
    const e = agg[k] || (agg[k] = {
      coin: k, cls: classOf(coin), net: 0, opened: 0,
      bulls: new Set(), bears: new Set(),
      wallets: new Map(), walletsOpened: new Map(),
    });
    e.net += signed;
    e.wallets.set(addr, (e.wallets.get(addr) || 0) + signed);
    if (isOpen) {
      e.opened += signed;
      // Bull/bear wallet counts describe NEW risk, so they follow opening fills too.
      (signed >= 0 ? e.bulls : e.bears).add(addr);
      e.walletsOpened.set(addr, (e.walletsOpened.get(addr) || 0) + signed);
    }
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

  // per-coin shape. Drivers are attributed on OPENING flow, matching what flags fire on.
  const coins = Object.values(agg).map(e => {
    const drivers = [...e.walletsOpened.entries()]
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .slice(0, CFG.topDriversPerCoin)
      .map(([a, usd]) => ({ w: short(a), addr: a, usd: Math.round(usd) }));
    const net = Math.round(e.net), opened = Math.round(e.opened);
    return {
      coin: e.coin, cls: e.cls,
      net, opened,
      closing: net - opened,                 // net closing flow, the remainder
      // True when closes dominate and drag `net` opposite to actual new risk.
      divergent: opened !== 0 && Math.sign(net) !== Math.sign(opened),
      bulls: e.bulls.size, bears: e.bears.size,
      drivers,
    };
  }).sort((a, b) => Math.abs(b.opened) - Math.abs(a.opened));

  // asset-class rollup — carries both measures for the same reason.
  const rollup = Object.fromEntries(CLASSES.map(c => [c, { net: 0, opened: 0, buy: 0, sell: 0, coins: 0 }]));
  for (const c of coins) {
    const r = rollup[c.cls];
    r.net += c.net; r.opened += c.opened; r.coins++;
    if (c.opened >= 0) r.buy += c.opened; else r.sell += c.opened;
  }
  for (const c of CLASSES) {
    const r = rollup[c];
    r.net = Math.round(r.net); r.opened = Math.round(r.opened);
    r.buy = Math.round(r.buy); r.sell = Math.round(r.sell);
  }

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
  // Baselines are built on `opened` (new risk) to match what the flags test.
  // Snapshots written before that change may lack `opened`; fall back to `net` for those
  // so old history still contributes rather than silently reading as zero.
  const coin = {}, cls = {};
  for (const snap of recent) {
    for (const c of (snap.coins || [])) (coin[c.coin] ||= []).push(c.opened ?? c.net);
    for (const [k, v] of Object.entries(snap.rollup || {})) (cls[k] ||= []).push(v.opened ?? v.net);
  }
  return { coin, cls };
}

function flag(today) {
  const base = baselineSeries(today.date);

  // per-coin flags — tested on `opened` (new risk), not `net`.
  const coinFlags = [];
  for (const c of today.coins) {
    const series = base.coin[c.coin] || [];
    const value = c.opened;
    const passFloor = Math.abs(value) >= CFG.floorUsd;
    let z = null, passZ = false;
    if (series.length >= 5) {
      const m = mean(series), s = std(series) || 1;
      z = (value - m) / s;
      passZ = Math.abs(z) >= CFG.k;
    } else {
      passZ = passFloor; // cold start: floor only
    }
    if (passFloor && passZ) {
      coinFlags.push({
        coin: c.coin, cls: c.cls,
        opened: value, net: c.net, closing: c.closing,
        dir: value >= 0 ? 'BULLISH' : 'BEARISH',
        // Loud marker for the case that motivated this: headline flow says one thing,
        // new risk says the other.
        divergent: c.divergent,
        z: z == null ? null : +z.toFixed(1),
        baselineDays: series.length,
        consensus: (value >= 0 ? c.bulls : c.bears) >= CFG.minTradersForConsensus,
        drivers: c.drivers,
      });
    }
  }
  coinFlags.sort((a, b) => Math.abs(b.opened) - Math.abs(a.opened));

  // asset-class rollup flags
  const classFlags = [];
  for (const [k, v] of Object.entries(today.rollup)) {
    const series = base.cls[k] || [];
    const value = v.opened;
    const passFloor = Math.abs(value) >= CFG.classFloorUsd;
    let z = null, passZ = false;
    if (series.length >= 5) {
      const m = mean(series), s = std(series) || 1;
      z = (value - m) / s;
      passZ = Math.abs(z) >= CFG.k;
    } else {
      passZ = passFloor;
    }
    if (passFloor && passZ) {
      classFlags.push({
        cls: k, opened: value, net: v.net,
        dir: value >= 0 ? 'BULLISH' : 'BEARISH',
        divergent: value !== 0 && Math.sign(v.net) !== Math.sign(value),
        z: z == null ? null : +z.toFixed(1), baselineDays: series.length,
      });
    }
  }
  classFlags.sort((a, b) => Math.abs(b.opened) - Math.abs(a.opened));

  return { coinFlags, classFlags };
}

// ---------- report ----------
function report(today, flags) {
  const line = '─'.repeat(64);
  console.log(`\n${line}\nWHALE FLOW — ${today.date}  (${today.window_hours}h, ${today.wallets_with_fills} wallets)\n${line}`);

  // asset-class rollup — new risk leads, headline flow shown alongside
  console.log('\nASSET-CLASS FLOW  (new risk = opening fills only; headline = all flow):');
  for (const c of CLASSES) {
    const r = today.rollup[c];
    const fl = flags.classFlags.find(f => f.cls === c);
    const div = (r.opened !== 0 && Math.sign(r.net) !== Math.sign(r.opened)) ? '  ⇄ diverges' : '';
    console.log(`  ${c.padEnd(6)} new risk ${fmt(r.opened).padStart(11)}   headline ${fmt(r.net).padStart(11)}  (${r.coins} mkts)${div}${fl ? `  🚩 ${fl.dir} z=${fl.z ?? 'n/a'}` : ''}`);
  }

  // coin outliers
  if (!flags.coinFlags.length) {
    console.log('\nNo per-coin outliers flagged (need history + a move past the $ floor).');
  } else {
    console.log('\n🚩 COIN OUTLIERS — direction is NEW RISK (opening fills):');
    for (const f of flags.coinFlags) {
      const tag = f.consensus ? ' [CONSENSUS]' : '';
      const zs = f.z == null ? '(cold start, floor only)' : `z=${f.z}, ${f.baselineDays}d base`;
      console.log(`  ${f.dir.padEnd(7)} ${f.coin.padEnd(9)} ${fmt(f.opened).padStart(11)}  ${f.cls.padEnd(6)} ${zs}${tag}`);
      if (f.divergent) {
        console.log(`          ⇄ headline flow is ${fmt(f.net)} — opposite sign. That is ${fmt(f.closing)} of CLOSING, not new risk.`);
      }
      console.log(`          drivers: ${f.drivers.map(d => `${d.w} ${fmt(d.usd)}`).join(', ')}`);
    }
  }

  // context
  console.log('\nTop NEW RISK today (opening fills):');
  for (const c of today.coins.slice(0, 12)) {
    const div = c.divergent ? `  ⇄ headline ${fmt(c.net)}` : '';
    console.log(`  ${(c.opened >= 0 ? 'long ' : 'short').padEnd(5)} ${c.coin.padEnd(9)} ${fmt(c.opened).padStart(11)}  ${c.cls.padEnd(6)} (${c.bulls}L/${c.bears}S)${div}`);
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
