// corr-sources.mjs: keyless data sources for the Drivers page engine (scripts/correlations.mjs).
// Every function returns a Map (date 'YYYY-MM-DD' -> number, or epoch seconds -> number for hourly) and
// throws a short message on failure; the engine records it and carries on.
// Probed 2026-11-17: see docs/superpowers/specs/2026-11-17-drivers-correlations-design.md.

const UA = { 'User-Agent': 'Mozilla/5.0 (my-trading-project desk)' };
const get = async (url, headers = {}) => {
  const r = await fetch(url, { headers: { ...UA, ...headers }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r;
};
const iso = (d) => d.toISOString().slice(0, 10);

function prevBusinessDay(day) {
  const d = new Date(day + 'T12:00:00Z');
  do d.setUTCDate(d.getUTCDate() - 1); while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return iso(d);
}

async function yahooChart(symbol, range, interval) {
  const r = await get(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`);
  const res = (await r.json()).chart?.result?.[0];
  if (!res?.timestamp) throw new Error(`Yahoo ${symbol}: no result`);
  return res;
}

// Daily closes. Bars are stamped at the exchange's local midnight, so dates are read in its own time zone;
// weekend bars are dropped. Forex (=X) daily bars are midnight-London snapshots: the bar dated D holds the
// END of the previous business day (checked 2026-11-09), so for FX the bar's OPEN is used as the previous
// business day's close.
export async function yahooDaily(symbol, range = '6y') {
  const res = await yahooChart(symbol, range, '1d');
  const tz = res.meta?.exchangeTimezoneName || 'UTC', q = res.indicators.quote[0], fx = symbol.endsWith('=X');
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' });
  const out = new Map();
  res.timestamp.forEach((t, i) => {
    const v = fx ? q.open[i] : q.close[i];
    if (v == null) return;
    const p = Object.fromEntries(fmt.formatToParts(new Date(t * 1000)).map((x) => [x.type, x.value]));
    if (p.weekday === 'Sat' || p.weekday === 'Sun') return;
    let date = `${p.year}-${p.month}-${p.day}`;
    if (fx) date = prevBusinessDay(date);
    out.set(date, v);
  });
  return out;
}

// Hourly closes for the last 2 years (Yahoo's limit), keyed by the UTC hour (epoch seconds, floored to the hour).
export async function yahooHourly(symbol) {
  const res = await yahooChart(symbol, '2y', '1h');
  const q = res.indicators.quote[0], out = new Map();
  res.timestamp.forEach((t, i) => { if (q.close[i] != null) out.set(Math.floor(t / 3600) * 3600, q.close[i]); });
  return out;
}

export async function fred(id, years = 6) {
  const r = await get(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`);
  const since = iso(new Date(Date.now() - years * 365.25 * 864e5)), out = new Map();
  for (const line of (await r.text()).trim().split('\n').slice(1)) {
    const [d, v] = line.split(',');
    if (d >= since && v && v !== '.') out.set(d, +v);
  }
  if (!out.size) throw new Error(`FRED ${id}: empty`);
  return out;
}

const MON = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
const since6y = () => iso(new Date(Date.now() - 6 * 365.25 * 864e5));

// Government 2-year yield, % per annum, from each central bank's (or finance ministry's) public data.
export async function cb2y(ccy) {
  const out = new Map(), from = since6y();
  const put = (d, v) => { if (d >= from && v !== '' && v != null && Number.isFinite(+v)) out.set(d, +v); };
  if (ccy === 'CAD') {
    const j = await (await get(`https://www.bankofcanada.ca/valet/observations/BD.CDN.2YR.DQ.YLD/json?start_date=${from}`)).json();
    for (const o of j.observations || []) put(o.d, o['BD.CDN.2YR.DQ.YLD']?.v);
  } else if (ccy === 'GBP') {
    const [y, m, d] = from.split('-'), mon = Object.keys(MON)[+m - 1];
    const t = await (await get(`https://www.bankofengland.co.uk/boeapps/database/_iadb-fromshowcolumns.asp?csv.x=yes&Datefrom=${d}/${mon}/${y}&Dateto=now&SeriesCodes=IUDSNPY&CSVF=TN&UsingCodes=Y&VPD=Y&VFD=N`)).text();
    for (const line of t.trim().split('\n').slice(1)) {
      const [ds, v] = line.split(','), p = ds.trim().split(' ');
      if (p.length === 3) put(`${p[2]}-${MON[p[1]]}-${p[0].padStart(2, '0')}`, v);
    }
  } else if (ccy === 'AUD') {
    const t = await (await get('https://www.rba.gov.au/statistics/tables/csv/f2-data.csv')).text();
    for (const line of t.split('\n')) {
      const c = line.split(','), p = c[0].split('-');
      if (p.length === 3 && MON[p[1]]) put(`${p[2]}-${MON[p[1]]}-${p[0].padStart(2, '0')}`, c[1]);
    }
  } else if (ccy === 'JPY') {
    // History file runs to the end of last month; the current-month file adds this month.
    const base = 'https://www.mof.go.jp/english/policy/jgbs/reference/interest_rate/';
    for (const u of [`${base}historical/jgbcme_all.csv`, `${base}jgbcme.csv`]) {
      const t = await (await get(u)).text();
      for (const line of t.split('\n')) {
        const c = line.split(','), p = c[0].split('/');
        if (p.length === 3 && /^\d{4}$/.test(p[0])) put(`${p[0]}-${p[1].padStart(2, '0')}-${p[2].padStart(2, '0')}`, c[2] === '-' ? '' : c[2]);
      }
    }
  } else if (ccy === 'EUR') {
    // German federal securities, Svensson term structure, 2-year (Bundesbank).
    const t = await (await get('https://api.statistiken.bundesbank.de/rest/download/BBSIS/D.I.ZST.ZI.EUR.S1311.B.A604.R02XX.R.A.A._Z._Z.A?format=csv&lang=en')).text();
    for (const line of t.split('\n')) { const c = line.split(','); if (/^\d{4}-\d{2}-\d{2}$/.test(c[0])) put(c[0], c[1]); }
  } else {
    throw new Error(`${ccy}: no free daily 2Y source`);
  }
  if (out.size < 100) throw new Error(`${ccy} 2Y: only ${out.size} rows`);
  return out;
}

// Global Dairy Trade price index, one value per auction (every two weeks), last ten years.
export async function gdt() {
  const base = 'https://s3.amazonaws.com/www-production.globaldairytrade.info/results/';
  const { latestEvent } = await (await get(base + 'latest.json')).json();
  const j = await (await get(`${base}${latestEvent}/price_indices_ten_years.json`)).json();
  const out = new Map();
  for (const e of j.PriceIndicesTenYears?.Events?.EventDetails || []) {
    const d = new Date(e.EventDate + ' UTC');
    if (!Number.isNaN(+d) && e.PriceIndex) out.set(iso(d), +e.PriceIndex);
  }
  if (out.size < 20) throw new Error(`GDT: only ${out.size} events`);
  return out;
}
