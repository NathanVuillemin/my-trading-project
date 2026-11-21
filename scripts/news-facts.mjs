// Checked numbers for the desk's news brief (dashboard/desk/data/news.json).
//
// The daily news task (scripts/news-brief.md) writes the words; every price figure in them comes from this
// script, so nothing is typed from memory or from a headline. Daily closes from Yahoo Finance (keyless):
// the last session's move, the week's move, and for FX each currency against the other seven, from closes
// only (no weekend quotes).
//
// "Week" = from the last close before the Monday of the latest session's week to the latest close. On a
// weekend that is the week just gone.
//
// Usage: node scripts/news-facts.mjs
const UA = { 'User-Agent': 'Mozilla/5.0 (my-trading-project desk)' };
const MARKETS = [['S&P 500', '^GSPC'], ['Nasdaq Composite', '^IXIC'], ['VIX', '^VIX', 'pt'], ['US 10-year yield', '^TNX', 'bp'],
  ['Dollar index', 'DX-Y.NYB'], ['Gold', 'GC=F'], ['WTI crude', 'CL=F'], ['Bitcoin', 'BTC-USD']];
const FX = { EUR: ['EURUSD=X', false], GBP: ['GBPUSD=X', false], AUD: ['AUDUSD=X', false], NZD: ['NZDUSD=X', false], JPY: ['JPY=X', true], CHF: ['CHF=X', true], CAD: ['CAD=X', true] };

async function closes(sym, range = '1y') {
  for (const host of ['query1', 'query2']) {
    try {
      const r = await fetch(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=1d`, { headers: UA });
      if (!r.ok) continue;
      const res = (await r.json())?.chart?.result?.[0], c = res?.indicators?.quote?.[0]?.close || [];
      const off = res?.meta?.gmtoffset || 0;
      const rows = (res?.timestamp || []).map((t, i) => [new Date((t + off) * 1000).toISOString().slice(0, 10), c[i]]).filter((x) => x[1] != null);
      if (rows.length) return rows;
    } catch { /* next host */ }
  }
  throw new Error(`no data for ${sym}`);
}
const mondayOf = (d) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.toISOString().slice(0, 10); };
const pct = (a, b) => (a / b - 1) * 100;
const f = (n, d = 2) => `${n > 0 ? '+' : ''}${n.toFixed(d)}`;

const out = [];
for (const [name, sym, kind] of MARKETS) {
  try {
    const rows = await closes(sym), n = rows.length, [d, v] = rows[n - 1], prev = rows[n - 2][1];
    const mon = mondayOf(d), wk = [...rows].reverse().find((x) => x[0] < mon)?.[1];
    const chg = (a, b) => (kind === 'bp' ? `${f((a - b) * 100, 0)}bp` : kind === 'pt' ? `${f(a - b)}pt` : `${f(pct(a, b))}%`);
    const extra = sym === '^GSPC' ? ` · 200-day avg ${(rows.slice(-200).reduce((s, x) => s + x[1], 0) / Math.min(200, n)).toFixed(0)}` : '';
    out.push(`${name.padEnd(17)} ${d} close ${kind === 'bp' ? v.toFixed(2) + '%' : v.toFixed(2)} · session ${chg(v, prev)} · week ${wk != null ? chg(v, wk) : 'n/a'}${extra}`);
  } catch (e) { out.push(`${name.padEnd(17)} ERROR ${e.message}`); }
}

// FX: USD value of each currency on dates every pair has, then each currency against the other seven.
const ccys = Object.keys(FX), usd = { USD: {} };
await Promise.all(ccys.map(async (c) => { usd[c] = Object.fromEntries((await closes(FX[c][0], '3mo')).map(([d, v]) => [d, FX[c][1] ? 1 / v : v])); }));
const dates = Object.keys(usd.EUR).filter((d) => ccys.every((c) => usd[c][d] != null)).sort();
dates.forEach((d) => { usd.USD[d] = 1; });
const last = dates.at(-1), prev = dates.at(-2), wk = [...dates].reverse().find((d) => d < mondayOf(last));
const all = ['USD', ...ccys];
const vsSeven = (c, from) => all.filter((x) => x !== c).reduce((s, x) => s + pct(usd[c][last] / usd[x][last], usd[c][from] / usd[x][from]), 0) / 7;
const rank = (from) => all.map((c) => [c, vsSeven(c, from)]).sort((a, b) => b[1] - a[1]).map(([c, v]) => `${c} ${f(v)}%`).join(', ');
out.push('', `FX, each currency against the other seven (closes ${prev} -> ${last}): ${rank(prev)}`);
out.push(`FX, week (last close before ${mondayOf(last)}, ${wk} -> ${last}): ${rank(wk)}`);
const pair = (b, q, from) => pct(usd[b][last] / usd[q][last], usd[b][from] / usd[q][from]);
out.push(`AUDJPY ${(usd.AUD[last] / usd.JPY[last]).toFixed(3)} · session ${f(pair('AUD', 'JPY', prev))}% · week ${f(pair('AUD', 'JPY', wk))}%`);
console.log(out.join('\n'));
