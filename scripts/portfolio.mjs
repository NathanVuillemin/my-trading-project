#!/usr/bin/env node
// portfolio.mjs — your own book: positions, risk, funding drag, realised trade stats, equity curve.
//
// Everything here is read from PUBLIC addresses via the Hyperliquid info API — the same data
// any block explorer shows. No keys, no signing, no ability to trade. Read-only by construction.
//
// Reads:  config/portfolio.json  (addresses + manual positions + risk thresholds)
// Writes: data/portfolio/<YYYY-MM-DD>.json
//
// Usage:
//   node scripts/portfolio.mjs
//   npm run portfolio
//
// Panels produced:
//   account   — equity, margin used, free collateral, account-level leverage
//   positions — per position: notional, entry/mark, uPnL, ROE, leverage, liquidation distance, funding
//   risk      — closest-to-liquidation, concentration by asset and class, gross vs net exposure
//   funding   — cumulative funding paid/earned (the quiet drag on every perp trade)
//   trades    — realised stats computed from fill history: win rate, expectancy, profit factor, fees
//   equity    — account value + PnL history for the curve

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');
const CFG_PATH = join(ROOT, 'config', 'portfolio.json');
const OUT_DIR = join(ROOT, 'data', 'portfolio');

const API = 'https://api.hyperliquid.xyz/info';

// Hyperliquid rate-limits per IP, and this script usually runs straight after trust.mjs
// has already spent the budget on ~180 requests. Without a retry the first 429 killed the
// whole feed, and because the step is non-fatal in CI the run still went green while the
// panel quietly went stale. Back off and retry instead.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = async (body, attempt = 0) => {
  const r = await fetch(API, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(25000),
  });
  if (r.status === 429 || r.status >= 500) {
    if (attempt >= 5) throw new Error(`${body.type} -> HTTP ${r.status} after ${attempt} retries`);
    // Exponential backoff with jitter so parallel callers don't retry in lockstep.
    await sleep(Math.min(16000, 800 * 2 ** attempt) + Math.random() * 400);
    return post(body, attempt + 1);
  }
  if (!r.ok) throw new Error(`${body.type} -> HTTP ${r.status}`);
  return r.json();
};

const num = (v) => { const n = +v; return isFinite(n) ? n : 0; };
const fmt = (n) => (n >= 0 ? '+$' : '-$') + Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
const pct = (n) => (n >= 0 ? '+' : '') + n.toFixed(2) + '%';

// Asset-class map, shared shape with the whale-flow side.
const FX = new Set(['DXY', 'EUR', 'GBP', 'JPY', 'KRW', 'NOK']);
const COMMOD = new Set(['GOLD', 'SILVER', 'PLATINUM', 'PALLADIUM', 'COPPER', 'ALUMINIUM', 'CL',
  'BRENTOIL', 'NATGAS', 'TTF', 'WHEAT', 'CORN', 'URANIUM', 'URNM', 'XLE']);
const INDEX = new Set(['SP500', 'XYZ100', 'VIX', 'VOL', 'NIFTY', 'JP225', 'KR200', 'IBOV',
  'EWY', 'EWJ', 'EWT', 'EWZ', 'SMH']);
const classOf = (raw) => {
  const c = raw.replace(/^xyz:/, '').toUpperCase();
  if (FX.has(c)) return 'FX';
  if (COMMOD.has(c)) return 'COMMOD';
  if (INDEX.has(c)) return 'INDEX';
  return raw.startsWith('xyz:') ? 'STOCK' : 'CRYPTO';
};
const clean = (c) => c.replace(/^xyz:/, '');

// ---------------------------------------------------------------- trade grouping
// Walk fills chronologically per coin and cut a new trade every time the position
// returns to flat. Each fill carries `startPosition` (the size held before it), so the
// size after a fill is startPosition ± sz — when that reaches zero, the round trip is done.
function groupIntoTrades(fills) {
  const byCoin = {};
  for (const f of fills) {
    (byCoin[f.coin] ||= []).push(f);
  }
  const out = [];
  for (const [coin, list] of Object.entries(byCoin)) {
    list.sort((a, b) => a.time - b.time);
    let cur = null;
    for (const f of list) {
      const before = num(f.startPosition);
      const after = before + (f.side === 'B' ? num(f.sz) : -num(f.sz));
      if (!cur) {
        cur = {
          coin: clean(coin), cls: classOf(coin),
          openedAt: f.time, closedAt: null,
          pnl: 0, fees: 0, fills: 0,
          side: before === 0 ? (after > 0 ? 'long' : 'short') : (before > 0 ? 'long' : 'short'),
          stillOpen: true,
        };
      }
      cur.pnl += num(f.closedPnl);
      cur.fees += num(f.fee);
      cur.fills++;
      // Flat again (allow for float dust) => the round trip is complete.
      if (Math.abs(after) < 1e-9) {
        cur.closedAt = f.time;
        cur.stillOpen = false;
        cur.pnl -= cur.fees;          // realised PnL net of fees paid on this trade
        out.push(cur);
        cur = null;
      }
    }
    // A position still open at the end of history is not a completed trade; keep it
    // flagged so the count is honest, but exclude it from win/loss stats.
    if (cur) { cur.pnl -= cur.fees; out.push(cur); }
  }
  return out.filter(t => !t.stillOpen).concat(out.filter(t => t.stillOpen));
}

// ---------------------------------------------------------------- per-address pull
async function pullAddress(entry) {
  const addr = entry.address;
  const [state, fills, funding, portfolio] = await Promise.all([
    post({ type: 'clearinghouseState', user: addr }),
    post({ type: 'userFills', user: addr }).catch(() => []),
    post({ type: 'userFunding', user: addr, startTime: Date.now() - 30 * 864e5 }).catch(() => []),
    post({ type: 'portfolio', user: addr }).catch(() => []),
  ]);

  // ---- positions ----
  const positions = (state.assetPositions || []).map((ap) => {
    const p = ap.position;
    const szi = num(p.szi);
    if (szi === 0) return null;
    const notional = num(p.positionValue);
    const mark = Math.abs(szi) > 0 ? notional / Math.abs(szi) : 0;
    const liq = p.liquidationPx == null ? null : num(p.liquidationPx);
    // How far price must move, in %, before this position liquidates.
    const distToLiq = (liq && mark) ? Math.abs(liq - mark) / mark * 100 : null;
    return {
      coin: clean(p.coin),
      cls: classOf(p.coin),
      side: szi > 0 ? 'long' : 'short',
      size: Math.abs(szi),
      notional,
      entry: num(p.entryPx),
      mark,
      uPnl: num(p.unrealizedPnl),
      roe: num(p.returnOnEquity) * 100,
      leverage: p.leverage?.value ?? null,
      marginUsed: num(p.marginUsed),
      liqPx: liq,
      distToLiqPct: distToLiq,
      fundingSinceOpen: -num(p.cumFunding?.sinceOpen),   // negative cumFunding = paid out
      fundingAllTime: -num(p.cumFunding?.allTime),
      address: addr,
      label: entry.label,
    };
  }).filter(Boolean);

  // ---- account ----
  const ms = state.marginSummary || {};
  const equity = num(ms.accountValue);
  const grossNotional = num(ms.totalNtlPos);
  const account = {
    label: entry.label,
    address: addr,
    equity,
    grossNotional,
    marginUsed: num(ms.totalMarginUsed),
    maintenanceMargin: num(state.crossMaintenanceMarginUsed),
    withdrawable: num(state.withdrawable),
    // Account leverage: how much notional is riding on each dollar of equity.
    accountLeverage: equity > 0 ? grossNotional / equity : 0,
  };

  // ---- realised trade stats from fill history ----
  // A TRADE is a round trip: the fills that take a position from flat, out, and back to flat.
  // Counting each closing fill as its own "trade" badly distorts the stats — scaling out of one
  // position in 20 slices would read as 20 trades. `startPosition` lets us find the real boundaries.
  const allTrades = groupIntoTrades(fills || []);
  const trades = allTrades.filter((t) => !t.stillOpen);   // only completed round trips count
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl < 0);
  const sum = (a, g) => a.reduce((t, x) => t + g(x), 0);
  const grossWin = sum(wins, (t) => t.pnl);
  const grossLoss = Math.abs(sum(losses, (t) => t.pnl));
  const totalFees = sum(fills || [], (f) => num(f.fee));
  const avgWin = wins.length ? grossWin / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;
  const winRate = trades.length ? wins.length / trades.length : 0;

  // Per-asset realised breakdown, so a single bleeding market is visible.
  const byCoin = {};
  for (const t of trades) {
    const e = (byCoin[t.coin] ||= { coin: t.coin, cls: t.cls, realised: 0, n: 0, wins: 0 });
    e.realised += t.pnl;
    e.n++;
    if (t.pnl > 0) e.wins++;
  }

  const tradeStats = {
    tradeCount: trades.length,
    closingFills: (fills || []).filter((f) => num(f.closedPnl) !== 0).length,
    fillCount: (fills || []).length,
    fillsCapped: (fills || []).length >= 2000,   // API caps history; older trades not counted
    winRate: winRate * 100,
    grossWin, grossLoss,
    netRealised: grossWin - grossLoss,
    avgWin, avgLoss,
    // Expectancy: average $ outcome per round-trip trade.
    expectancy: trades.length ? (grossWin - grossLoss) / trades.length : 0,
    // Profit factor: >1 means winners outweigh losers.
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : 0),
    payoffRatio: avgLoss > 0 ? avgWin / avgLoss : null,
    totalFees,
    openTrades: allTrades.filter(t => t.stillOpen).length,
    byCoin: Object.values(byCoin).sort((a, b) => Math.abs(b.realised) - Math.abs(a.realised)).slice(0, 12),
  };

  // ---- funding over the last 30d ----
  const fundingRows = funding || [];
  const funding30d = fundingRows.reduce((t, f) => t + num(f.delta?.usdc), 0);
  const fundingByCoin = {};
  for (const f of fundingRows) {
    const k = clean(f.delta?.coin || '?');
    fundingByCoin[k] = (fundingByCoin[k] || 0) + num(f.delta?.usdc);
  }

  // ---- equity curve ----
  const bucket = (portfolio || []).find((b) => b[0] === 'month')
    || (portfolio || []).find((b) => b[0] === 'week');
  const equityHistory = (bucket?.[1]?.accountValueHistory || []).map(([t, v]) => [t, num(v)]);
  const pnlHistory = (bucket?.[1]?.pnlHistory || []).map(([t, v]) => [t, num(v)]);

  return {
    account, positions, trades: tradeStats,
    recentTrades: trades.slice(-15).reverse(),
    funding: {
      last30d: funding30d,
      byCoin: Object.entries(fundingByCoin)
        .map(([coin, usd]) => ({ coin, usd }))
        .sort((a, b) => Math.abs(b.usd) - Math.abs(a.usd)).slice(0, 10),
    },
    equityHistory, pnlHistory,
  };
}

// ---------------------------------------------------------------- risk
function buildRisk(positions, account, cfg) {
  const t = cfg.risk || {};
  const gross = positions.reduce((s, p) => s + p.notional, 0);
  const net = positions.reduce((s, p) => s + (p.side === 'long' ? p.notional : -p.notional), 0);

  // Concentration by asset and by class — three correlated longs are one bet, not three.
  const byAsset = {}, byClass = {};
  for (const p of positions) {
    byAsset[p.coin] = (byAsset[p.coin] || 0) + p.notional;
    byClass[p.cls] = (byClass[p.cls] || 0) + p.notional;
  }
  const share = (o) => Object.entries(o)
    .map(([k, v]) => ({ key: k, usd: v, pct: gross > 0 ? v / gross * 100 : 0 }))
    .sort((a, b) => b.usd - a.usd);

  const withLiq = positions.filter((p) => p.distToLiqPct != null)
    .sort((a, b) => a.distToLiqPct - b.distToLiqPct);

  const alerts = [];
  for (const p of withLiq) {
    if (p.distToLiqPct <= (t.liqCriticalPct ?? 7)) {
      alerts.push({ level: 'critical', msg: `${p.coin} ${p.side} is ${p.distToLiqPct.toFixed(1)}% from liquidation` });
    } else if (p.distToLiqPct <= (t.liqWarnPct ?? 15)) {
      alerts.push({ level: 'warning', msg: `${p.coin} ${p.side} is ${p.distToLiqPct.toFixed(1)}% from liquidation` });
    }
  }
  const topAsset = share(byAsset)[0];
  if (topAsset && topAsset.pct >= (t.concentrationWarnPct ?? 40)) {
    alerts.push({ level: 'warning', msg: `${topAsset.key} is ${topAsset.pct.toFixed(0)}% of gross exposure` });
  }
  if (account.accountLeverage >= (t.accountLeverageWarn ?? 5)) {
    alerts.push({ level: 'warning', msg: `Account leverage ${account.accountLeverage.toFixed(1)}x` });
  }

  return {
    gross, net,
    longUsd: positions.filter(p => p.side === 'long').reduce((s, p) => s + p.notional, 0),
    shortUsd: positions.filter(p => p.side === 'short').reduce((s, p) => s + p.notional, 0),
    byAsset: share(byAsset).slice(0, 10),
    byClass: share(byClass),
    closestToLiq: withLiq.slice(0, 5).map(p => ({ coin: p.coin, side: p.side, distPct: p.distToLiqPct, liqPx: p.liqPx, mark: p.mark })),
    alerts,
  };
}

// ---------------------------------------------------------------- main
(async () => {
  if (!existsSync(CFG_PATH)) {
    console.error(`Missing ${CFG_PATH}. Create it first.`);
    process.exit(1);
  }
  const cfg = JSON.parse(readFileSync(CFG_PATH, 'utf8'));
  const addrs = (cfg.addresses?.hyperliquid || []).filter(a => a && a.address);
  const usingPlaceholder = addrs.some(a => /placeholder/i.test(a.label || ''));

  if (!addrs.length) {
    console.error('No addresses in config/portfolio.json.');
    process.exit(1);
  }

  console.log(`Pulling ${addrs.length} address(es)...`);
  const pulled = [];
  for (const a of addrs) {
    try { pulled.push(await pullAddress(a)); }
    catch (e) { console.error(`  ! ${a.label || a.address}: ${e.message}`); }
  }
  if (!pulled.length) { console.error('All address pulls failed.'); process.exit(1); }

  // Merge across addresses.
  const positions = pulled.flatMap(p => p.positions);
  const account = pulled.reduce((acc, p) => ({
    equity: acc.equity + p.account.equity,
    grossNotional: acc.grossNotional + p.account.grossNotional,
    marginUsed: acc.marginUsed + p.account.marginUsed,
    maintenanceMargin: acc.maintenanceMargin + p.account.maintenanceMargin,
    withdrawable: acc.withdrawable + p.account.withdrawable,
    accountLeverage: 0,
  }), { equity: 0, grossNotional: 0, marginUsed: 0, maintenanceMargin: 0, withdrawable: 0, accountLeverage: 0 });
  account.accountLeverage = account.equity > 0 ? account.grossNotional / account.equity : 0;

  // Manual positions and cash, filtered of template rows.
  const manual = (cfg.manualPositions?.items || []).filter(m => num(m.sizeUsd) > 0)
    .map(m => ({ ...m, sizeUsd: num(m.sizeUsd), cls: m.class || classOf(m.asset || ''), manual: true }));
  const cash = (cfg.cash?.items || []).filter(c => num(c.usd) !== 0);
  const cashTotal = cash.reduce((s, c) => s + num(c.usd), 0);
  const manualTotal = manual.reduce((s, m) => s + m.sizeUsd, 0);

  const risk = buildRisk(positions, account, cfg);

  // Aggregate trade stats across addresses.
  const tr = pulled.map(p => p.trades);
  const trades = {
    tradeCount: tr.reduce((s, t) => s + t.tradeCount, 0),
    openTrades: tr.reduce((s, t) => s + t.openTrades, 0),
    closingFills: tr.reduce((s, t) => s + t.closingFills, 0),
    fillsCapped: tr.some(t => t.fillsCapped),
    grossWin: tr.reduce((s, t) => s + t.grossWin, 0),
    grossLoss: tr.reduce((s, t) => s + t.grossLoss, 0),
    totalFees: tr.reduce((s, t) => s + t.totalFees, 0),
    byCoin: tr[0]?.byCoin || [],
  };
  trades.netRealised = trades.grossWin - trades.grossLoss;
  trades.winRate = trades.tradeCount ? (tr.reduce((s, t) => s + t.winRate * t.tradeCount, 0) / trades.tradeCount) : 0;
  trades.expectancy = trades.tradeCount ? trades.netRealised / trades.tradeCount : 0;
  trades.profitFactor = trades.grossLoss > 0 ? trades.grossWin / trades.grossLoss : null;

  const payload = {
    date: new Date().toISOString().slice(0, 10),
    generatedAt: new Date().toISOString(),
    usingPlaceholder,
    account: {
      ...account,
      cashTotal,
      manualTotal,
      netWorth: account.equity + cashTotal,
    },
    positions: positions.sort((a, b) => b.notional - a.notional),
    manual, cash,
    risk,
    trades,
    funding: {
      last30d: pulled.reduce((s, p) => s + p.funding.last30d, 0),
      byCoin: pulled[0]?.funding.byCoin || [],
    },
    equityHistory: pulled[0]?.equityHistory || [],
    pnlHistory: pulled[0]?.pnlHistory || [],
  };

  mkdirSync(OUT_DIR, { recursive: true });
  const out = join(OUT_DIR, `${payload.date}.json`);
  writeFileSync(out, JSON.stringify(payload, null, 2));

  // ---- report ----
  const line = '─'.repeat(66);
  console.log(`\n${line}\nPORTFOLIO — ${payload.date}${usingPlaceholder ? '  [PLACEHOLDER ADDRESS]' : ''}\n${line}`);
  console.log(`Equity ${fmt(account.equity)}   Gross ${fmt(risk.gross)}   Net ${fmt(risk.net)}   Acct lev ${account.accountLeverage.toFixed(2)}x`);
  console.log(`Long ${fmt(risk.longUsd)} / Short ${fmt(risk.shortUsd)}   Free collateral ${fmt(account.withdrawable)}`);

  if (risk.alerts.length) {
    console.log('\nRISK ALERTS:');
    for (const a of risk.alerts) console.log(`  [${a.level.toUpperCase()}] ${a.msg}`);
  } else console.log('\nNo risk alerts.');

  console.log('\nCLOSEST TO LIQUIDATION:');
  for (const p of risk.closestToLiq) console.log(`  ${p.coin.padEnd(10)} ${p.side.padEnd(5)} ${p.distPct.toFixed(1)}% away (mark ${p.mark.toFixed(2)} -> liq ${p.liqPx.toFixed(2)})`);

  console.log(`\nPOSITIONS (${positions.length}):`);
  for (const p of positions.slice(0, 10)) {
    console.log(`  ${p.coin.padEnd(10)} ${p.side.padEnd(5)} ${fmt(p.notional).padStart(13)}  uPnL ${fmt(p.uPnl).padStart(12)} (${pct(p.roe)})  fund ${fmt(p.fundingSinceOpen)}`);
  }

  console.log(`\nREALISED (${trades.tradeCount} completed round trips from ${trades.closingFills} closing fills${trades.fillsCapped ? '; history capped at 2000 fills' : ''}):`);
  console.log(`  Win rate ${trades.winRate.toFixed(1)}%   Net ${fmt(trades.netRealised)}   Expectancy ${fmt(trades.expectancy)}/trade`);
  console.log(`  Profit factor ${trades.profitFactor == null ? 'n/a' : trades.profitFactor.toFixed(2)}   Fees paid ${fmt(-trades.totalFees)}`);
  console.log(`\nFunding last 30d: ${fmt(payload.funding.last30d)}`);
  console.log(`\nSnapshot written: ${out}`);
  console.log(line);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
