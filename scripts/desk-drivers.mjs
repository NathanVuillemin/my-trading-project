#!/usr/bin/env node
// desk-drivers.mjs: the cross-asset drivers Market Context does not carry, for the desk's Drivers page and
// the trend x volatility tags on the Scorecard. Writes dashboard/desk/data/drivers.json.
//
// Every block follows a Market Macro Hub module and stays a reading, never a call:
//   liquidity   06 Liquidity: Fed balance sheet - Treasury General Account - reverse repo, weekly.
//   gold        23 Gold: driver stack in the course's order: real yields, dollar, liquidity, (COT on the page), stress.
//   curve       03 / 03.1 Rates: US curve pairs, each tagged bull/bear steepener/flattener over 1 week and 1 month.
//   growth      04 Growth: leading, coincident and lagging US series, each improving or deteriorating over 3 months.
//   inflation   05 Inflation / FX II: US CPI year on year vs recent annualised pace, and where the pace leads in 6 months.
//   bounce      Alfie's test (00.4): was the equity bounce positioning or durable?
//   stockBond   08 Correlations: rolling 60-day correlation of S&P and long Treasuries.
//   pairs       00.9 Regimes: each of the 28 pairs as trend state x volatility state.
//
// Sources, all keyless: FRED's fredgraph.csv download, Yahoo Finance chart API.
// Usage: node scripts/desk-drivers.mjs [--out path]

import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1]; };
const OUT = arg('out', join(__dir, '..', 'dashboard', 'desk', 'data', 'drivers.json'));
const UA = { 'User-Agent': 'Mozilla/5.0 (my-trading-project desk)' };
const warns = [];
const r2 = (n, d = 2) => (n == null || !Number.isFinite(n) ? null : Number(n.toFixed(d)));
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

async function fred(id, days = 800) {
  const r = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${daysAgo(days)}`, { headers: UA, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`FRED ${id}: HTTP ${r.status}`);
  return (await r.text()).trim().split(/\r?\n/).slice(1)
    .map((l) => { const [d, v] = l.split(','); return { d, v: v === '.' || v === '' ? null : +v }; })
    .filter((x) => x.v != null && Number.isFinite(x.v));
}
async function yahoo(sym, range = '2y') {
  let err;
  for (const host of ['query1', 'query2']) {
    try {
      const r = await fetch(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=1d`, { headers: UA, signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const res = (await r.json())?.chart?.result?.[0];
      const c = res?.indicators?.quote?.[0]?.close || [];
      const out = [];
      (res?.timestamp || []).forEach((t, i) => { if (c[i] != null) out.push({ d: new Date(t * 1000).toISOString().slice(0, 10), v: c[i] }); });
      if (!out.length) throw new Error('empty');
      return out;
    } catch (e) { err = e; }
  }
  throw new Error(`Yahoo ${sym}: ${err.message}`);
}
const safe = async (label, fn) => { try { return await fn(); } catch (e) { warns.push(`${label}: ${e.message}`); return null; } };
// Monthly FRED dates (YYYY-MM-01) shifted back k months. Year-on-year and n-month paces compare a month with the
// same calendar month k back, never "k rows back": a month the agency never published (October 2025 CPI, lost to
// the shutdown) would otherwise turn a 12-month change into a 13-month one without saying so.
const monthBack = (d, k) => { const [y, m] = d.split('-').map(Number), t = y * 12 + (m - 1) - k; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}-01`; };
// Value on or before a date.
const at =(rows, date) => { let v = null; for (const r of rows) { if (r.d > date) break; v = r.v; } return v; };
const last = (rows) => rows[rows.length - 1];
const weekly = (rows, n = 52) => { const out = []; for (let i = rows.length - 1; i >= 0 && out.length < n; i -= 5) out.unshift([rows[i].d, r2(rows[i].v, 3)]); return out; };
const pctile = (arr, v) => Math.round((arr.filter((x) => x <= v).length / arr.length) * 100);

const out = { generatedAt: new Date().toISOString() };

// ---------- liquidity (06) ----------
out.liquidity = await safe('liquidity', async () => {
  const [walcl, tga, rrp] = await Promise.all([fred('WALCL'), fred('WTREGEN'), fred('RRPONTSYD')]);
  // Units: WALCL and WTREGEN in $ millions, RRPONTSYD in $ billions. Net = Fed assets - TGA - RRP, in $bn, per Fed week.
  const series = walcl.map((w) => ({ d: w.d, v: w.v / 1000 - (at(tga, w.d) ?? 0) / 1000 - (at(rrp, w.d) ?? 0) })).filter((x) => x.v);
  const n = series.length, now = series[n - 1];
  return {
    asOf: now.d, netBn: Math.round(now.v), chg4wBn: Math.round(now.v - series[n - 5].v), chg13wBn: Math.round(now.v - series[n - 14].v),
    parts: { fedBn: Math.round(last(walcl).v / 1000), tgaBn: Math.round(last(tga).v / 1000), rrpBn: Math.round(last(rrp).v) },
    history: series.slice(-104).map((x) => [x.d, Math.round(x.v)]),
  };
});

// ---------- gold driver stack (23) ----------
out.gold = await safe('gold', async () => {
  const [real, usd, gold, vix, hy] = await Promise.all([fred('DFII10'), fred('DTWEXBGS'), yahoo('GC=F'), yahoo('^VIX'), fred('BAMLH0A0HYM2')]);
  const block = (rows, lookback = 260) => {
    const n = rows.length, now = rows[n - 1].v, w1 = rows[Math.max(0, n - 6)].v, m3 = rows[Math.max(0, n - 64)].v;
    const win = rows.slice(-lookback).map((x) => x.v);
    return { asOf: rows[n - 1].d, value: r2(now), chg1w: r2(now - w1), chg3m: r2(now - m3), pctile1y: pctile(win, now), history: weekly(rows) };
  };
  return { realYield10y: block(real), dollarBroad: block(usd), goldFutures: block(gold), vix: block(vix), hySpread: block(hy) };
});

// ---------- US curve regimes (03 / 03.1) ----------
out.curve = await safe('curve', async () => {
  const ids = { '3M': 'DGS3MO', '2Y': 'DGS2', '5Y': 'DGS5', '10Y': 'DGS10', '30Y': 'DGS30' };
  const s = Object.fromEntries(await Promise.all(Object.entries(ids).map(async ([k, id]) => [k, await fred(id, 500)])));
  const dates = s['10Y'].map((x) => x.d), dLast = dates[dates.length - 1];
  const ago = (n) => dates[Math.max(0, dates.length - 1 - n)];
  // Bull = yields fell, bear = yields rose; steepener = back end higher relative to front, flattener = the reverse.
  const regime = (front, back, from) => {
    const df = at(s[front], dLast) - at(s[front], from), db = at(s[back], dLast) - at(s[back], from);
    const level = (df + db) / 2, slope = db - df;
    if (Math.abs(slope) < 0.03 && Math.abs(level) < 0.03) return { tag: 'unchanged', level: r2(level), slope: r2(slope) };
    return { tag: `${level < 0 ? 'bull' : 'bear'} ${slope > 0 ? 'steepener' : 'flattener'}`, level: r2(level), slope: r2(slope) };
  };
  const PAIRS = [['3M', '2Y'], ['2Y', '5Y'], ['2Y', '10Y'], ['5Y', '30Y'], ['10Y', '30Y']];
  return {
    asOf: dLast,
    yields: Object.fromEntries(Object.keys(ids).map((k) => [k, { now: r2(at(s[k], dLast)), w1: r2(at(s[k], ago(5))), m1: r2(at(s[k], ago(21))), m3: r2(at(s[k], ago(63))) }])),
    pairs: PAIRS.map(([f, b]) => ({
      name: `${f.toLowerCase()}${b.toLowerCase()}`, front: f, back: b,
      spreadBp: Math.round((at(s[b], dLast) - at(s[f], dLast)) * 100),
      w1: regime(f, b, ago(5)), m1: regime(f, b, ago(21)),
      history: weekly(s[b].map((x) => ({ d: x.d, v: (x.v - (at(s[f], x.d) ?? x.v)) * 100 }))),
    })),
  };
});

// ---------- US growth breadth (04) ----------
out.growth = await safe('growth', async () => {
  // Each series is read as a stronger or weaker economy. invert: a rise means weaker (claims, unemployment,
  // delinquencies). Core inflation and wages rising = a hotter economy, so they read 'stronger', not 'better'. yoy: compare year-on-year rates, not levels.
  const SERIES = [
    { group: 'leading', id: 'ICSA', label: 'Initial jobless claims (4-week avg)', invert: true, smooth: 4 },
    { group: 'leading', id: 'PERMIT', label: 'Building permits' },
    { group: 'leading', id: 'T10Y2Y', label: 'Yield curve 10y-2y', diff: true },
    { group: 'leading', id: 'UMCSENT', label: 'Consumer sentiment (Michigan)' },
    { group: 'leading', id: 'NEWORDER', label: 'Core capital goods orders' },
    { group: 'coincident', id: 'PAYEMS', label: 'Nonfarm payrolls' },
    { group: 'coincident', id: 'INDPRO', label: 'Industrial production' },
    { group: 'coincident', id: 'RRSFS', label: 'Real retail sales' },
    { group: 'coincident', id: 'W875RX1', label: 'Real income ex transfers' },
    { group: 'lagging', id: 'UNRATE', label: 'Unemployment rate', invert: true, diff: true },
    { group: 'lagging', id: 'CPILFESL', label: 'Core CPI (year on year)', yoy: true },
    { group: 'lagging', id: 'CES0500000003', label: 'Average hourly earnings (year on year)', yoy: true },
    { group: 'lagging', id: 'DRCCLACBS', label: 'Credit card delinquency rate', invert: true, diff: true },
  ];
  const rows = [];
  for (const s of SERIES) {
    const data = await safe(`growth ${s.id}`, () => fred(s.id, 1200));
    if (!data || data.length < 6) continue;
    let vals = data.map((x) => x.v);
    if (s.smooth) vals = vals.map((_, i) => (i < s.smooth - 1 ? null : vals.slice(i - s.smooth + 1, i + 1).reduce((a, b) => a + b, 0) / s.smooth));
    const dates = data.map((x) => x.d);
    let series = dates.map((d, i) => ({ d, v: vals[i] })).filter((x) => x.v != null);
    if (s.yoy) { const byD = new Map(series.map((x) => [x.d, x.v])); series = series.map((x) => { const prev = byD.get(monthBack(x.d, 12)); return { d: x.d, v: prev ? (x.v / prev - 1) * 100 : null }; }).filter((x) => x.v != null); }
    const n = series.length, now = series[n - 1];
    const back = at(series, new Date(Date.parse(now.d) - 92 * 864e5).toISOString().slice(0, 10));
    const back2 = at(series, new Date(Date.parse(now.d) - 184 * 864e5).toISOString().slice(0, 10));
    const change = s.diff || s.yoy ? now.v - back : (now.v / back - 1) * 100;
    const prevChange = s.diff || s.yoy ? back - back2 : (back / back2 - 1) * 100;
    const sign = (x) => (Math.abs(x) < 1e-9 ? 0 : x > 0 ? 1 : -1) * (s.invert ? -1 : 1);
    rows.push({
      group: s.group, id: s.id, label: s.label, asOf: now.d, value: r2(now.v), unit: s.yoy ? '% y/y' : s.diff ? '' : '',
      chg3m: r2(change), chg3mUnit: s.diff || s.yoy ? 'pt' : '%',
      read: sign(change) > 0 ? 'stronger' : sign(change) < 0 ? 'weaker' : 'flat',
      // Second derivative: is the 3-month change better than the 3 months before? "Bad to less bad" lives here.
      turning: sign(change - prevChange) > 0 ? 'accelerating' : sign(change - prevChange) < 0 ? 'decelerating' : 'steady',
      history: weekly(series.map((x) => ({ d: x.d, v: x.v })), 40),
    });
  }
  const breadth = Object.fromEntries(['leading', 'coincident', 'lagging'].map((g) => {
    const xs = rows.filter((r) => r.group === g);
    return [g, { stronger: xs.filter((r) => r.read === 'stronger').length, weaker: xs.filter((r) => r.read === 'weaker').length, n: xs.length }];
  }));
  return { series: rows, breadth };
});

// ---------- US inflation glide path (05 / FX II) ----------
out.inflation = await safe('inflation', async () => {
  const build = async (id, label) => {
    const s = await fred(id, 900);
    const n = s.length, byD = new Map(s.map((x) => [x.d, x.v])), lastD = s[n - 1].d, lastV = s[n - 1].v;
    const change = (d, k) => { const b = byD.get(monthBack(d, k)), v = byD.get(d); return b && v ? v / b : null; };
    const momPrev = byD.get(monthBack(lastD, 1));
    // Year on year for the newest month that has its base month; yoyAsOf says which month that is.
    const yoyRow = [...s].reverse().find((x) => change(x.d, 12) != null);
    const yoy = yoyRow ? (change(yoyRow.d, 12) - 1) * 100 : null;
    const ann = (k) => { const c = change(lastD, k); return c == null ? null : (c ** (12 / k) - 1) * 100; };
    const c3 = change(lastD, 3), pace3 = c3 == null ? null : Math.pow(c3, 1 / 3) - 1;   // average monthly pace, last 3 months
    // Where year on year lands each month for the next 6 if the monthly pace is held, halved, doubled or zero.
    const scen = { 'pace doubles': pace3 * 2, 'pace held': pace3, 'pace halves': pace3 / 2, 'prices flat': 0 };
    const paths = pace3 == null ? {} : Object.fromEntries(Object.entries(scen).map(([k, m]) => {
      const p = [];
      for (let h = 1; h <= 6; h++) { const base = byD.get(monthBack(monthBack(lastD, -h), 12)); p.push(base ? r2((lastV * (1 + m) ** h / base - 1) * 100) : null); }
      return [k, p];
    }));
    return { id, label, asOf: lastD, yoy: r2(yoy), yoyAsOf: yoyRow?.d ?? null, ann3m: r2(ann(3)), ann6m: r2(ann(6)), lastMoM: momPrev ? r2((lastV / momPrev - 1) * 100, 2) : null, history: s.slice(-25).map((x) => { const c = change(x.d, 12); return [x.d, c == null ? null : r2((c - 1) * 100)]; }).filter((x) => x[1] != null), paths };
  };
  const [headline, core, be] = await Promise.all([build('CPIAUCSL', 'CPI'), build('CPILFESL', 'Core CPI'), fred('T5YIE', 60)]);
  return { headline, core, breakeven5y: { asOf: last(be).d, value: r2(last(be).v) }, target: 2 };
});

// ---------- bounce check (Alfie / 00.4) and stock-bond correlation (08) ----------
const eq = await safe('equities', async () => Object.fromEntries(await Promise.all(['SPY', 'RSP', 'IWM', 'SPHB', 'SPLV', 'TLT', '^VIX'].map(async (t) => [t, await yahoo(t)]))));
const rets = (rows) => rows.map((x, i) => (i ? Math.log(x.v / rows[i - 1].v) : null));
if (eq) {
  out.bounce = await safe('bounce', async () => {
    const spy = eq.SPY, n = spy.length, d = spy[n - 1].d;
    const ch = (rows, k) => (at(rows, d) / at(rows, spy[n - 1 - k].d) - 1) * 100;
    const rel = (a, b, k) => ch(eq[a], k) - ch(eq[b], k);
    const r = rets(spy).slice(-20);
    const realised = Math.sqrt(r.reduce((s, x) => s + x * x, 0) / r.length) * Math.sqrt(252) * 100;
    const vixNow = at(eq['^VIX'], d);
    const dgs2 = await fred('DGS2', 60);
    const twoYchg = (at(dgs2, d) - at(dgs2, spy[n - 6].d)) * 100;
    // Which bottomed first over the last 3 months: long bonds (TLT) or the S&P? Durable bounces see bonds turn first.
    const lowDate = (rows) => rows.slice(-63).reduce((m, x) => (x.v < m.v ? x : m)).d;
    const bondsLow = lowDate(eq.TLT), spyLow = lowDate(spy);
    const checks = [
      { key: 'vol', label: 'Implied vol vs realised (VIX vs S&P 20-day realised)', value: `${r2(vixNow, 1)} vs ${r2(realised, 1)}`, read: vixNow < realised ? 'positioning' : 'durable', why: vixNow < realised ? 'implied vol below realised: hedges were sold into the bounce' : 'implied vol still above realised: no hedge dump' },
      { key: 'rates', label: 'US 2y yield over the last week', value: `${twoYchg > 0 ? '+' : ''}${Math.round(twoYchg)}bp`, read: ch(spy, 5) > 0 && twoYchg > 5 ? 'positioning' : 'durable', why: ch(spy, 5) > 0 && twoYchg > 5 ? 'stocks up while the 2y rose: rates gave no relief' : 'rates not fighting the move' },
      { key: 'breadth', label: 'Equal-weight S&P vs S&P, 20 days', value: `${rel('RSP', 'SPY', 20) > 0 ? '+' : ''}${r2(rel('RSP', 'SPY', 20), 1)}%`, read: rel('RSP', 'SPY', 20) > 0 ? 'durable' : 'positioning', why: 'breadth confirms when the average stock keeps up' },
      { key: 'smallcaps', label: 'Small caps vs S&P, 20 days', value: `${rel('IWM', 'SPY', 20) > 0 ? '+' : ''}${r2(rel('IWM', 'SPY', 20), 1)}%`, read: rel('IWM', 'SPY', 20) > 0 ? 'durable' : 'positioning', why: 'small caps lead in durable recoveries' },
      { key: 'beta', label: 'High beta vs low volatility, 20 days', value: `${rel('SPHB', 'SPLV', 20) > 0 ? '+' : ''}${r2(rel('SPHB', 'SPLV', 20), 1)}%`, read: rel('SPHB', 'SPLV', 20) > 0 ? 'durable' : 'positioning', why: 'high beta outperforming while yields hold is risk appetite returning' },
      { key: 'order', label: 'Which bottomed first (3 months)', value: `bonds ${bondsLow}, S&P ${spyLow}`, read: bondsLow <= spyLow ? 'durable' : 'positioning', why: bondsLow <= spyLow ? 'bonds turned before equities' : 'equities turned without bonds leading' },
    ];
    return { asOf: d, spy5d: r2(ch(spy, 5), 1), spy20d: r2(ch(spy, 20), 1), checks, durable: checks.filter((c) => c.read === 'durable').length, n: checks.length };
  });
  out.stockBond = await safe('stockBond', async () => {
    const spy = eq.SPY, tlt = eq.TLT, dates = spy.map((x) => x.d).filter((d) => tlt.some((t) => t.d === d));
    const pairs = dates.map((d, i) => (i ? [Math.log(at(spy, d) / at(spy, dates[i - 1])), Math.log(at(tlt, d) / at(tlt, dates[i - 1]))] : null)).slice(1);
    const corr = (xs) => { const n = xs.length, ma = xs.reduce((s, x) => s + x[0], 0) / n, mb = xs.reduce((s, x) => s + x[1], 0) / n; let c = 0, va = 0, vb = 0; for (const [a, b] of xs) { c += (a - ma) * (b - mb); va += (a - ma) ** 2; vb += (b - mb) ** 2; } return c / Math.sqrt(va * vb); };
    const hist = [];
    for (let i = 60; i <= pairs.length; i += 5) hist.push([dates[i], r2(corr(pairs.slice(i - 60, i)))]);
    const now = r2(corr(pairs.slice(-60)));
    return { asOf: dates[dates.length - 1], corr60d: now, read: now > 0.2 ? 'positive: bonds amplify equity moves (inflation-driven regime)' : now < -0.2 ? 'negative: bonds hedge equities (growth-driven regime)' : 'near zero: no reliable hedge', history: hist.slice(-80) };
  });
}

// ---------- pair regimes (00.9) ----------
out.pairs = await safe('pairs', async () => {
  const FEED = { EUR: ['EURUSD=X', false], GBP: ['GBPUSD=X', false], AUD: ['AUDUSD=X', false], NZD: ['NZDUSD=X', false], JPY: ['JPY=X', true], CHF: ['CHF=X', true], CAD: ['CAD=X', true] };
  const usd = {};
  for (const [c, [sym, inv]] of Object.entries(FEED)) usd[c] = (await yahoo(sym)).map((x) => ({ d: x.d, v: inv ? 1 / x.v : x.v }));
  const dates = usd.EUR.map((x) => x.d).filter((d) => Object.values(usd).every((rows) => rows.some((r) => r.d === d)));
  const val = (c, d) => (c === 'USD' ? 1 : at(usd[c], d));
  const ORDER = ['EUR', 'GBP', 'AUD', 'NZD', 'USD', 'CAD', 'CHF', 'JPY'];
  const res = {};
  for (let i = 0; i < ORDER.length; i++) for (let j = i + 1; j < ORDER.length; j++) {
    const b = ORDER[i], q = ORDER[j], px = dates.map((d) => val(b, d) / val(q, d));
    const k = 2 / 51; let ema = px[0]; const emas = px.map((p) => (ema = p * k + ema * (1 - k)));
    const absMoves = px.map((p, t) => (t ? Math.abs(p / px[t - 1] - 1) : null)).slice(1);
    const vol20 = (t) => absMoves.slice(t - 20, t).reduce((s, x) => s + x, 0) / 20;
    const vols = []; for (let t = 20; t <= absMoves.length; t++) vols.push(vol20(t));
    const volNow = vols[vols.length - 1], volMed = [...vols.slice(-252)].sort((a, b) => a - b)[Math.floor(Math.min(252, vols.length) / 2)];
    const n = px.length, trend = px[n - 1] >= emas[n - 1] ? 'up' : 'down', vol = volNow >= volMed ? 'high' : 'low';
    res[b + q] = { trend, vol, regime: `${trend === 'up' ? 'rising' : 'falling'}, ${vol} volatility`, vsEmaPct: r2((px[n - 1] / emas[n - 1] - 1) * 100), volRatio: r2(volNow / volMed) };
  }
  return { asOf: dates[dates.length - 1], method: 'Trend: close vs 50-day EMA. Volatility: 20-day average absolute daily move vs its 1-year median.', pairs: res };
});

out.warns = warns;
writeFileSync(OUT, JSON.stringify(out) + '\n');
console.log(`liquidity ${out.liquidity?.netBn}bn (4w ${out.liquidity?.chg4wBn}) · real 10y ${out.gold?.realYield10y?.value} · curve ${out.curve?.pairs?.map((p) => `${p.name} ${p.m1.tag}`).join(', ')}`);
console.log(`growth breadth ${JSON.stringify(out.growth?.breadth)} · core CPI y/y ${out.inflation?.core?.yoy} 3m ann ${out.inflation?.core?.ann3m}`);
console.log(`bounce durable ${out.bounce?.durable}/${out.bounce?.n} · stock-bond corr ${out.stockBond?.corr60d} · pairs ${Object.keys(out.pairs?.pairs || {}).length}`);
if (warns.length) console.log('Warnings:\n  ' + warns.join('\n  '));
console.log(`Wrote ${OUT}`);
