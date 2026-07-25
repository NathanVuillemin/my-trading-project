#!/usr/bin/env node
// institutions.mjs — 13F holdings of notable institutional managers, and what they CHANGED.
//
// 13F-HR filings are the legally-mandated quarterly holdings disclosure of large managers.
// Like Form 4, identity is not inferred — the filer states it. The catch is timing: filings
// lag the quarter end by up to 45 days, so this is a SLOW, long-horizon signal. That is fine
// for the stated use (multi-month positioning), and it is the only clean window into where
// hedge-fund and institutional capital actually sits.
//
// The signal is not the static holdings — it is the CHANGE. This diffs each manager's two
// most recent quarters to surface new buys, adds, trims and exits, then aggregates across
// managers to find CONSENSUS accumulation (an issuer several funds bought at once).
//
// Data: SEC EDGAR, free, no key. CUSIP is the join key (names vary by filer); nameOfIssuer
// is used for display. Value fields are dollars in current filings.
//
// Usage: node scripts/institutions.mjs [--json]   |   npm run institutions
// Writes: data/institutions/<YYYY-MM-DD>.json

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dir, '..', 'data', 'institutions');

const UA = process.env.SEC_USER_AGENT || 'my-trading-project research nathan.vuillemin@gmail.com';
const HEADERS = { 'User-Agent': UA, 'Accept-Encoding': 'gzip, deflate' };
const has = (n) => process.argv.includes(`--${n}`);

// Verified 2026-07-25: each returns a recent 13F-HR. Concentrated, conviction-driven
// managers are the most useful here; huge quant books (thousands of tiny positions) are
// included but only their top holdings carry a readable signal, so we cap per manager.
const MANAGERS = [
  { name: 'Berkshire Hathaway', who: 'Buffett', cik: 1067983 },
  { name: 'Scion', who: 'Burry', cik: 1649339 },
  { name: 'Pershing Square', who: 'Ackman', cik: 1336528 },
  { name: 'Bridgewater', who: 'Dalio', cik: 1350694 },
  { name: 'Renaissance Tech', who: 'quant', cik: 1037389 },
  { name: 'Citadel', who: 'Griffin', cik: 1423053 },
  { name: 'Duquesne', who: 'Druckenmiller', cik: 1536411 },
  { name: 'Third Point', who: 'Loeb', cik: 1040273 },
  { name: 'Soros FM', who: 'Soros', cik: 1029160 },
  { name: 'Tiger Global', who: 'Coleman', cik: 1167483 },
  { name: 'Coatue', who: 'Laffont', cik: 1135730 },
  { name: 'Baupost', who: 'Klarman', cik: 1061768 },
  { name: 'Lone Pine', who: 'Mandel', cik: 1061165 },
];
const TOP_PER_MANAGER = 20;   // keep each fund's significant positions, drop the long tail

// SEC allows 10 req/sec; stay well under.
const RATE_MS = 150;
let last = 0;
async function sec(url) {
  const wait = Math.max(0, last + RATE_MS - Date.now());
  if (wait) await new Promise(r => setTimeout(r, wait));
  last = Date.now();
  const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r;
}
const num = (v) => { const n = +String(v ?? '').replace(/,/g, ''); return isFinite(n) ? n : 0; };
const decode = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"');
// Consensus key that merges share classes and entity-suffix noise, so GOOGL and GOOG (two
// Alphabet CUSIPs) count as one conviction rather than two half-signals. CUSIP stays the key
// for per-manager precision; this looser key is only for the cross-fund tally.
const nameKey = (s) => decode(s).toUpperCase()
  .replace(/\b(CL|CLASS)\s*[A-C]\b/g, '')
  .replace(/\b(INC|CORP|CORPORATION|CO|COM|COMPANY|LTD|PLC|LP|LLC|HOLDINGS?|HLDGS?|THE)\b/g, '')
  .replace(/[^A-Z0-9]+/g, ' ').trim();
const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
const short = (n) => (n >= 1e9 ? '$' + (n / 1e9).toFixed(2) + 'B' : '$' + (n / 1e6).toFixed(1) + 'M');

// ---- parse one 13F info table into cusip -> holding ----
function parseInfoTable(xml) {
  const holdings = {};
  // Filers vary: some emit plain <infoTable>, others namespace it as <ns1:infoTable>.
  // Allowing an optional prefix here is what makes the namespaced filings (Bridgewater,
  // Baupost, Third Point) parse instead of silently returning zero holdings.
  for (const m of xml.matchAll(/<(?:[a-z0-9]+:)?infoTable>([\s\S]*?)<\/(?:[a-z0-9]+:)?infoTable>/gi)) {
    const b = m[1];
    const gv = (t) => { const x = b.match(new RegExp(`<[a-z0-9]*:?${t}>([^<]*)`, 'i')); return x ? x[1].trim() : null; };
    const cusip = gv('cusip');
    if (!cusip) continue;
    const value = num(gv('value'));
    const shares = num(gv('sshPrnamt'));
    // A manager splits one issuer across CALL/PUT/SH rows; fold them by cusip.
    const e = holdings[cusip] || (holdings[cusip] = { cusip, name: decode(gv('nameOfIssuer')) || cusip, value: 0, shares: 0 });
    e.value += value;
    e.shares += shares;
  }

  // 13F value units are inconsistent between filers in the SAME quarter: some report dollars,
  // some thousands (verified 2026-07-25 — Berkshire dollars, Duquesne/Baupost thousands).
  // There is no unit field, so infer it: value/shares is an implied share price, and a real
  // equity book's median price is never below $1. If it is, the filing is in thousands.
  const prices = Object.values(holdings)
    .filter(h => h.shares > 0 && h.value > 0)
    .map(h => h.value / h.shares)
    .sort((a, b) => a - b);
  if (prices.length) {
    const median = prices[Math.floor(prices.length / 2)];
    if (median < 1) for (const h of Object.values(holdings)) h.value *= 1000;
  }
  return holdings;
}

// ---- the two most recent 13F-HR filings for a manager ----
async function latestTwo13F(cik) {
  const sub = await (await sec(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, '0')}.json`)).json();
  const f = sub.filings.recent;
  const out = [];
  for (let i = 0; i < f.form.length && out.length < 2; i++) {
    if (f.form[i] === '13F-HR') out.push({ acc: f.accessionNumber[i], reportDate: f.reportDate[i], filed: f.filingDate[i] });
  }
  return { name: sub.name, filings: out };
}

async function infoTableFor(cik, acc) {
  const dir = `https://www.sec.gov/Archives/edgar/data/${cik}/${acc.replace(/-/g, '')}/`;
  const listing = await (await sec(dir)).text();
  const xmls = [...new Set([...listing.matchAll(/href="[^"]*?([a-zA-Z0-9_\-]+\.xml)"/g)].map(m => m[1]))];
  const infoXml = xmls.find(x => !/primary_doc/i.test(x));
  if (!infoXml) throw new Error('no info table xml');
  return parseInfoTable(await (await sec(dir + infoXml)).text());
}

// ---- per-manager: current top holdings + quarter-over-quarter change ----
async function pullManager(m) {
  const meta = await latestTwo13F(m.cik);
  if (!meta.filings.length) throw new Error('no 13F-HR');
  const cur = await infoTableFor(m.cik, meta.filings[0].acc);
  const prev = meta.filings[1] ? await infoTableFor(m.cik, meta.filings[1].acc).catch(() => ({})) : {};

  const all = Object.values(cur).sort((a, b) => b.value - a.value);
  const portfolioValue = all.reduce((s, h) => s + h.value, 0);
  const top = all.slice(0, TOP_PER_MANAGER);

  // Changes over the significant (top) positions only — the tail is quant noise.
  const newBuys = [], exits = [];
  for (const h of top) if (!prev[h.cusip]) newBuys.push(h);
  for (const h of Object.values(prev).sort((a, b) => b.value - a.value).slice(0, TOP_PER_MANAGER)) {
    if (!cur[h.cusip]) exits.push(h);
  }

  return {
    name: m.name, who: m.who, cik: m.cik,
    reportDate: meta.filings[0].reportDate, filed: meta.filings[0].filed,
    hasPrev: !!meta.filings[1],
    portfolioValue: Math.round(portfolioValue),
    holdings: all.length,
    top: top.map(h => ({ cusip: h.cusip, name: h.name, value: Math.round(h.value), pct: portfolioValue ? +(h.value / portfolioValue * 100).toFixed(1) : 0 })),
    newBuys: newBuys.map(h => ({ cusip: h.cusip, name: h.name, value: Math.round(h.value) })),
    exits: exits.map(h => ({ cusip: h.cusip, name: h.name, value: Math.round(h.value) })),
  };
}

(async () => {
  const managers = [];
  const warns = [];
  for (const m of MANAGERS) {
    try { managers.push(await pullManager(m)); }
    catch (e) { warns.push(`${m.name}: ${e.message}`); }
  }

  // ---- cross-fund consensus, keyed by normalized name (merges share classes) ----
  const held = {}, bought = {};
  const add = (bucket, h, who) => {
    const k = nameKey(h.name);
    const e = bucket[k] || (bucket[k] = { name: h.name, funds: [], totalValue: 0 });
    if (!e.funds.includes(who)) e.funds.push(who);   // one fund counts once even across share classes
    e.totalValue += h.value;
  };
  for (const mgr of managers) {
    for (const h of mgr.top) add(held, h, mgr.who);
    for (const h of mgr.newBuys) add(bought, h, mgr.who);
  }
  const consensusHeld = Object.values(held).filter(x => x.funds.length >= 2)
    .sort((a, b) => b.funds.length - a.funds.length || b.totalValue - a.totalValue)
    .map(x => ({ ...x, funds: x.funds, count: x.funds.length, totalValue: Math.round(x.totalValue) }));
  const consensusBuys = Object.values(bought).filter(x => x.funds.length >= 2)
    .sort((a, b) => b.funds.length - a.funds.length || b.totalValue - a.totalValue)
    .map(x => ({ ...x, count: x.funds.length, totalValue: Math.round(x.totalValue) }));

  const payload = {
    date: new Date().toISOString().slice(0, 10),
    generatedAt: new Date().toISOString(),
    note: '13F filings lag the quarter end by up to 45 days — a slow, long-horizon signal.',
    managersReporting: managers.length,
    latestQuarter: managers.map(m => m.reportDate).sort().slice(-1)[0] || null,
    consensusHeld: consensusHeld.slice(0, 15),
    consensusBuys: consensusBuys.slice(0, 12),
    managers,
    warns,
  };

  if (!has('no-write')) {
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(join(OUT_DIR, `${payload.date}.json`), JSON.stringify(payload, null, 2));
  }
  if (has('json')) { process.stdout.write(JSON.stringify(payload)); return; }

  const line = '─'.repeat(78);
  console.log(`\n${line}\nINSTITUTIONAL 13F — ${payload.managersReporting} managers, latest quarter ${payload.latestQuarter}\n${line}`);
  console.log('(13F lags up to 45 days — long-horizon positioning, not a fast signal)');

  console.log(`\nCONSENSUS HOLDINGS (in the top book of 2+ managers):`);
  for (const c of payload.consensusHeld.slice(0, 10)) {
    console.log(`  ${String(c.count)}×  ${(c.name || '').slice(0, 30).padEnd(30)} ${short(c.totalValue).padStart(9)}  [${c.funds.join(', ')}]`);
  }

  if (payload.consensusBuys.length) {
    console.log(`\nCONSENSUS NEW BUYS (newly in 2+ managers' top book this quarter):`);
    for (const c of payload.consensusBuys) {
      console.log(`  ${String(c.count)}×  ${(c.name || '').slice(0, 30).padEnd(30)} ${short(c.totalValue).padStart(9)}  [${c.funds.join(', ')}]`);
    }
  } else console.log('\nNo cross-fund consensus new buys this quarter.');

  console.log(`\nPER MANAGER (top holding + new buys):`);
  for (const m of payload.managers) {
    const tb = m.top[0];
    console.log(`  ${(m.who).padEnd(14)} ${m.reportDate}  ${short(m.portfolioValue).padStart(9)}  top: ${(tb?.name || '?').slice(0, 22)} (${tb?.pct}%)`
      + (m.newBuys.length ? `  new: ${m.newBuys.slice(0, 3).map(b => (b.name || '').slice(0, 14)).join(', ')}` : ''));
  }
  if (warns.length) { console.log('\nWARNINGS:'); for (const w of warns) console.log(`  ! ${w}`); }
  console.log(line);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
