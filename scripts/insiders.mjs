#!/usr/bin/env node
// insiders.mjs — SEC Form 4 insider transactions, filtered down to the part that carries signal.
//
// Data: SEC EDGAR full-text search + the raw Form 4 XML. Free, official, no API key.
// Identity here is legally mandated, so unlike on-chain "smart money" tags there is no
// labeling or wallet-clustering risk — the filer states who they are under penalty of perjury.
//
// THE CENTRAL POINT — most "insider buying" headlines are noise. Transaction codes:
//   P  open-market PURCHASE ....... real signal: the insider spent their own money
//   S  open-market sale ........... weak: sales happen for tax, diversification, planned exits
//   A  grant / award ............... NOISE: compensation, not a decision to buy
//   M  option exercise ............ NOISE: exercising existing comp
//   F  shares withheld for tax .... NOISE: mechanical
//   G  gift ....................... NOISE
// Only P is treated as a buy. Lumping A and M in with P is the single most common way
// insider-tracking products manufacture bullish-looking noise.
//
// Also flagged: Rule 10b5-1 trades are pre-scheduled months ahead, so they say much less
// about what the insider thinks today. They are marked, not silently mixed in.
//
// Usage:
//   node scripts/insiders.mjs                 # last 2 days of filings
//   node scripts/insiders.mjs --days 7
//   node scripts/insiders.mjs --max 400       # cap XML fetches
//   node scripts/insiders.mjs --json
//
// SEC fair-access: a declaring User-Agent is required and requests are rate-limited
// below their 10/sec ceiling. Override the contact with SEC_USER_AGENT.

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dir, '..', 'data', 'insiders');

const UA = process.env.SEC_USER_AGENT || 'my-trading-project research nathan.vuillemin@gmail.com';
const HEADERS = { 'User-Agent': UA, 'Accept-Encoding': 'gzip, deflate' };

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  if (i === -1) return d;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
};
const has = (n) => process.argv.includes(`--${n}`);

// SEC allows 10 requests/second. Stay comfortably under it.
const RATE_MS = 145;
let lastReq = 0;
async function secFetch(url) {
  const wait = Math.max(0, lastReq + RATE_MS - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastReq = Date.now();
  const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r;
}

const CODE_MEANING = {
  P: 'open-market purchase', S: 'open-market sale', A: 'grant/award',
  M: 'option exercise', F: 'tax withholding', G: 'gift',
  D: 'disposition to issuer', C: 'conversion', X: 'option exercise (in/out of money)',
};
const num = (v) => { const n = +String(v ?? '').replace(/,/g, ''); return isFinite(n) ? n : 0; };

// ---------- tiny XML helpers (Form 4 is small and regular; no parser dependency) ----------
const tagVal = (xml, tag) => {
  // <tag><value>X</value></tag>  or  <tag>X</tag>
  const m = xml.match(new RegExp(`<${tag}>\\s*(?:<value>\\s*([^<]*)\\s*</value>|([^<]*))`, 'i'));
  return m ? (m[1] ?? m[2] ?? '').trim() : null;
};
const blocks = (xml, tag) => {
  const out = [];
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'gi');
  let m;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
};

// ---------- fetch the list of Form 4 filings in a window ----------
async function listForm4(startdt, enddt, max) {
  const out = [];
  for (let from = 0; from < max; from += 100) {
    const url = `https://efts.sec.gov/LATEST/search-index?q=&forms=4&dateRange=custom`
      + `&startdt=${startdt}&enddt=${enddt}&from=${from}`;
    let j;
    try { j = await (await secFetch(url)).json(); }
    catch (e) { console.error(`  ! search page ${from}: ${e.message}`); break; }
    const hits = j?.hits?.hits || [];
    if (!hits.length) break;
    for (const h of hits) {
      const [acc, file] = String(h._id).split(':');
      const ciks = h._source?.ciks || [];
      if (!acc || !file || !ciks.length) continue;
      out.push({
        acc, file,
        companyCik: ciks[ciks.length - 1].replace(/^0+/, ''),
        names: h._source?.display_names || [],
        filedAt: h._source?.file_date,
      });
    }
    if (out.length >= max) break;
    if (hits.length < 100) break;
  }
  return out.slice(0, max);
}

// ---------- parse one Form 4 ----------
async function parseForm4(f) {
  const url = `https://www.sec.gov/Archives/edgar/data/${f.companyCik}/${f.acc.replace(/-/g, '')}/${f.file}`;
  const xml = await (await secFetch(url)).text();

  const issuer = tagVal(xml, 'issuerName');
  // Filers sometimes put the literal string "NONE" (or leave it blank) when the issuer has
  // no listed symbol. Normalise so those don't render as a ticker called NONE.
  const rawTicker = tagVal(xml, 'issuerTradingSymbol');
  const ticker = (!rawTicker || /^(none|n\/a|-)$/i.test(rawTicker.trim())) ? null : rawTicker.trim().toUpperCase();
  const owner = tagVal(xml, 'rptOwnerName');
  const isDirector = tagVal(xml, 'isDirector') === '1';
  const isOfficer = tagVal(xml, 'isOfficer') === '1';
  const isTenPct = tagVal(xml, 'isTenPercentOwner') === '1';
  const title = tagVal(xml, 'officerTitle');
  // Newer filings carry an explicit 10b5-1 flag; older ones only mention it in a footnote.
  const planned = /rule10b5-1|10b5-1/i.test(xml);

  const txs = [];
  for (const b of blocks(xml, 'nonDerivativeTransaction')) {
    const code = tagVal(b, 'transactionCode');
    if (!code) continue;
    const shares = num(tagVal(b, 'transactionShares'));
    const price = num(tagVal(b, 'transactionPricePerShare'));
    const ad = tagVal(b, 'transactionAcquiredDisposedCode');   // A = acquired, D = disposed
    txs.push({
      code, meaning: CODE_MEANING[code] || 'other',
      shares, price, usd: shares * price,
      acquired: ad === 'A',
      date: tagVal(b, 'transactionDate'),
      sharesAfter: num(tagVal(b, 'sharesOwnedFollowingTransaction')),
    });
  }
  return {
    issuer, ticker, owner,
    role: title || (isDirector ? 'Director' : isTenPct ? '10% owner' : isOfficer ? 'Officer' : 'Insider'),
    isDirector, isOfficer, isTenPct, planned,
    filedAt: f.filedAt,
    url,
    txs,
  };
}

// A rough conviction weight. Seniority matters: a CEO buying is a stronger statement than a
// director's small qualifying purchase. Deliberately crude and transparent rather than a
// black-box score — the underlying numbers are always shown alongside.
function roleWeight(r) {
  const t = (r.role || '').toLowerCase();
  if (/chief executive|ceo|president|chairman/.test(t)) return 3.0;
  if (/chief financial|cfo|principal financial/.test(t)) return 2.5;
  if (/chief|coo|cto|officer/.test(t)) return 1.8;
  if (r.isTenPct) return 1.5;
  if (r.isDirector) return 1.2;
  return 1.0;
}

(async () => {
  const days = Number(arg('days', 2));
  const max = Number(arg('max', 300));
  const quiet = has('json');
  const log = (...a) => { if (!quiet) console.log(...a); };

  const end = new Date();
  const start = new Date(end.getTime() - days * 864e5);
  const iso = (d) => d.toISOString().slice(0, 10);

  log(`Searching Form 4 filings ${iso(start)} → ${iso(end)} (max ${max})...`);
  const list = await listForm4(iso(start), iso(end), max);
  log(`Found ${list.length} filings. Fetching transaction detail (rate-limited)...`);

  const filings = [];
  let failed = 0;
  for (let i = 0; i < list.length; i++) {
    try { filings.push(await parseForm4(list[i])); }
    catch { failed++; }
    if (!quiet && (i + 1) % 50 === 0) log(`  ${i + 1}/${list.length}`);
  }
  log(`Parsed ${filings.length}, failed ${failed}.`);

  // ---- keep only real open-market activity ----
  const buys = [], sells = [];
  for (const f of filings) {
    for (const t of f.txs) {
      const row = { ...f, ...t, txs: undefined, weight: roleWeight(f) };
      if (t.code === 'P' && t.acquired && t.usd > 0) buys.push(row);
      else if (t.code === 'S' && !t.acquired && t.usd > 0) sells.push(row);
    }
  }

  // ---- cluster buys: 2+ DISTINCT insiders buying the same issuer in the window ----
  const byTicker = {};
  for (const b of buys) {
    const k = b.ticker || b.issuer || '?';
    const e = (byTicker[k] ||= { ticker: k, issuer: b.issuer, usd: 0, buyers: new Set(), rows: [], weighted: 0 });
    e.usd += b.usd;
    e.buyers.add(b.owner);
    e.weighted += b.usd * b.weight;
    e.rows.push(b);
  }
  const clusters = Object.values(byTicker)
    .map(e => ({
      ticker: e.ticker, issuer: e.issuer,
      usd: Math.round(e.usd),
      buyerCount: e.buyers.size,
      buyers: [...e.buyers],
      weightedUsd: Math.round(e.weighted),
      anyPlanned: e.rows.some(r => r.planned),
      roles: [...new Set(e.rows.map(r => r.role))],
    }))
    .filter(c => c.buyerCount >= 2)
    .sort((a, b) => b.weightedUsd - a.weightedUsd);

  const topBuys = buys.slice().sort((a, b) => b.usd - a.usd).slice(0, 20);

  // Code census — shows how much of the raw feed is noise, and why filtering matters.
  const codeCensus = {};
  for (const f of filings) for (const t of f.txs) codeCensus[t.code] = (codeCensus[t.code] || 0) + 1;

  const payload = {
    date: iso(end), window: { start: iso(start), end: iso(end) },
    generatedAt: new Date().toISOString(),
    filingsParsed: filings.length, filingsFailed: failed,
    codeCensus,
    counts: { buys: buys.length, sells: sells.length },
    totals: {
      buyUsd: Math.round(buys.reduce((s, b) => s + b.usd, 0)),
      sellUsd: Math.round(sells.reduce((s, b) => s + b.usd, 0)),
    },
    clusters,
    topBuys: topBuys.map(b => ({
      ticker: b.ticker, issuer: b.issuer, owner: b.owner, role: b.role,
      usd: Math.round(b.usd), shares: b.shares, price: b.price,
      planned: b.planned, date: b.date, url: b.url,
    })),
  };

  if (!has('no-write')) {
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(join(OUT_DIR, `${payload.date}.json`), JSON.stringify(payload, null, 2));
  }
  if (quiet) { process.stdout.write(JSON.stringify(payload)); return; }

  const line = '─'.repeat(72);
  const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
  console.log(`\n${line}\nINSIDER FORM 4 — ${payload.window.start} → ${payload.window.end}\n${line}`);

  console.log('\nTransaction code census (why filtering matters):');
  for (const [c, n] of Object.entries(codeCensus).sort((a, b) => b[1] - a[1])) {
    const sig = c === 'P' ? '  <-- REAL BUY SIGNAL' : c === 'S' ? '  (sale)' : '  (noise)';
    console.log(`  ${c}  ${String(n).padStart(5)}  ${(CODE_MEANING[c] || 'other').padEnd(26)}${sig}`);
  }

  console.log(`\nOpen-market BUYS: ${payload.counts.buys} totalling ${money(payload.totals.buyUsd)}`);
  console.log(`Open-market SELLS: ${payload.counts.sells} totalling ${money(payload.totals.sellUsd)}`);

  if (clusters.length) {
    console.log(`\nCLUSTER BUYS (2+ distinct insiders, same company):`);
    for (const c of clusters.slice(0, 12)) {
      console.log(`  ${(c.ticker || "—").padEnd(7)} ${money(c.usd).padStart(14)}  ${c.buyerCount} insiders  ${c.roles.slice(0, 3).join(', ')}${c.anyPlanned ? '  [some 10b5-1]' : ''}`);
      console.log(`          ${c.issuer}`);
    }
  } else console.log('\nNo cluster buys in this window.');

  console.log(`\nLARGEST INDIVIDUAL BUYS:`);
  for (const b of payload.topBuys.slice(0, 10)) {
    console.log(`  ${(b.ticker || "—").padEnd(7)} ${money(b.usd).padStart(14)}  ${(b.role || '').slice(0, 28).padEnd(28)} ${b.owner}${b.planned ? '  [10b5-1]' : ''}`);
  }
  console.log(line);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
