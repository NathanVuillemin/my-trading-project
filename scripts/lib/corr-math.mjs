// corr-math.mjs: pure maths behind the Drivers page's "who is driving" section.
// No I/O here: scripts/correlations.mjs fetches the series and calls these. Tests: corr-math.test.mjs.
//
// Rules (spec docs/superpowers/specs/2026-11-17-drivers-correlations-design.md):
//   in control      aligned r20 >= 0.5;  not in control  aligned r20 < 0.3;  between keeps the state.
//   wrong way       aligned r20 <= -0.3 (a flag on "not in control").
//   breaking        in control, but aligned 3-day r below the 10th percentile of its 2-year normal.
//   aligned         r times the sign of the link's usual direction (inverse links flip).

export const IN = 0.5, OUT = 0.3, WRONG = -0.3, MIN_3D = 18;

export function pearson(x, y) {
  const n = Math.min(x.length, y.length);
  if (n < 3) return null;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += x[i]; my += y[i]; }
  mx /= n; my /= n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = x[i] - mx, dy = y[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxx > 1e-18 && syy > 1e-18 ? sxy / Math.sqrt(sxx * syy) : null;
}

export function beta(x, y) {
  const n = Math.min(x.length, y.length);
  if (n < 3) return null;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += x[i]; my += y[i]; }
  mx /= n; my /= n;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; }
  return sxx > 1e-18 ? sxy / sxx : null;
}

const step = (kind, v0, v1) => (kind === 'yield' ? v1 - v0 : Math.log(v1 / v0));

// Aligned daily moves on the dates both series have a value.
export function dailyMoves(sa, sb, kindA, kindB) {
  const dates = [...sa.keys()].filter((d) => sb.has(d)).sort();
  const out = { dates: [], a: [], b: [] };
  for (let i = 1; i < dates.length; i++) {
    out.dates.push(dates[i]);
    out.a.push(step(kindA, sa.get(dates[i - 1]), sa.get(dates[i])));
    out.b.push(step(kindB, sb.get(dates[i - 1]), sb.get(dates[i])));
  }
  return out;
}

// Aligned hourly moves on the UTC hour stamps both series have.
export function hourlyMoves(sa, sb, kindA, kindB) {
  const ts = [...sa.keys()].filter((t) => sb.has(t)).sort((x, y) => x - y);
  const out = { t: [], a: [], b: [] };
  for (let i = 1; i < ts.length; i++) {
    out.t.push(ts[i]);
    out.a.push(step(kindA, sa.get(ts[i - 1]), sa.get(ts[i])));
    out.b.push(step(kindB, sb.get(ts[i - 1]), sb.get(ts[i])));
  }
  return out;
}

export function rolling(m, w) {
  return m.a.map((_, i) => (i + 1 >= w ? pearson(m.a.slice(i + 1 - w, i + 1), m.b.slice(i + 1 - w, i + 1)) : null));
}
export function rollingBeta(m, w) {
  return m.a.map((_, i) => (i + 1 >= w ? beta(m.b.slice(i + 1 - w, i + 1), m.a.slice(i + 1 - w, i + 1)) : null));
}

export function pctl(values, p) {
  const v = values.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const idx = (v.length - 1) * p, lo = Math.floor(idx), hi = Math.ceil(idx);
  return v[lo] + (v[hi] - v[lo]) * (idx - lo);
}
export function normalBand(values) {
  const p50 = pctl(values, 0.5);
  return p50 == null ? null : { p10: pctl(values, 0.1), p50, p90: pctl(values, 0.9) };
}
const median = (v) => pctl(v, 0.5);

const dayOf = (t) => new Date(t * 1000).toISOString().slice(0, 10);

// The moves whose UTC date is among the last 3 distinct dates present (so a Monday run skips the weekend).
export function threeDayWindow(m, end = m.t.length - 1) {
  const days = [];
  let i = end;
  for (; i >= 0; i--) {
    const d = dayOf(m.t[i]);
    if (!days.includes(d)) { if (days.length === 3) break; days.push(d); }
  }
  const a = m.a.slice(i + 1, end + 1), b = m.b.slice(i + 1, end + 1);
  return { a, b, n: a.length };
}

// One 3-day reading per trading day (the window ending at that day's last shared hour).
export function r3dSeries(m) {
  const out = [];
  for (let i = 0; i < m.t.length; i++) {
    const d = dayOf(m.t[i]);
    if (i + 1 < m.t.length && dayOf(m.t[i + 1]) === d) continue;
    const w = threeDayWindow(m, i);
    out.push({ date: d, r: w.n >= MIN_3D ? pearson(w.a, w.b) : null, n: w.n });
  }
  return out;
}

const signOf = (typical) => (typical === 'inverse' ? -1 : 1);

// State per index with hysteresis; null before the first reading.
export function stateSeries(r20s, typical) {
  const s = signOf(typical);
  let cur = null;
  return r20s.map((r) => {
    if (r == null) return cur;
    const a = r * s;
    if (cur == null) cur = a >= IN ? 'in' : 'out';
    else if (a >= IN) cur = 'in';
    else if (a < OUT) cur = 'out';
    return cur;
  });
}

export function linkState(r20s, dates, typical) {
  const states = stateSeries(r20s, typical);
  const last = states.length - 1;
  let since = last;
  while (since > 0 && states[since - 1] === states[last]) since--;
  const lastR = [...r20s].reverse().find((r) => r != null);
  return { state: states[last] ?? 'out', since: dates[since], wrongWay: lastR != null && lastR * signOf(typical) <= WRONG };
}

// ---------- market regime (Macro Tracker v5 "Risk & Gold" and "Hub", plus safe havens) ----------
export function vixRule(vix, spx, spx200) {
  if (vix == null) return null;
  if (vix > 30) return 'risk-off';
  if (vix < 18 && spx != null && spx200 != null && spx > spx200) return 'risk-on';
  return 'caution';
}
export function gaugeRead(chg20, sd, risingIsOn) {
  if (chg20 == null || sd == null) return 'neutral';
  if (Math.abs(chg20) <= 0.25 * sd) return 'neutral';
  return (chg20 > 0) === risingIsOn ? 'on' : 'off';
}
export function verdict(reads) {
  const on = reads.filter((r) => r === 'on').length, off = reads.filter((r) => r === 'off').length;
  return on - off >= 2 ? 'risk-on' : off - on >= 2 ? 'risk-off' : 'mixed';
}
export function agree(vix, v) {
  if (v === 'mixed' || vix === 'caution') return 'partly';
  return vix === v ? 'yes' : 'no';
}
export function split3(chg, up, down, [hi, mid, lo]) {
  if (chg == null) return null;
  return chg > up ? hi : chg < down ? lo : mid;
}

const sd = (v) => { const x = v.filter((n) => n != null); if (x.length < 2) return null; const m = x.reduce((a, b) => a + b, 0) / x.length; return Math.sqrt(x.reduce((a, b) => a + (b - m) ** 2, 0) / (x.length - 1)); };

// s: Maps by date for vix, spx, us2y (pct), dxy, audjpy, copper, gold, hy (pct, may be partial), xly, xlp,
// usdjpy, usdchf, tlt. Calendar = the S&P's dates; other series carry their last value forward.
export const GAUGES = [
  { key: 'audjpy', label: 'AUDJPY', risingIsOn: true, why: 'Money leaving the haven yen for higher-yielding AUD' },
  { key: 'copperGold', label: 'Copper / gold', risingIsOn: true, why: 'Growth metal beating the haven metal' },
  { key: 'hy', label: 'US high-yield spread', risingIsOn: false, why: 'Lenders relaxed about risky borrowers when it falls' },
  { key: 'xlyXlp', label: 'Discretionary / staples', risingIsOn: true, why: "Investors buying 'wants' over 'needs'" },
  { key: 'havens', label: 'Safe havens vs S&P', risingIsOn: false, why: 'Yen, franc, gold and long Treasuries beating stocks' },
];
export function buildRegime(s) {
  const dates = [...s.spx.keys()].sort();
  const ff = (m) => { let last = null; return dates.map((d) => { if (m?.has(d)) last = m.get(d); return last; }); };
  const S = Object.fromEntries(Object.entries(s).map(([k, m]) => [k, ff(m)]));
  const n = dates.length;
  const lchg = (arr, i, w) => (i >= w && arr[i] != null && arr[i - w] != null && arr[i - w] > 0 ? Math.log(arr[i] / arr[i - w]) : null);
  const dchg = (arr, i, w) => (i >= w && arr[i] != null && arr[i - w] != null ? arr[i] - arr[i - w] : null);
  const ratio = (a, b) => a.map((v, i) => (v != null && b[i] ? v / b[i] : null));
  const lvl = { audjpy: S.audjpy, copperGold: ratio(S.copper, S.gold), hy: S.hy, xlyXlp: ratio(S.xly, S.xlp) };
  const chg = {
    audjpy: (i) => lchg(S.audjpy, i, 20), copperGold: (i) => lchg(lvl.copperGold, i, 20), hy: (i) => dchg(S.hy, i, 20),
    xlyXlp: (i) => lchg(lvl.xlyXlp, i, 20),
    havens: (i) => {
      const parts = [lchg(S.usdjpy, i, 20), lchg(S.usdchf, i, 20), lchg(S.gold, i, 20), lchg(S.tlt, i, 20)];
      const spx = lchg(S.spx, i, 20);
      if (parts.some((p) => p == null) || spx == null) return null;
      return (-parts[0] - parts[1] + parts[2] + parts[3]) / 4 - spx;
    },
  };
  const chgs = Object.fromEntries(GAUGES.map((g) => [g.key, dates.map((_, i) => chg[g.key](i))]));
  const spx200 = dates.map((_, i) => (i >= 199 ? S.spx.slice(i - 199, i + 1).reduce((a, b) => a + (b ?? 0), 0) / 200 : null));
  const byDate = new Map(), rows = [];
  for (let i = 0; i < n; i++) {
    const vix = vixRule(S.vix[i], S.spx[i], spx200[i]);
    const reads = GAUGES.map((g) => {
      const c = chgs[g.key][i];
      if (c == null || i < 252) return null;
      return gaugeRead(c, sd(chgs[g.key].slice(i - 251, i + 1)), g.risingIsOn);
    });
    const live = reads.filter((r) => r != null);
    const v = live.length >= 3 ? verdict(live) : null;
    const ratesBp = dchg(S.us2y, i, 63), dxyPct = lchg(S.dxy, i, 63);
    const row = {
      vix, verdict: v, agree: vix && v ? agree(vix, v) : null, reads,
      rates: split3(ratesBp == null ? null : ratesBp * 100, 25, -25, ['rising', 'flat', 'falling']),
      dollar: split3(dxyPct == null ? null : dxyPct * 100, 2, -2, ['strengthening', 'flat', 'weakening']),
      ratesBp: ratesBp == null ? null : ratesBp * 100, dxyPct: dxyPct == null ? null : dxyPct * 100,
    };
    byDate.set(dates[i], row);
    rows.push(row);
  }
  const L = n - 1, now = rows[L], r2 = (x, d = 2) => (x == null ? null : Number(x.toFixed(d)));
  return {
    byDate,
    now: {
      asOf: dates[L],
      vix: { value: r2(S.vix[L]), spx: r2(S.spx[L], 0), spx200: r2(spx200[L], 0), rule: now.vix },
      gauges: GAUGES.map((g, k) => ({
        key: g.key, label: g.label, why: g.why, risingIsOn: g.risingIsOn,
        chg20: r2(chgs[g.key][L] == null ? null : chgs[g.key][L] * (g.key === 'hy' ? 1 : 100)), unit: g.key === 'hy' ? 'pt' : '%',
        read: now.reads[k] ?? 'no data',
        spark: g.key === 'havens' ? dates.slice(-60).map((d, j) => [d, r2(chgs.havens[L - 59 + j] == null ? null : chgs.havens[L - 59 + j] * 100)]) : dates.slice(-60).map((d, j) => [d, r2(lvl[g.key][L - 59 + j], 4)]),
      })),
      verdict: now.verdict ?? 'mixed', agree: now.agree,
      rates: { chg63bp: r2(now.ratesBp, 0), split: now.rates }, dollar: { chg63pct: r2(now.dxyPct, 1), split: now.dollar },
    },
    history: dates.map((d, i) => (i % 5 === L % 5 ? { date: d, rule: rows[i].vix, verdict: rows[i].verdict } : null)).filter(Boolean),
  };
}

// Medians and share in control per regime bucket.
export function regimeTable(rows) {
  const out = {};
  for (const dim of ['vix', 'rates', 'dollar']) {
    const groups = {};
    for (const r of rows) { if (r[dim] == null) continue; (groups[r[dim]] ||= []).push(r); }
    out[dim] = Object.fromEntries(Object.entries(groups).map(([k, g]) => [k, {
      r60: median(g.map((x) => x.r60)), beta: median(g.map((x) => x.beta)),
      shareIn: g.filter((x) => x.inCtrl).length / g.length, n: g.length,
    }]));
  }
  return out;
}

// ---------- one link ----------
const r2 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);
const band2 = (b) => (b ? { p10: r2(b.p10), p50: r2(b.p50), p90: r2(b.p90) } : null);
const yearsAgo = (iso, y) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCFullYear(d.getUTCFullYear() - y); return d.toISOString().slice(0, 10); };

// cfg: { id, target, driver, typical, kindT, kindD, hT?, hD? } (keys into daily / hourly).
// regimeByDate: Map date -> { vix, rates, dollar } from buildRegime.
export function buildLink(cfg, daily, hourly, regimeByDate) {
  const T = daily[cfg.target], Dd = daily[cfg.driver];
  if (!T || !Dd) return { ...cfg, status: 'no data' };
  const m = dailyMoves(T, Dd, cfg.kindT, cfg.kindD);
  if (m.a.length < 80) return { ...cfg, status: 'no data', obs: m.a.length };
  const L = m.a.length - 1, end = m.dates[L], from5 = yearsAgo(end, 5);
  const r20s = rolling(m, 20), r60s = rolling(m, 60), betas = rollingBeta(m, 60);
  const in5 = (i) => m.dates[i] >= from5;
  const idx5 = m.dates.map((_, i) => i).filter(in5);
  const sgn = signOf(cfg.typical);
  const states = stateSeries(r20s, cfg.typical);
  const st = linkState(r20s, m.dates, cfg.typical);

  let r3d = null;
  if (cfg.hT && cfg.hD && hourly[cfg.hT] && hourly[cfg.hD]) {
    const hm = hourlyMoves(hourly[cfg.hT], hourly[cfg.hD], cfg.kindT, cfg.kindD);
    const s3 = r3dSeries(hm), last = s3.at(-1);
    if (last) r3d = { r: r2(last.r), n: last.n, normal: band2(normalBand(s3.map((x) => x.r))), asOf: last.date };
  }
  const alignedP10 = (b) => (b ? (sgn > 0 ? b.p10 : -b.p90) : null);
  const breaking = st.state === 'in' && r3d?.r != null && r3d.normal ? r3d.r * sgn < alignedP10(r3d.normal) : false;

  const changes = [];
  for (const i of idx5) if (i > 0 && states[i] !== states[i - 1] && states[i - 1] != null) changes.push([m.dates[i], states[i]]);
  const rows = idx5.filter((i) => r60s[i] != null).map((i) => {
    const g = regimeByDate.get(m.dates[i]) || {};
    return { r60: r60s[i], beta: betas[i], inCtrl: states[i] === 'in', vix: g.vix ?? null, rates: g.rates ?? null, dollar: g.dollar ?? null };
  });
  const tbl = regimeTable(rows);
  for (const dim of Object.values(tbl)) for (const k of Object.keys(dim)) dim[k] = { r60: r2(dim[k].r60), beta: r2(dim[k].beta), shareIn: r2(dim[k].shareIn), n: dim[k].n };

  return {
    ...cfg,
    asOfT: [...T.keys()].sort().at(-1), asOfD: [...Dd.keys()].sort().at(-1), obs: m.a.length,
    r3d,
    r20: { r: r2(r20s[L]), normal: band2(normalBand(idx5.map((i) => r20s[i]))) },
    r60: { r: r2(r60s[L]), normal: band2(normalBand(idx5.map((i) => r60s[i]))) },
    beta60: r2(betas[L]),
    state: st.state, since: st.since, wrongWay: st.wrongWay, breaking,
    history: {
      weekly: idx5.filter((i, k) => (idx5.length - 1 - k) % 5 === 0).map((i) => [m.dates[i], r2(r60s[i]), r2(r20s[i])]),
      daily: m.dates.slice(-126).map((d, k) => [d, r2(r20s[L - 125 + k])]),
      changes,
    },
    byRegime: tbl,
  };
}
