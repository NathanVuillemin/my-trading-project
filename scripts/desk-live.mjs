// Live price snapshot for the Trading Desk (dashboard/desk).
//
// Pulls the seven USD pairs from Yahoo Finance (keyless), derives all 28 crosses and a basket
// strength per currency, and writes one small JSON file. The desk needs this only to hold
// Nathan's own entries against the market: are his pairs moving his way, how far is price from
// his levels, how did his past calls work out. It is not a data board.
//
// Usage: node scripts/desk-live.mjs [--out path]   (default: dashboard/desk/data/live.json, git-ignored)
// CI:    .github/workflows/desk-live.yml runs it every 5 minutes and force-pushes the file to the
//        `desk-live` branch (one commit, no history), which the desk reads from raw.githubusercontent.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const CCYS = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD'];
const PAIR_ORDER = ['EUR', 'GBP', 'AUD', 'NZD', 'USD', 'CAD', 'CHF', 'JPY']; // market convention: earlier = base
// Yahoo symbol per currency, and whether the quote is USD per unit (direct) or units per USD (inverse).
const FEED = {
  EUR: { sym: 'EURUSD=X', inverse: false }, GBP: { sym: 'GBPUSD=X', inverse: false },
  AUD: { sym: 'AUDUSD=X', inverse: false }, NZD: { sym: 'NZDUSD=X', inverse: false },
  JPY: { sym: 'JPY=X', inverse: true }, CHF: { sym: 'CHF=X', inverse: true }, CAD: { sym: 'CAD=X', inverse: true },
};
const UA = { 'User-Agent': 'Mozilla/5.0 (my-trading-project desk)' };

async function chart(sym, query) {
  let lastErr;
  for (const host of ['query1', 'query2']) {
    try {
      const r = await fetch(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?${query}`, { headers: UA });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const res = (await r.json())?.chart?.result?.[0];
      if (!res?.timestamp?.length) throw new Error('empty result');
      return res;
    } catch (e) { lastErr = e; }
  }
  throw new Error(`${sym}: ${lastErr.message}`);
}

const pct = (a, b) => (a / b - 1) * 100;
const round = (n, d) => (n == null || !Number.isFinite(n) ? null : Number(n.toFixed(d)));
const isoDay = (t) => new Date(t * 1000).toISOString().slice(0, 10);
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

// Value of one unit of each currency in USD, from a raw quote.
const usdValue = (ccy, quote) => (FEED[ccy].inverse ? 1 / quote : quote);

async function main() {
  const out = resolve(process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'dashboard/desk/data/live.json');
  const codes = Object.keys(FEED);
  const daily = await Promise.all(codes.map((c) => chart(FEED[c].sym, 'range=3mo&interval=1d')));

  // ---- daily closes per currency (USD per unit), aligned on dates every feed has ----
  const byDay = {}; // ccy -> { date: usdValue }
  const last = { USD: 1 }; let priceTime = 0;
  codes.forEach((c, i) => {
    const d = daily[i], close = d.indicators.quote[0].close;
    byDay[c] = {};
    d.timestamp.forEach((t, k) => { if (close[k] != null) byDay[c][isoDay(t)] = usdValue(c, close[k]); });
    const live = d.meta.regularMarketPrice ?? close.filter((v) => v != null).at(-1);
    last[c] = usdValue(c, live);
    priceTime = Math.max(priceTime, d.meta.regularMarketTime || 0);
  });
  const dates = Object.keys(byDay[codes[0]]).filter((day) => codes.every((c) => byDay[c][day] != null)).sort();
  if (dates.length < 25) throw new Error(`only ${dates.length} aligned daily bars`);
  const hist = { USD: dates.map(() => 1) };
  for (const c of codes) hist[c] = dates.map((day) => byDay[c][day]);

  // The last daily bar is the session in progress (or Friday's, at the weekend).
  const n = dates.length - 1;
  const lastDay = new Date(dates[n] + 'T12:00:00Z');
  const monday = new Date(lastDay); monday.setUTCDate(lastDay.getUTCDate() - ((lastDay.getUTCDay() + 6) % 7));
  const mondayIso = monday.toISOString().slice(0, 10);
  let weekRef = n - 1; while (weekRef > 0 && dates[weekRef] >= mondayIso) weekRef--; // last close before this week
  const monthRef = Math.max(0, n - 21);

  const series = (base, quote) => dates.map((_, k) => hist[base][k] / hist[quote][k]);
  const stat = (base, quote) => {
    const s = series(base, quote), px = last[base] / last[quote];
    const moves = []; for (let k = n - 20; k < n; k++) if (k > 0) moves.push(Math.abs(pct(s[k], s[k - 1])));
    const typical = mean(moves), dayPct = pct(px, s[n - 1]);
    const win = s.slice(n - 20, n);
    return { last: px, dayPct, wtdPct: pct(px, s[weekRef]), m1Pct: pct(px, s[monthRef]), typicalPct: typical, x: Math.abs(dayPct) / typical, hi20: Math.max(...win), lo20: Math.min(...win) };
  };

  const pairs = {};
  for (let i = 0; i < PAIR_ORDER.length; i++) for (let j = i + 1; j < PAIR_ORDER.length; j++) {
    const b = PAIR_ORDER[i], q = PAIR_ORDER[j], s = stat(b, q), dp = q === 'JPY' ? 3 : 5;
    pairs[b + q] = { last: round(s.last, dp), dayPct: round(s.dayPct, 2), wtdPct: round(s.wtdPct, 2), m1Pct: round(s.m1Pct, 2), typicalPct: round(s.typicalPct, 2), x: round(s.x, 1), hi20: round(s.hi20, dp), lo20: round(s.lo20, dp) };
  }

  // ---- basket strength: average move of a currency against the other seven ----
  const currencies = {};
  for (const c of CCYS) {
    const others = CCYS.filter((o) => o !== c).map((o) => stat(c, o));
    currencies[c] = { dayPct: round(mean(others.map((s) => s.dayPct)), 2), wtdPct: round(mean(others.map((s) => s.wtdPct)), 2), m1Pct: round(mean(others.map((s) => s.m1Pct)), 2) };
  }
  for (const [key, rank] of [['dayPct', 'rankDay'], ['wtdPct', 'rankWtd'], ['m1Pct', 'rankM1']]) {
    [...CCYS].sort((a, b) => currencies[b][key] - currencies[a][key]).forEach((c, i) => { currencies[c][rank] = i + 1; });
  }

  const data = {
    asOf: new Date().toISOString(),
    priceTime: priceTime ? new Date(priceTime * 1000).toISOString() : null,
    source: 'Yahoo Finance quotes for the seven USD pairs; crosses and baskets derived. Refreshed every 5 minutes by CI.',
    week: { monday: mondayIso, ref: dates[weekRef], prevClose: dates[n - 1], monthRef: dates[monthRef] },
    pairs, currencies,
    history: { dates, usd: Object.fromEntries(codes.map((c) => [c, hist[c].map((v) => round(v, 6))])) },
  };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(data) + '\n');
  const top = [...CCYS].sort((a, b) => currencies[a].rankDay - currencies[b].rankDay);
  console.log(`desk-live: ${Object.keys(pairs).length} pairs, ${dates.length} days, prices ${data.priceTime}`);
  console.log(`today strongest → weakest: ${top.map((c) => `${c} ${currencies[c].dayPct > 0 ? '+' : ''}${currencies[c].dayPct}%`).join(', ')}`);
  console.log(`wrote ${out}`);
}

main().catch((e) => { console.error(`desk-live failed: ${e.message}`); process.exit(1); });
