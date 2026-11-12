// Reference closes for the Trading Desk (dashboard/desk).
//
// Pulls three months of daily closes for the seven USD pairs from Yahoo Finance (keyless) and writes
// one small JSON file. The desk combines these with live quotes it fetches itself in the browser, to
// hold Nathan's own entries against the market: are his pairs moving his way, how far is price from
// his levels, how did his past calls work out. It is not a data board.
//
// The closes change once a day, so this does not need to run often: it runs at the end of the daily
// whale-flow job and hourly on its own schedule (GitHub starts scheduled jobs late on this repo).
//
// Usage: node scripts/desk-live.mjs [--out path]   (default: dashboard/desk/data/live.json, git-ignored)
// CI:    the file is force-pushed to the `desk-live` branch (one commit, no history), which the desk
//        reads from raw.githubusercontent.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

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

const round = (n, d) => (n == null || !Number.isFinite(n) ? null : Number(n.toFixed(d)));
const isoDay = (t) => new Date(t * 1000).toISOString().slice(0, 10);

// Value of one unit of each currency in USD, from a raw quote.
const usdValue = (ccy, quote) => (FEED[ccy].inverse ? 1 / quote : quote);

async function main() {
  const out = resolve(process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'dashboard/desk/data/live.json');
  const codes = Object.keys(FEED);
  const daily = await Promise.all(codes.map((c) => chart(FEED[c].sym, 'range=3mo&interval=1d')));

  // ---- daily closes per currency (USD per unit), aligned on dates every feed has ----
  const byDay = {}; // ccy -> { date: usdValue }
  let priceTime = 0;
  codes.forEach((c, i) => {
    const d = daily[i], close = d.indicators.quote[0].close;
    byDay[c] = {};
    // Bars are stamped at midnight in the exchange's time zone; shift by its offset so the date is right in summer too.
    d.timestamp.forEach((t, k) => { if (close[k] != null) byDay[c][isoDay(t + (d.meta.gmtoffset || 0))] = usdValue(c, close[k]); });
    priceTime = Math.max(priceTime, d.meta.regularMarketTime || 0);
  });
  const dates = Object.keys(byDay[codes[0]]).filter((day) => codes.every((c) => byDay[c][day] != null)).sort();
  if (dates.length < 25) throw new Error(`only ${dates.length} aligned daily bars`);
  const hist = { USD: dates.map(() => 1) };
  for (const c of codes) hist[c] = dates.map((day) => byDay[c][day]);

  const data = {
    asOf: new Date().toISOString(),
    priceTime: priceTime ? new Date(priceTime * 1000).toISOString() : null,
    source: 'Yahoo Finance daily closes for the seven USD pairs (the last bar is the session in progress). The desk adds live quotes in the browser.',
    history: { dates, usd: Object.fromEntries(codes.map((c) => [c, hist[c].map((v) => round(v, 6))])) },
  };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(data) + '\n');
  console.log(`desk-live: ${dates.length} daily closes to ${dates.at(-1)}, last quote ${data.priceTime}`);
  console.log(`wrote ${out}`);
}

main().catch((e) => { console.error(`desk-live failed: ${e.message}`); process.exit(1); });
