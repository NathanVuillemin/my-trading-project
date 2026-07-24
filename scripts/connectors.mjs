// connectors.mjs — pluggable smart-money data sources, normalized to one schema.
//
// Every connector returns an array of signals shaped:
//   {
//     source:  'binance-top',        // connector id
//     kind:    'smart' | 'crowd',    // smart = top-trader/whale positioning, crowd = aggregate market
//     tier:    'A' | 'B' | 'C',      // A = per-wallet positions, B = top-trader aggregate, C = market structure
//     asset:   'BTC',                // NORMALIZED ticker
//     cls:     'CRYPTO',             // CRYPTO | STOCK | INDEX | COMMOD | FX
//     score:   -1..+1,               // directional signal (+ bullish, - bearish)
//     sizeUsd: number | null,        // notional backing the signal, when known
//     detail:  'top traders 60.8% long',
//   }
//
// Design notes:
//   - Tier A (Hyperliquid per-wallet flow) is the only source that sees INDIVIDUAL whales.
//     Everything else is aggregate. Weight accordingly in the aggregator.
//   - 'crowd' sources (funding, retail long/short) are frequently CONTRARIAN — an SMC read
//     treats crowded longs as liquidity resting below. The aggregator can invert them.
//   - Every connector is failure-isolated: a dead endpoint yields [] plus a warning, never a throw.
//   - Sources needing an API key read it from env and self-skip when absent (never hardcode keys).

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const FLOW_DIR = join(__dir, '..', 'data', 'whale-flow');

// ---------- ticker normalization ----------
const FX = new Set(['DXY', 'EUR', 'GBP', 'JPY', 'KRW', 'NOK']);
const COMMOD = new Set(['GOLD', 'SILVER', 'PLATINUM', 'PALLADIUM', 'COPPER', 'ALUMINIUM', 'CL',
  'BRENTOIL', 'NATGAS', 'TTF', 'WHEAT', 'CORN', 'URANIUM', 'URNM', 'XLE']);
const INDEX = new Set(['SP500', 'XYZ100', 'VIX', 'VOL', 'NIFTY', 'JP225', 'KR200', 'IBOV',
  'EWY', 'EWJ', 'EWT', 'EWZ', 'SMH']);
const FX_PAIR = /^(EUR|GBP|USD|AUD|NZD|JPY|CHF|CAD)(USD|JPY|CHF|CAD|GBP|EUR)$/;

// Strips venue decoration: BTCUSDT / BTC-USD-PERP / xyz:NVDA / kPEPE / 1000PEPE -> BTC / NVDA / PEPE
export function normAsset(raw) {
  if (!raw) return null;
  let s = String(raw).replace(/^xyz:/, '').toUpperCase();
  if (FX_PAIR.test(s)) return s;                     // keep FX pairs whole
  s = s.replace(/[-_]?(USDT|USDC|USD|PERP|SWAP)\b/g, '').replace(/[-_]+$/, '');
  s = s.replace(/^K(?=[A-Z])/, '').replace(/^1000+/, ''); // kPEPE, 1000PEPE -> PEPE
  return s || null;
}

export function classOf(asset, rawHadXyzPrefix = false) {
  if (!asset) return 'CRYPTO';
  if (FX.has(asset) || FX_PAIR.test(asset)) return 'FX';
  if (COMMOD.has(asset)) return 'COMMOD';
  if (INDEX.has(asset)) return 'INDEX';
  return rawHadXyzPrefix ? 'STOCK' : 'CRYPTO';
}

// ---------- fetch helpers ----------
const TIMEOUT = 12_000;
async function jget(url, opts = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { ...opts, signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}
const clamp = (n, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, n));
// long/short RATIO (e.g. 1.55) -> -1..+1
const ratioToScore = (r) => (!isFinite(r) || r <= 0) ? 0 : clamp((r - 1) / (r + 1));

// Default crypto universe for venue-by-venue queries.
export const DEFAULT_ASSETS = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'BNB', 'LINK', 'AVAX', 'HYPE'];

// =====================================================================
// TIER A — per-wallet whale positioning (the only source that sees individuals)
// =====================================================================

// Reads the newest whale-flow snapshot rather than re-scanning 150 wallets.
// Run `npm run whale:flow` first to refresh it.
export async function hyperliquidFlow() {
  if (!existsSync(FLOW_DIR)) return { signals: [], warn: 'no whale-flow snapshots yet — run npm run whale:flow' };
  const files = readdirSync(FLOW_DIR).filter(f => f.endsWith('.json')).sort();
  if (!files.length) return { signals: [], warn: 'no whale-flow snapshots yet' };
  const snap = JSON.parse(readFileSync(join(FLOW_DIR, files[files.length - 1]), 'utf8'));

  // Scale each coin's net flow against the largest absolute flow in the snapshot.
  const max = Math.max(...snap.coins.map(c => Math.abs(c.net)), 1);
  const signals = snap.coins
    .filter(c => Math.abs(c.net) >= 250_000)
    .map(c => ({
      source: 'hyperliquid', kind: 'smart', tier: 'A',
      asset: normAsset(c.coin), cls: c.cls,
      score: clamp(c.net / max),
      sizeUsd: Math.abs(c.net),
      detail: `${c.bulls}L/${c.bears}S wallets, net ${(c.net / 1e6).toFixed(1)}M`,
    }))
    .filter(s => s.asset);
  return { signals, meta: { date: snap.date, wallets: snap.wallets_with_fills } };
}

// =====================================================================
// TIER B — top-trader aggregate positioning (best free "smart money" proxy)
// =====================================================================

// Binance publishes the long/short split of TOP traders by position size. No auth.
export async function binanceTopTraders(assets = DEFAULT_ASSETS) {
  const signals = [];
  for (const a of assets) {
    try {
      const rows = await jget(`https://fapi.binance.com/futures/data/topLongShortPositionRatio?symbol=${a}USDT&period=1d&limit=2`);
      if (!rows?.length) continue;
      const last = rows[rows.length - 1];
      const prev = rows.length > 1 ? rows[0] : null;
      const score = clamp(+last.longAccount - +last.shortAccount);
      const delta = prev ? score - (+prev.longAccount - +prev.shortAccount) : null;
      signals.push({
        source: 'binance-top', kind: 'smart', tier: 'B',
        asset: a, cls: classOf(a), score, sizeUsd: null,
        detail: `top traders ${(100 * +last.longAccount).toFixed(1)}% long`
          + (delta == null ? '' : ` (${delta >= 0 ? '+' : ''}${(100 * delta).toFixed(1)}pt d/d)`),
      });
    } catch { /* asset not listed on this venue */ }
  }
  return { signals };
}

// OKX equivalent: long/short account ratio restricted to top traders.
export async function okxTopTraders(assets = DEFAULT_ASSETS) {
  const signals = [];
  for (const a of assets) {
    try {
      const j = await jget(`https://www.okx.com/api/v5/rubik/stat/contracts/long-short-account-ratio-contract-top-trader?instId=${a}-USDT-SWAP&period=1D`);
      const d = j?.data;
      if (!d?.length) continue;
      const latest = +d[0][1];                       // newest first
      const score = ratioToScore(latest);
      signals.push({
        source: 'okx-top', kind: 'smart', tier: 'B',
        asset: a, cls: classOf(a), score, sizeUsd: null,
        detail: `top-trader L/S ratio ${latest.toFixed(2)}`,
      });
    } catch { /* not listed */ }
  }
  return { signals };
}

// =====================================================================
// TIER C — market structure (crowd positioning: funding, OI, taker flow)
// =====================================================================

// Funding rate as crowd-positioning proxy. Positive funding = longs paying = crowded long.
// FUNDING_SCALE maps a "hot" 8h rate (~0.05%) to a near-full-strength score.
const FUNDING_SCALE = 2000;

export async function dydxMarkets() {
  try {
    const j = await jget('https://indexer.dydx.trade/v4/perpetualMarkets');
    const signals = [];
    for (const [ticker, m] of Object.entries(j.markets || {})) {
      const asset = normAsset(ticker);
      const oi = +m.openInterest * +m.oraclePrice;
      if (!asset || !isFinite(oi) || oi < 1e6) continue;
      const f = +m.nextFundingRate;
      signals.push({
        source: 'dydx', kind: 'crowd', tier: 'C',
        asset, cls: classOf(asset),
        score: clamp(f * FUNDING_SCALE), sizeUsd: Math.round(oi),
        detail: `OI $${(oi / 1e6).toFixed(1)}M, funding ${(f * 100).toFixed(4)}%`,
      });
    }
    return { signals };
  } catch (e) { return { signals: [], warn: `dydx: ${e.message}` }; }
}

export async function asterMarkets(assets = DEFAULT_ASSETS) {
  const signals = [];
  for (const a of assets) {
    try {
      const [oiR, pR] = await Promise.all([
        jget(`https://fapi.asterdex.com/fapi/v1/openInterest?symbol=${a}USDT`),
        jget(`https://fapi.asterdex.com/fapi/v1/premiumIndex?symbol=${a}USDT`),
      ]);
      const oi = +oiR.openInterest * +pR.markPrice;
      const f = +pR.lastFundingRate;
      if (!isFinite(oi)) continue;
      signals.push({
        source: 'aster', kind: 'crowd', tier: 'C',
        asset: a, cls: classOf(a),
        score: clamp(f * FUNDING_SCALE), sizeUsd: Math.round(oi),
        detail: `OI $${(oi / 1e6).toFixed(1)}M, funding ${(f * 100).toFixed(4)}%`,
      });
    } catch { /* not listed */ }
  }
  return { signals };
}

export async function paradexMarkets() {
  try {
    const j = await jget('https://api.prod.paradex.trade/v1/markets/summary?market=ALL');
    const signals = [];
    for (const m of (j.results || [])) {
      if (!m.symbol?.endsWith('-PERP')) continue;    // skip options
      const asset = normAsset(m.symbol);
      const oi = +m.open_interest * +m.mark_price;
      if (!asset || !isFinite(oi) || oi < 1e6) continue;
      const f = +(m.funding_rate ?? 0);
      signals.push({
        source: 'paradex', kind: 'crowd', tier: 'C',
        asset, cls: classOf(asset),
        score: clamp(f * FUNDING_SCALE), sizeUsd: Math.round(oi),
        detail: `OI $${(oi / 1e6).toFixed(1)}M`,
      });
    }
    return { signals };
  } catch (e) { return { signals: [], warn: `paradex: ${e.message}` }; }
}

// Lighter is notable: it lists FX perps (NZDUSD etc.) alongside crypto.
// Its market feed exposes no funding_rate, so positioning is derived from the
// mark-vs-index premium instead — same semantic (perp above spot = crowded long).
const PREMIUM_SCALE = 500; // 0.2% premium -> full-strength score

export async function lighterMarkets() {
  try {
    const j = await jget('https://mainnet.zklighter.elliot.ai/api/v1/orderBookDetails');
    const signals = [];
    for (const m of (j.order_book_details || [])) {
      if (m.market_type !== 'perp' || m.status !== 'active') continue;
      const asset = normAsset(m.symbol);
      if (!asset) continue;
      const mark = +m.mark_price, index = +m.index_price;
      if (!isFinite(mark) || !isFinite(index) || index <= 0) continue;
      const premium = (mark - index) / index;
      const oi = +(m.open_interest ?? 0) * mark;
      signals.push({
        source: 'lighter', kind: 'crowd', tier: 'C',
        asset, cls: classOf(asset),
        score: clamp(premium * PREMIUM_SCALE),
        sizeUsd: isFinite(oi) && oi > 0 ? Math.round(oi) : null,
        detail: `premium ${(premium * 100).toFixed(4)}%`
          + (isFinite(oi) && oi > 0 ? `, OI $${(oi / 1e6).toFixed(1)}M` : ''),
      });
    }
    return { signals };
  } catch (e) { return { signals: [], warn: `lighter: ${e.message}` }; }
}

// Binance taker buy/sell volume — aggressive-flow direction, distinct from resting positioning.
export async function binanceTakerFlow(assets = DEFAULT_ASSETS) {
  const signals = [];
  for (const a of assets) {
    try {
      const rows = await jget(`https://fapi.binance.com/futures/data/takerlongshortRatio?symbol=${a}USDT&period=1d&limit=1`);
      if (!rows?.length) continue;
      const r = +rows[0].buySellRatio;
      signals.push({
        source: 'binance-taker', kind: 'crowd', tier: 'C',
        asset: a, cls: classOf(a), score: ratioToScore(r), sizeUsd: null,
        detail: `taker buy/sell ${r.toFixed(3)}`,
      });
    } catch { /* not listed */ }
  }
  return { signals };
}

// =====================================================================
// KEY-GATED — self-skip unless the env var is present
// =====================================================================

// Free tier at coinglass.com; export COINGLASS_API_KEY before running.
export async function coinglass(assets = DEFAULT_ASSETS) {
  const key = process.env.COINGLASS_API_KEY;
  if (!key) return { signals: [], warn: 'coinglass: skipped (set COINGLASS_API_KEY)' };
  const signals = [];
  for (const a of assets) {
    try {
      const j = await jget(
        `https://open-api-v4.coinglass.com/api/futures/global-long-short-account-ratio/history?symbol=${a}&interval=1d&limit=1`,
        { headers: { 'CG-API-KEY': key } });
      const row = j?.data?.[0];
      if (!row) continue;
      const r = +(row.global_account_long_short_ratio ?? row.longShortRatio);
      if (!isFinite(r)) continue;
      signals.push({
        source: 'coinglass', kind: 'crowd', tier: 'C',
        asset: a, cls: classOf(a), score: ratioToScore(r), sizeUsd: null,
        detail: `global L/S ${r.toFixed(2)}`,
      });
    } catch (e) { return { signals, warn: `coinglass: ${e.message}` }; }
  }
  return { signals };
}

// Free key at dune.com/settings/api. Point DUNE_QUERY_ID at a saved smart-money query
// whose result columns include asset + a net flow / direction field.
export async function dune() {
  const key = process.env.DUNE_API_KEY;
  const qid = process.env.DUNE_QUERY_ID;
  if (!key) return { signals: [], warn: 'dune: skipped (set DUNE_API_KEY)' };
  if (!qid) return { signals: [], warn: 'dune: skipped (set DUNE_QUERY_ID to a saved query)' };
  try {
    const j = await jget(`https://api.dune.com/api/v1/query/${qid}/results?limit=200`,
      { headers: { 'X-Dune-API-Key': key } });
    const rows = j?.result?.rows || [];
    const pick = (r, names) => names.map(n => r[n]).find(v => v !== undefined);
    const raw = rows.map(r => ({
      asset: normAsset(pick(r, ['asset', 'symbol', 'token', 'coin'])),
      net: +(pick(r, ['net_usd', 'net_flow', 'netflow', 'usd', 'amount_usd']) ?? 0),
    })).filter(r => r.asset && isFinite(r.net) && r.net !== 0);
    const max = Math.max(...raw.map(r => Math.abs(r.net)), 1);
    return {
      signals: raw.map(r => ({
        source: 'dune', kind: 'smart', tier: 'B',
        asset: r.asset, cls: classOf(r.asset),
        score: clamp(r.net / max), sizeUsd: Math.abs(r.net),
        detail: `dune net ${(r.net / 1e6).toFixed(2)}M`,
      })),
    };
  } catch (e) { return { signals: [], warn: `dune: ${e.message}` }; }
}

// =====================================================================
// registry
// =====================================================================
export const CONNECTORS = [
  { id: 'hyperliquid', fn: hyperliquidFlow, weight: 3.0, note: 'per-wallet whale flow (Tier A)' },
  { id: 'binance-top', fn: binanceTopTraders, weight: 2.0, note: 'top-trader position ratio' },
  { id: 'okx-top', fn: okxTopTraders, weight: 1.5, note: 'top-trader account ratio' },
  { id: 'dune', fn: dune, weight: 2.0, note: 'on-chain smart money (key)' },
  { id: 'dydx', fn: dydxMarkets, weight: 0.8, note: 'OI + funding' },
  { id: 'aster', fn: asterMarkets, weight: 0.6, note: 'OI + funding' },
  { id: 'paradex', fn: paradexMarkets, weight: 0.6, note: 'OI' },
  { id: 'lighter', fn: lighterMarkets, weight: 0.6, note: 'funding (has FX perps)' },
  { id: 'binance-taker', fn: binanceTakerFlow, weight: 0.7, note: 'aggressive taker flow' },
  { id: 'coinglass', fn: coinglass, weight: 0.8, note: 'global L/S (key)' },
];

export async function runAll(assets = DEFAULT_ASSETS) {
  const out = [], warns = [];
  await Promise.all(CONNECTORS.map(async (c) => {
    try {
      const r = await c.fn(assets);
      for (const s of (r.signals || [])) out.push({ ...s, weight: c.weight });
      if (r.warn) warns.push(r.warn);
    } catch (e) { warns.push(`${c.id}: ${e.message}`); }
  }));
  return { signals: out, warns };
}
