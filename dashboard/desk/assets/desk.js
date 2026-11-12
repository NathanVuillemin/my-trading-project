// Trading Desk: shared shell + page renderers.
// Every page is a thin HTML file with <body data-page="...">; this script draws the nav bar and the
// page. The desk holds Nathan's own layer only: what he types (scorecard, kill switches, levels, notes,
// ideas) is saved to ./data/ through GitHub; the one thing it reads is a small live price file, used
// to hold his entries against the market. It shows no data he is already sent elsewhere.

const PAGES = [
  { id: 'hub', href: 'index.html', label: 'Today' },
  { id: 'scorecard', href: 'scorecard.html', label: 'Scorecard' },
  { id: 'killswitches', href: 'kill-switches.html', label: 'Kill Switches' },
  { id: 'levels', href: 'levels.html', label: 'Key Levels' },
  { id: 'ideas', href: 'ideas.html', label: 'Ideas' },
  { id: 'review', href: 'review.html', label: 'Review' },
];
const CCYS = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD'];
// Market-convention order: the higher-priority currency is the base of the pair.
const PAIR_ORDER = ['EUR', 'GBP', 'AUD', 'NZD', 'USD', 'CAD', 'CHF', 'JPY'];

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cache = {};

// Local test mode: `?store=local` keeps every save in this browser (the flag lives in sessionStorage, so it
// survives moving between pages); `?store=github` switches back. Nothing is committed while it is on.
const STORE_KEY = 'desk.store';
(() => {
  const s = new URLSearchParams(location.search).get('store');
  try { if (s === 'local') sessionStorage.setItem(STORE_KEY, 'local'); else if (s === 'github') sessionStorage.removeItem(STORE_KEY); } catch { /* storage blocked */ }
})();
const localMode = () => { try { return sessionStorage.getItem(STORE_KEY) === 'local'; } catch { return false; } };
const localKey = (name) => `desk.local.${name}`;
const canSave = () => localMode() || !!ghToken.get();

async function load(name, optional = false) {
  if (!cache[name]) {
    cache[name] = fetch(`data/${name}.json`, { cache: 'no-store' }).then((r) => {
      if (!r.ok) {
        if (optional && r.status === 404) return null;
        throw new Error(`data/${name}.json: HTTP ${r.status}`);
      }
      return r.json();
    });
  }
  return cache[name];
}

// ---------- GitHub-backed store (kill switches Nathan types in) ----------
// Pages is static, so edits are committed straight to the repo through the GitHub contents API
// with a fine-grained token (Contents read/write on this repo only) that Nathan pastes once per
// device; it stays in this browser's localStorage and is sent only to api.github.com. Without a
// token the page is read-only and reads the repo's current file (fresh, not the Pages copy).
const GH = { owner: 'NathanVuillemin', repo: 'my-trading-project', branch: 'main', dir: 'dashboard/desk/data' };
const TOKEN_KEY = 'desk.gh.token';
const ghToken = {
  get() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } },
  set(v) { try { v ? localStorage.setItem(TOKEN_KEY, v) : localStorage.removeItem(TOKEN_KEY); } catch { /* storage blocked */ } },
};
const ghUrl = (name) => `https://api.github.com/repos/${GH.owner}/${GH.repo}/contents/${GH.dir}/${name}.json`;
const ghHeaders = () => ({ Accept: 'application/vnd.github+json', Authorization: `Bearer ${ghToken.get()}`, 'X-GitHub-Api-Version': '2022-11-28' });
const b64decode = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, '')), (c) => c.charCodeAt(0)));
const b64encode = (s) => { let bin = ''; new TextEncoder().encode(s).forEach((b) => { bin += String.fromCharCode(b); }); return btoa(bin); };
async function ghRead(name) {
  if (localMode()) {
    const it = localStorage.getItem(localKey(name));
    if (it) return { data: JSON.parse(it), sha: null };
    return { data: await load(name, true), sha: null };
  }
  const r = await fetch(`${ghUrl(name)}?ref=${GH.branch}&t=${Date.now()}`, { headers: ghHeaders(), cache: 'no-store' });
  if (!r.ok) {
    if (r.status === 404) return { data: null, sha: null };
    throw new Error(`GitHub read ${name}: HTTP ${r.status}`);
  }
  const j = await r.json();
  return { data: JSON.parse(b64decode(j.content)), sha: j.sha };
}
// Re-reads the latest file, applies one change and commits it, so a data snapshot the daily
// job committed in between is never overwritten. Retries once if the file moved under us.
async function ghUpdate(name, change, message) {
  if (localMode()) {
    const { data } = await ghRead(name);
    const next = change(data == null ? null : structuredClone(data));
    localStorage.setItem(localKey(name), JSON.stringify(next));
    cache[`live:${name}`] = Promise.resolve(next);
    return { data: next, commit: 'local' };
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, sha } = await ghRead(name);
    const next = change(data == null ? null : structuredClone(data));
    const body = { message, content: b64encode(JSON.stringify(next, null, 2) + '\n'), branch: GH.branch };
    if (sha) body.sha = sha;
    const r = await fetch(ghUrl(name), {
      method: 'PUT', headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (r.ok) { const j = await r.json(); cache[`live:${name}`] = Promise.resolve(next); return { data: next, commit: j.commit?.sha?.slice(0, 7) }; }
    if (r.status !== 409 && r.status !== 422) throw new Error(`GitHub save: HTTP ${r.status}${r.status === 401 || r.status === 403 ? ' (token missing or lacks Contents write on this repo)' : ''}`);
  }
  throw new Error('GitHub save: file kept changing, try again');
}
// Freshest copy: GitHub API with a token, else raw.githubusercontent (up to ~5 min CDN cache),
// else the copy deployed with the site.
async function loadLive(name, optional = false) {
  if (localMode()) {
    const { data } = await ghRead(name);
    if (data === null && !optional) throw new Error(`data/${name}.json: not found`);
    return data;
  }
  if (!cache[`live:${name}`]) {
    cache[`live:${name}`] = (async () => {
      try { if (ghToken.get()) { const { data } = await ghRead(name); if (data !== null) return data; } } catch { /* fall through */ }
      try {
        const r = await fetch(`https://raw.githubusercontent.com/${GH.owner}/${GH.repo}/${GH.branch}/${GH.dir}/${name}.json?t=${Date.now()}`, { cache: 'no-store' });
        if (r.ok) return await r.json();
      } catch { /* fall through */ }
      return load(name, optional);
    })();
  }
  return cache[`live:${name}`];
}

// ---------- live prices (read-only) ----------
// The desk uses prices only to hold Nathan's own entries against the market: are his pairs moving his
// way, how far is price from his levels, how did past calls work out. Two inputs, combined in the browser:
//  1. Live quotes, fetched straight from a public keyless endpoint every minute (Coinbase's exchange
//     rates: reference rates that update every minute or two and sit within about 0.02% of the
//     interbank quote. Fine for moves and distances, not an executable price).
//  2. Reference closes: three months of daily closes for the seven USD pairs, written by
//     scripts/desk-live.mjs in CI onto the `desk-live` branch. They only change once a day, so it does
//     not matter that GitHub starts scheduled jobs hours late.
const REF_URL = `https://raw.githubusercontent.com/${GH.owner}/${GH.repo}/desk-live/live.json`;
const QUOTES_URL = 'https://api.coinbase.com/v2/exchange-rates?currency=USD';
const IS_LOCALHOST = ['localhost', '127.0.0.1'].includes(location.hostname);
const ALL_PAIRS = PAIR_ORDER.flatMap((b, i) => PAIR_ORDER.slice(i + 1).map((q) => b + q));
let prices = null;   // what pages read: { pairs, currencies, history, liveUsd, quoteTime, refAsOf, refStale }
let refData = null, refLoadedAt = 0, quotes = null;

// Sources for the reference file, newest wins: the GitHub API when a token is connected (no CDN delay),
// the raw file (cached by GitHub's CDN for up to five minutes), and on a local preview the file written
// by `npm run desk:live`.
async function loadRef() {
  const get = (u, init = {}) => fetch(u, { cache: 'no-store', ...init }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const got = await Promise.all([
    get(`${REF_URL}?t=${Date.now()}`),
    ghToken.get() ? get(`https://api.github.com/repos/${GH.owner}/${GH.repo}/contents/live.json?ref=desk-live&t=${Date.now()}`, { headers: { ...ghHeaders(), Accept: 'application/vnd.github.raw+json' } }) : null,
    IS_LOCALHOST ? get(`data/live.json?t=${Date.now()}`) : null,
  ]);
  const best = got.filter((j) => j?.history?.dates?.length).sort((a, b) => (a.asOf < b.asOf ? 1 : -1))[0];
  if (best && (!refData || best.asOf >= refData.asOf)) refData = best;
  refLoadedAt = Date.now();
}
// Rates come as units of each currency per USD; the desk works in USD per unit.
async function loadQuotes() {
  try {
    const r = await fetch(QUOTES_URL, { cache: 'no-store' });
    if (!r.ok) return;
    const rates = (await r.json())?.data?.rates || {}, usd = { USD: 1 };
    for (const c of CCYS) if (c !== 'USD') { const v = Number(rates[c]); if (!(v > 0)) return; usd[c] = 1 / v; }
    quotes = { t: Date.now(), usd };
  } catch { /* keep the last quotes */ }
}
// Every figure the pages show is worked out here from the reference closes and the latest quotes.
function derivePrices() {
  const H = refData?.history, dates = H?.dates || [], N = dates.length;
  if (N < 25) { prices = null; return; }
  const hv = (c, i) => (c === 'USD' ? 1 : H.usd[c][i]);
  const pct = (a, b) => (a / b - 1) * 100, mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const now = new Date(), todayUtc = now.toISOString().slice(0, 10);
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((now.getUTCDay() + 6) % 7))).toISOString().slice(0, 10);
  let prev = N - 1; while (prev > 0 && dates[prev] >= todayUtc) prev--;   // last session before today
  let wk = prev; while (wk > 0 && dates[wk] >= monday) wk--;               // last close before this week
  const mo = Math.max(0, prev - 20), lo = Math.max(1, prev - 19);
  // Without live quotes, fall back to the newest value in the reference file.
  const liveUsd = quotes?.usd || Object.fromEntries(CCYS.map((c) => [c, hv(c, N - 1)]));
  const stat = (b, q) => {
    const s = (i) => hv(b, i) / hv(q, i), px = liveUsd[b] / liveUsd[q];
    const moves = [], win = [];
    for (let k = lo; k <= prev; k++) { moves.push(Math.abs(pct(s(k), s(k - 1)))); win.push(s(k)); }
    const typicalPct = mean(moves), dayPct = pct(px, s(prev));
    return { last: px, dayPct, wtdPct: pct(px, s(wk)), m1Pct: pct(px, s(mo)), typicalPct, x: Number((Math.abs(dayPct) / typicalPct).toFixed(1)), hi20: Math.max(...win), lo20: Math.min(...win) };
  };
  const pairs = Object.fromEntries(ALL_PAIRS.map((p) => [p, stat(p.slice(0, 3), p.slice(3))]));
  const currencies = {};
  for (const c of CCYS) {
    const o = CCYS.filter((x) => x !== c).map((x) => stat(c, x));
    currencies[c] = { dayPct: mean(o.map((s) => s.dayPct)), wtdPct: mean(o.map((s) => s.wtdPct)), m1Pct: mean(o.map((s) => s.m1Pct)) };
  }
  for (const [key, rank] of [['dayPct', 'rankDay'], ['wtdPct', 'rankWtd'], ['m1Pct', 'rankM1']]) {
    [...CCYS].sort((a, b) => currencies[b][key] - currencies[a][key]).forEach((c, i) => { currencies[c][rank] = i + 1; });
  }
  // The close for `prev` is final only if the file was written after that day ended.
  const refStale = refData.asOf.slice(0, 10) <= dates[prev];
  prices = { pairs, currencies, history: H, liveUsd, quoteTime: quotes?.t || null, refAsOf: refData.asOf, refStale };
}
async function loadPrices() {
  await Promise.all([Date.now() - refLoadedAt > 10 * 60000 ? loadRef() : null, loadQuotes()]);
  derivePrices();
  return prices;
}
const pxFmt = (pair, v) => (v == null ? '—' : Number(v).toFixed(String(pair).endsWith('JPY') ? 3 : 5));
const pctHtml = (n, d = 2) => (n == null ? '<span class="faint">—</span>' : `<span class="num ${n > 0.004 ? 'up' : n < -0.004 ? 'down' : 'muted'}">${n > 0.004 ? '+' : ''}${Number(n).toFixed(d)}%</span>`);
function priceAge() {
  if (!prices) return '<span class="pill warn">prices not reachable</span>';
  const stale = prices.refStale ? ' <span class="pill warn" title="Yesterday\'s final close has not been published yet, so the day change is measured from an earlier price">day change approximate</span>' : '';
  if (!prices.quoteTime) return `<span class="pill warn" title="Live quotes could not be fetched; showing the last published prices">live quotes unreachable · prices from ${new Date(prices.refAsOf).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</span>${stale}`;
  const min = Math.max(0, Math.round((Date.now() - prices.quoteTime) / 60000));
  return `<span class="pill ${min > 5 ? 'warn' : 'flat'}" title="Quotes are re-read every minute; the source updates every minute or two">quotes ${min < 1 ? 'just now' : `${min} min ago`}</span>${stale}`;
}
// Value of one unit of a currency in USD on reference day i (daily closes).
const histUsd = (c, i) => (c === 'USD' ? 1 : prices.history.usd[c][i]);

// ---------- small shared pieces ----------
const pad2 = (n) => String(n).padStart(2, '0');
const ymd = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
// Links Nathan opens daily (his coach's briefs) are private: kept in this browser only, never in the repo.
const LINKS_KEY = 'desk.links';
const links = {
  get() { try { return JSON.parse(localStorage.getItem(LINKS_KEY) || '{}'); } catch { return {}; } },
  set(v) { try { localStorage.setItem(LINKS_KEY, JSON.stringify(v)); } catch { /* storage blocked */ } },
};
const SESSIONS = [['Tokyo', 'Asia/Tokyo', 9, 18], ['London', 'Europe/London', 8, 17], ['New York', 'America/New_York', 8, 17]];
function sessionState(now = new Date()) {
  return SESSIONS.map(([name, timeZone, open, close]) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short', hour: 'numeric', hourCycle: 'h23' }).formatToParts(now).map((x) => [x.type, x.value]));
    return { name, open: !['Sat', 'Sun'].includes(p.weekday) && Number(p.hour) >= open && Number(p.hour) < close };
  });
}
// One place to connect GitHub, shown on every page that saves. The handler lives on document.
function connectPanel() {
  if (localMode()) return '';
  return ghToken.get()
    ? `<div class="note">Connected to GitHub on this device: saves are committed to ${esc(GH.repo)}. <button class="link-btn" data-gh="forget">Forget token on this device</button></div>`
    : `<section class="panel" style="margin-bottom:14px"><div class="panel-head"><h2>Connect GitHub to save</h2></div>
        <p class="small muted" style="margin:0 0 8px">Read-only until connected. Create a <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">fine-grained token ↗</a>: repository access <b>only ${esc(GH.repo)}</b>, permission <b>Contents: Read and write</b>. Paste it here once per device; it stays in this browser and is only sent to api.github.com. To try the desk without saving to GitHub, add <code>?store=local</code> to the address.</p>
        <div class="form-actions"><input type="password" id="gh-token" placeholder="github_pat_…" autocomplete="off" style="flex:1;min-width:200px"><button class="btn primary" data-gh="connect">Connect</button><span class="error small" id="gh-err"></span></div></section>`;
}
document.addEventListener('click', async (ev) => {
  const b = ev.target.closest('[data-gh]'); if (!b) return;
  ev.preventDefault();
  if (b.dataset.gh === 'forget') { ghToken.set(''); location.reload(); return; }
  const v = $('#gh-token')?.value.trim(); if (!v) return;
  ghToken.set(v);
  try { await ghRead('killswitches'); location.reload(); }
  catch (e) { ghToken.set(''); const el = $('#gh-err'); if (el) el.textContent = `Token did not work: ${e.message}`; }
});
// TradingView's free embeddable mini chart: the one tick-live element on the desk.
function tvMini(el, symbol) {
  el.classList.add('tradingview-widget-container');
  el.innerHTML = '<div class="tradingview-widget-container__widget"></div>';
  const s = document.createElement('script');
  s.src = 'https://s3.tradingview.com/external-embedding/embed-widget-mini-symbol-overview.js'; s.async = true;
  s.innerHTML = JSON.stringify({ symbol, width: '100%', height: 170, locale: 'en', dateRange: '5D', colorTheme: 'dark', isTransparent: true, autosize: false });
  el.appendChild(s);
}

// ---------- formatting ----------
const sign = (n) => (n > 0 ? `+${n}` : `${n}`);
const tone = (n) => (n > 0 ? 'bull' : n < 0 ? 'bear' : 'flat');
const scoreChip = (n, big = false) => `<span class="score ${tone(n)}${big ? ' big' : ''}">${sign(n)}</span>`;
const TRIG_TONE = { fired: 'bear', near: 'warn', armed: 'flat' };
const trigPill = (s) => `<span class="pill ${TRIG_TONE[s] || 'flat'}">${esc(s)}</span>`;
const fmtDate = (iso) => new Date(iso + (iso.length === 10 ? 'T12:00:00Z' : '')).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

// ---------- shell ----------
function shell(page) {
  const nav = PAGES.map((p) => `<a href="${p.href}" class="${p.id === page ? 'active' : ''}">${p.label}</a>`).join('');
  const mockBar = localMode() ? '<div class="mockbar">LOCAL TEST MODE: saves stay in this browser. Nothing is committed to GitHub.</div>' : '';
  document.body.insertAdjacentHTML('afterbegin', `
    <header class="topbar"><div class="topbar-inner">
      <a class="brand" href="index.html">Trading <span>Desk</span></a>
      <nav class="nav">${nav}</nav>
    </div></header>
    ${mockBar}`);
}
function head(title, blurb, right = '') {
  return `<div class="page-head"><div><h1>${esc(title)}</h1>${blurb ? `<p>${blurb}</p>` : ''}</div>${right}</div>`;
}
function panel(title, body, link, cls = '') {
  return `<section class="panel ${cls}"><div class="panel-head"><h2>${esc(title)}</h2>${link ? `<a href="${link.href}">${esc(link.label)} →</a>` : ''}</div>${body}</section>`;
}

function strengthBars(currencies) {
  const rows = [...currencies].sort((a, b) => b.net - a.net).map((c) => {
    const pct = (Math.abs(c.net) / 2) * 50;
    const left = c.net >= 0 ? 50 : 50 - pct;
    const color = c.net > 0 ? 'var(--bull)' : c.net < 0 ? 'var(--bear)' : 'var(--flat)';
    return `<div class="bar-row"><span class="ccy">${c.code}</span>
      <div class="bar-track"><div class="bar-fill" style="left:${left}%;width:${Math.max(pct, 1)}%;background:${color}"></div></div>
      ${scoreChip(c.net)}</div>`;
  });
  return `<div class="bars">${rows.join('')}</div>`;
}

// ---------- pages ----------
const render = {};

// ---------- hub: today ----------
// Nothing here repeats what Nathan is sent. It shows his pairs and calls against live prices,
// the daily read as a checklist, his three lines for the day, and his kill switches.
const DAILY_QUESTIONS = [
  ['What happened, in one story?', 'Morning debrief: the summary paragraph', 'debrief'],
  ['Did pricing move towards or away from my gap?', 'Morning debrief: central-bank pricing table, my currencies only', 'debrief'],
  ['What happened to my pairs, and why?', 'Morning debrief: currencies in depth, my pairs only', 'debrief'],
  ['What is due today and tomorrow, and what would each outcome do?', 'Morning debrief: scenarios for the week; Market Context: Today', 'debrief'],
  ['Where are the levels?', 'Morning debrief: levels to watch, my pairs', 'debrief'],
  ['Anything I missed?', 'Market Context: Today, Shifts; alert emails', 'mc'],
  ['Are my biases still valid?', 'My kill switches against 1 to 6', 'ks'],
];

render.hub = async (main) => {
  const today = ymd(), target = scMonday();
  const [index, ks, lv, notes] = await Promise.all([loadLive('scorecard-index', true), loadLive('killswitches', true), loadLive('levels', true), loadLive('daily-notes', true), loadPrices()]);
  const weeks = index?.weeks || [];
  const wk = weeks.find((w) => w.monday === target) || weeks.find((w) => w.monday < target) || null;
  const card = wk ? await loadLive(`scorecard-${wk.monday}`, true) : null;
  const myPairs = card?.pairs || [], events = card?.events || [];
  const kills = ks?.killSwitches || [], levels = lv?.levels || [];
  let days = notes?.days || {};
  const note = { story: '', ifThen: '', biasCheck: '', done: [], ...(days[today] || {}) };
  let msg = '';
  const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  const wayPill = (way) => `<span class="pill ${way > 0 ? 'bull' : way < 0 ? 'bear' : 'flat'}">${way > 0 ? 'with me' : way < 0 ? 'against me' : 'flat'}</span>`;
  const signOf = (n) => (Math.abs(n) < 0.05 ? 0 : Math.sign(n));

  const statusHtml = () => {
    const next = events.filter((e) => e.date >= today).sort(byDate)[0];
    return sessionState().map((s) => `<span class="pill ${s.open ? 'bull' : 'flat'}">${s.name} ${s.open ? 'open' : 'closed'}</span>`).join('') +
      `<span class="grow"></span>` +
      (next ? `<span class="small">Next of my events: <b>${esc(next.event)}</b> <span class="ccy">${esc(next.currency)}</span> · ${next.date === today ? 'today' : fmtDate(next.date)}</span>` : '') + priceAge();
  };

  const pairLive = (p) => {
    const s = prices?.pairs?.[p.pair];
    if (!s) return '<div class="empty">No price for this pair yet.</div>';
    const near = levels.filter((l) => l.instrument === p.pair && l.status !== 'historical' && Number.isFinite(Number(l.level)))
      .map((l) => ({ l, pct: (Number(l.level) / s.last - 1) * 100 })).sort((a, b) => Math.abs(a.pct) - Math.abs(b.pct)).slice(0, 2);
    return `<div class="kpis">
        <div><label>Last</label><span class="num big">${pxFmt(p.pair, s.last)}</span></div>
        <div><label>Today</label>${pctHtml(s.dayPct)}<div class="small ${s.x >= 1.75 ? 'warn-t' : 'faint'}">${s.x}× a typical day</div></div>
        <div><label>This week</label>${pctHtml(s.wtdPct)}</div>
        <div><label>1 month</label>${pctHtml(s.m1Pct)}</div>
        <div><label>Week vs my call</label>${wayPill(signOf(s.wtdPct) * (p.dir === 'LONG' ? 1 : -1))}</div>
      </div>
      ${near.length ? `<div class="small muted" style="margin-bottom:8px">My levels: ${near.map(({ l, pct }) => `<span class="num">${esc(l.level)}</span> ${esc(l.type)} <span class="faint">(${pct > 0 ? '+' : ''}${pct.toFixed(2)}% away)</span>`).join(' · ')}</div>` : ''}`;
  };
  const pairMine = (p) => {
    const b = p.pair.slice(0, 3), q = p.pair.slice(3);
    const k = kills.filter((x) => x.currency === b || x.currency === q), hot = k.filter((x) => x.status !== 'armed');
    const ev = events.filter((e) => (e.currency === b || e.currency === q) && e.date >= today).sort(byDate).slice(0, 3);
    return `<ul class="list">
      ${ev.map((e) => `<li><span class="small nowrap">${e.date === today ? '<b>today</b>' : fmtDate(e.date)}</span><span class="grow"><b>${esc(e.event)}</b> <span class="ccy">${esc(e.currency)}</span><div class="small muted">${esc(e.ifThen)}</div></span></li>`).join('') || '<li class="small faint">No event written for this pair.</li>'}
      ${hot.map((x) => `<li>${trigPill(x.status)}<span class="grow small">${esc(x.condition)}</span><span class="ccy">${esc(x.currency)}</span></li>`).join('')}
      <li class="small muted"><a href="kill-switches.html">${k.length ? `${k.length} kill switch${k.length > 1 ? 'es' : ''} on ${b} / ${q}` : `No kill switch on ${b} or ${q} yet: write one`}</a></li></ul>`;
  };
  const pairsHtml = () => (myPairs.length
    ? `<div class="grid sc-grid">${myPairs.map((p) => `<section class="panel pcard" data-pair="${esc(p.pair)}">
        <div class="panel-head"><h2><span class="ccy">${esc(p.pair)}</span> <span class="pill ${p.dir === 'LONG' ? 'bull' : 'bear'}">${esc(p.dir)}</span></h2><span class="small muted">gap ${esc(p.diff)}</span></div>
        <div data-live>${pairLive(p)}</div><div class="tv" data-symbol="FX:${esc(p.pair)}"></div>${pairMine(p)}</section>`).join('')}</div>`
    : `<section class="panel"><div class="empty">${card ? 'No pairs confirmed on this week\'s scorecard.' : 'No scorecard yet.'} <a href="scorecard.html?week=${target}">Do the weekly build →</a></div></section>`);

  const callsHtml = () => {
    const order = prices ? [...CCYS].sort((a, b) => prices.currencies[a].rankWtd - prices.currencies[b].rankWtd) : CCYS;
    return `<div class="table-wrap"><table><thead><tr><th>Ccy</th><th>My score</th><th>Today</th><th>This week</th><th>1M rank</th><th>Week vs my call</th></tr></thead><tbody>${order.map((c) => {
      const sc = card && card.active?.includes(c) ? scScore(card.currencies[c]) : null, s = prices?.currencies?.[c];
      return `<tr><td><span class="ccy">${c}</span></td><td>${sc == null ? '<span class="faint">no call</span>' : scoreChip(sc)}</td><td>${pctHtml(s?.dayPct)}</td><td>${pctHtml(s?.wtdPct)}</td>
        <td class="num small">${s ? `${s.rankM1} of 8` : '—'}</td><td>${sc && s ? wayPill(Math.sign(sc) * signOf(s.wtdPct)) : '<span class="faint">—</span>'}</td></tr>`;
    }).join('')}</tbody></table></div>
    <p class="small faint" style="margin:8px 0 0">Each currency against the other seven, averaged. Strongest this week first.</p>`;
  };

  const linkFor = (kind) => ({ debrief: links.get().debrief, mc: links.get().mc || 'https://marketcontext.com/market-flow', ks: 'kill-switches.html' }[kind]);
  const prev = Object.keys(days).filter((d) => d < today).sort().at(-1);
  const readHtml = () => `<ul class="checks">${DAILY_QUESTIONS.map(([q, where, kind], i) => `<li>
      <input type="checkbox" data-q="${i + 1}" ${note.done.includes(i + 1) ? 'checked' : ''}>
      <span class="grow"><b>${i + 1}. ${esc(q)}</b><div class="small muted">${linkFor(kind) ? `<a href="${esc(linkFor(kind))}" ${kind === 'ks' ? '' : 'target="_blank" rel="noopener"'}>${esc(where)} ↗</a>` : esc(where)}</div></span></li>`).join('')}</ul>
    <div class="form-grid">
      <label class="full">The day in one sentence<textarea rows="2" id="dn-story" placeholder="What happened, as one story">${esc(note.story)}</textarea></label>
      <label class="full">Today's event and my if / then<textarea rows="2" id="dn-ifthen" placeholder="If __ prints above __, pricing moves __, my pair should __">${esc(note.ifThen)}</textarea></label>
      <label class="full">Bias check<textarea rows="2" id="dn-bias" placeholder="Holds / a kill switch fired / the gap is closing">${esc(note.biasCheck)}</textarea></label>
    </div>
    <div class="form-actions"><button class="btn primary" data-act="save-note">${localMode() ? 'Save today (local test)' : ghToken.get() ? 'Save today to GitHub' : 'Save today (connect GitHub first)'}</button>
      ${days[today]?.saved ? `<span class="small faint">saved ${new Date(days[today].saved).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>` : ''}</div>
    ${prev ? `<div class="note" style="margin:12px 0 0"><b>${fmtDate(prev)}:</b> ${esc(days[prev].story || '—')}<br><span class="small">Bias check: ${esc(days[prev].biasCheck || '—')}</span></div>` : ''}
    <details class="small" style="margin-top:12px"><summary class="muted">Links for the checklist (kept in this browser only)</summary>
      <div class="form-grid" style="margin-top:8px">
        <label class="wide">Morning debrief link<input id="ln-debrief" value="${esc(links.get().debrief || '')}" placeholder="https://…"></label>
        <label class="wide">Weekly review link<input id="ln-weekly" value="${esc(links.get().weekly || '')}" placeholder="https://…"></label>
      </div><div class="form-actions"><button class="btn" data-act="save-links">Save links on this device</button></div></details>`;

  const hot = kills.filter((x) => x.status !== 'armed');
  const draw = () => {
    main.innerHTML = head(`Today · ${fmtDate(today)}`, 'My pairs and calls against live prices, the daily read, my three lines. What I am sent stays where I read it.',
        `<a class="btn" href="scorecard.html?week=${target}">Weekly build →</a>`) +
      `<div id="hub-msg">${msg ? `<div class="note">${msg}</div>` : ''}</div>` + (canSave() ? '' : connectPanel()) +
      `<div class="statusbar" id="hub-status">${statusHtml()}</div>
      <div class="panel-head"><h2>My pairs${wk ? ` · week of ${fmtDate(wk.monday)}` : ''}</h2>${wk && wk.monday !== target ? `<a href="scorecard.html?week=${target}">No build yet for the week of ${fmtDate(target)} →</a>` : ''}</div>
      <div id="hub-pairs">${pairsHtml()}</div>
      <div class="grid sc-grid" style="margin-top:14px">
        ${panel('The daily read', readHtml())}
        <div>${panel('My calls against price', `<div id="hub-calls">${callsHtml()}</div>`, { href: 'review.html', label: 'Review' })}
          <div style="height:14px"></div>
          ${panel('Kill switches fired or near', `<ul class="list">${hot.map((x) => `<li><span class="ccy">${esc(x.currency)}</span><span class="grow">${esc(x.condition)}<div class="small faint">${esc(x.now || '')}</div></span>${trigPill(x.status)}</li>`).join('') || `<div class="empty">None. ${kills.length} armed.</div>`}</ul>`, { href: 'kill-switches.html', label: 'Kill switches' })}</div>
      </div>`;
    main.querySelectorAll('.tv[data-symbol]').forEach((el) => tvMini(el, el.dataset.symbol));
  };
  // Live parts only: the forms and the charts are left alone.
  const paint = () => {
    $('#hub-status').innerHTML = statusHtml();
    main.querySelectorAll('.pcard').forEach((el) => { const p = myPairs.find((x) => x.pair === el.dataset.pair); if (p) $('[data-live]', el).innerHTML = pairLive(p); });
    $('#hub-calls').innerHTML = callsHtml();
  };
  const say = (html) => { msg = html; $('#hub-msg').innerHTML = html ? `<div class="note">${html}</div>` : ''; };

  main.addEventListener('click', async (ev) => {
    const b = ev.target.closest('button[data-act]'); if (!b) return;
    ev.preventDefault();
    if (b.dataset.act === 'save-links') {
      links.set({ ...links.get(), debrief: $('#ln-debrief').value.trim(), weekly: $('#ln-weekly').value.trim() });
      Object.assign(note, { story: $('#dn-story').value, ifThen: $('#dn-ifthen').value, biasCheck: $('#dn-bias').value, done: [...main.querySelectorAll('[data-q]:checked')].map((x) => Number(x.dataset.q)) });
      msg = 'Links saved on this device.'; draw();
    } else if (b.dataset.act === 'save-note') {
      if (!canSave()) { say('<span class="error">Connect GitHub first, or use local test mode.</span>'); return; }
      const entry = { story: $('#dn-story').value.trim(), ifThen: $('#dn-ifthen').value.trim(), biasCheck: $('#dn-bias').value.trim(), done: [...main.querySelectorAll('[data-q]:checked')].map((x) => Number(x.dataset.q)), saved: new Date().toISOString() };
      say('Saving…');
      try {
        const res = await ghUpdate('daily-notes', (d) => { const x = d || { days: {} }; x.days = { ...(x.days || {}), [today]: entry }; return x; }, `Daily note ${today} (desk)`);
        days = res.data.days; Object.assign(note, entry);
        msg = res.commit === 'local' ? 'Saved in this browser (local test mode). Nothing was committed.' : `Saved to GitHub (commit ${esc(res.commit || '')}).`;
      } catch (e) { msg = `<span class="error">${esc(e.message)}</span>`; }
      draw();
    }
  });
  draw();
  setInterval(async () => { await loadPrices(); paint(); }, 60000);
};

// ---------- scorecard (weekly build) ----------
// One card per trading week, named by its Monday. Nathan types every field; nothing here is pulled.
// Files: data/scorecard-<monday>.json (the card) and data/scorecard-index.json (weeks, newest first).
const SC_LEVELS = ['low', 'normal', 'high'], SC_DIRS = ['rising', 'steady', 'falling'], SC_LEANS = ['hawkish', 'neutral', 'dovish'];
const SC_CALLS = { tooLittle: 'too little priced', aboutRight: 'about right', tooMuch: 'too much priced' };
const scBlankRow = () => ({ growth: { level: '', dir: '' }, inflation: { level: '', dir: '' }, labour: { level: '', dir: '' }, sentence: '', lean: '', priced12m: null, weekChange: null, call: '', strong: false, crowded: false, rank1m: null });
const scBlankCard = (monday) => ({ monday, updated: null, active: ['USD', 'EUR', 'JPY', 'GBP'], currencies: Object.fromEntries(CCYS.map((c) => [c, scBlankRow()])), pairs: [], events: [] });
// Score: the call gives the sign (+ = the market prices too little tightening, so the currency is underpriced);
// "strong" doubles it; crowded positioning pulls it one notch towards zero. No call = no score.
function scScore(row) {
  const base = { tooLittle: 1, aboutRight: 0, tooMuch: -1 }[row.call];
  if (base == null) return null;
  const mag = Math.max(0, Math.abs(base) * (row.strong ? 2 : 1) - (row.crowded ? 1 : 0));
  return mag === 0 ? 0 : Math.sign(base) * mag;
}
// Monday (YYYY-MM-DD, local time) of the trading week a build belongs to: on Saturday and Sunday, the coming Monday.
function scMonday(d = new Date()) {
  const day = d.getDay();
  const shift = day === 0 ? 1 : day === 6 ? 2 : 1 - day;
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate() + shift);
  return `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}-${String(m.getDate()).padStart(2, '0')}`;
}
// Every pair of scored, active currencies whose scores differ, widest gap first. `top` marks highest-vs-lowest.
function scPairs(card) {
  const scored = card.active.map((code) => ({ code, score: scScore(card.currencies[code]) })).filter((c) => c.score != null);
  if (scored.length < 2) return [];
  const max = Math.max(...scored.map((c) => c.score)), min = Math.min(...scored.map((c) => c.score));
  const out = [];
  for (let i = 0; i < PAIR_ORDER.length; i++) for (let j = i + 1; j < PAIR_ORDER.length; j++) {
    const b = scored.find((c) => c.code === PAIR_ORDER[i]), q = scored.find((c) => c.code === PAIR_ORDER[j]);
    if (!b || !q || b.score === q.score) continue;
    const diff = b.score - q.score;
    out.push({ pair: b.code + q.code, dir: diff > 0 ? 'LONG' : 'SHORT', diff: Math.abs(diff), top: Math.max(b.score, q.score) === max && Math.min(b.score, q.score) === min });
  }
  return out.sort((x, y) => y.diff - x.diff || (y.top - x.top));
}

render.scorecard = async (main) => {
  const asked = new URLSearchParams(location.search).get('week') || '';
  const monday = /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : scMonday();
  let index = (await loadLive('scorecard-index', true)) || { weeks: [] };
  await loadPrices();
  // Only weeks listed in the index have a file; a new week starts blank without asking for one.
  const card = (index.weeks.some((w) => w.monday === monday) && (await loadLive(`scorecard-${monday}`, true))) || scBlankCard(monday);
  card.currencies = card.currencies || {};
  for (const c of CCYS) card.currencies[c] = { ...scBlankRow(), ...(card.currencies[c] || {}) };
  card.active = CCYS.filter((c) => (card.active || ['USD', 'EUR', 'JPY', 'GBP']).includes(c));
  card.pairs = card.pairs || [];
  card.events = card.events || [];
  let dirty = false, msg = '';

  const opts = (list, sel) => '<option value="">—</option>' + list.map(([v, l]) => `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(l)}</option>`).join('');
  const same = (list) => list.map((v) => [v, v]);
  const pick = (label, f, list, cur, cls = '') => `<label class="${cls}">${label}<select data-f="${f}">${opts(list, cur)}</select></label>`;
  const num = (label, f, cur, attrs = 'step="any"') => `<label>${label}<input type="number" ${attrs} data-f="${f}" value="${cur == null ? '' : esc(cur)}"></label>`;
  const scoreHtml = (code) => { const s = scScore(card.currencies[code]); return s == null ? '<span class="pill flat">no call</span>' : scoreChip(s); };

  // Confirmed pairs follow the scores: a pair whose two sides no longer differ drops out.
  const prune = () => {
    const live = new Map(scPairs(card).map((p) => [p.pair, p]));
    card.pairs = card.pairs.filter((p) => live.has(p.pair)).map((p) => { const l = live.get(p.pair); return { pair: l.pair, dir: l.dir, diff: l.diff }; });
  };

  const rowPanel = (code) => {
    const r = card.currencies[code];
    return `<section class="panel sc-row" data-ccy="${code}">
      <div class="panel-head"><h2><span class="ccy">${code}</span></h2><span data-score>${scoreHtml(code)}</span></div>
      <div class="form-grid">
        ${pick('Growth level', 'growth.level', same(SC_LEVELS), r.growth.level)}${pick('Growth direction', 'growth.dir', same(SC_DIRS), r.growth.dir)}
        ${pick('Inflation level', 'inflation.level', same(SC_LEVELS), r.inflation.level)}${pick('Inflation direction', 'inflation.dir', same(SC_DIRS), r.inflation.dir)}
        ${pick('Labour level', 'labour.level', same(SC_LEVELS), r.labour.level)}${pick('Labour direction', 'labour.dir', same(SC_DIRS), r.labour.dir)}
        ${pick('Bank leans', 'lean', same(SC_LEANS), r.lean)}${num('1M rank (1-8)', 'rank1m', r.rank1m, `min="1" max="8" step="1" placeholder="${prices ? `live: ${prices.currencies[code].rankM1}` : ''}"`)}
        <label class="full">My sentence<textarea rows="2" data-f="sentence" placeholder="Growth is __, inflation is __, labour is __, so the bank leans __.">${esc(r.sentence)}</textarea></label>
        ${num('Priced 12m (bp)', 'priced12m', r.priced12m)}${num("Week's change (bp)", 'weekChange', r.weekChange)}
        ${pick('My call', 'call', Object.entries(SC_CALLS), r.call, 'wide')}
        <label class="check"><input type="checkbox" data-f="strong" ${r.strong ? 'checked' : ''}> Strong</label>
        <label class="check"><input type="checkbox" data-f="crowded" ${r.crowded ? 'checked' : ''}> COT crowded my way</label>
      </div></section>`;
  };

  const rankBody = () => {
    const scored = card.active.map((code) => ({ code, net: scScore(card.currencies[code]) })).filter((c) => c.net != null);
    const pairs = scPairs(card), chosen = new Set(card.pairs.map((p) => p.pair));
    return `<div class="grid sc-grid">
      <div>${scored.length >= 2 ? strengthBars(scored) : '<div class="empty">Make a call on at least two currencies.</div>'}</div>
      <div>${pairs.length ? `<ul class="list">${pairs.map((p) => `<li><label class="check"><input type="checkbox" data-act="pair" data-pair="${p.pair}" ${chosen.has(p.pair) ? 'checked' : ''}></label>
          <span class="grow"><b>${p.pair}</b> <span class="pill ${p.dir === 'LONG' ? 'bull' : 'bear'}">${p.dir}</span> <span class="small muted">gap ${p.diff}</span></span>
          ${p.top ? '<span class="pill warn">top vs bottom</span>' : ''}</li>`).join('')}</ul>` : '<div class="empty">No pairs yet: two currencies need different scores.</div>'}
        ${card.pairs.length > 3 ? '<div class="note" style="margin:10px 0 0">More than three pairs. The routine says two or three.</div>' : ''}</div>
    </div>`;
  };

  const eventsPanel = () => `<section class="panel" style="margin-top:14px"><div class="panel-head"><h2>Week ahead: events and if / then</h2></div>
    <div class="table-wrap"><table><thead><tr><th>Date</th><th>Ccy</th><th>Event</th><th>If / then</th><th></th></tr></thead>
    <tbody>${[...card.events].sort((a, b) => (a.date < b.date ? -1 : 1)).map((e) => `<tr>
      <td class="small nowrap">${fmtDate(e.date)}</td><td><span class="ccy">${esc(e.currency)}</span></td><td>${esc(e.event)}</td><td class="small">${esc(e.ifThen)}</td>
      <td><button class="link-btn" data-act="del-event" data-id="${esc(e.id)}">Delete</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty">No events yet.</td></tr>'}</tbody></table></div>
    <div class="form-grid" style="margin-top:12px">
      <label>Date<input type="date" id="ev-date"></label>
      <label>Currency<select id="ev-ccy">${card.active.map((c) => `<option>${c}</option>`).join('')}</select></label>
      <label class="wide">Event<input id="ev-event" placeholder="e.g. US CPI"></label>
      <label class="wide">If / then<textarea id="ev-ifthen" rows="2" placeholder="If the print is above __, pricing moves __, the pair should __"></textarea></label>
    </div>
    <div class="form-actions"><button class="btn" data-act="add-event">+ Add event</button></div></section>`;

  const saveBar = () => `<div class="form-actions" style="margin-top:14px">
    <button class="btn primary" data-act="save">${localMode() ? 'Save (local test)' : ghToken.get() ? 'Save to GitHub' : 'Save (connect GitHub first)'}</button>
    ${dirty ? '<span class="pill warn">unsaved changes</span>' : ''}${card.updated ? `<span class="small faint">last saved ${fmtDate(card.updated)}</span>` : ''}</div>`;
  const say = (html) => { msg = html; $('#sc-msg').innerHTML = html ? `<div class="note">${html}</div>` : ''; };

  const draw = () => {
    prune();
    const weeks = [...new Set([monday, ...index.weeks.map((w) => w.monday)])].sort().reverse();
    const saved = new Set(index.weeks.map((w) => w.monday));
    const picker = `<select id="sc-week">${weeks.map((m) => `<option value="${m}" ${m === monday ? 'selected' : ''}>Week of ${fmtDate(m)}${saved.has(m) ? '' : ' (new)'}</option>`).join('')}</select>`;
    main.innerHTML = head(`Scorecard · week of ${fmtDate(monday)}`, 'Weekly build. First my own read of each economy, then what is priced, then rank and pair. Only the gap pays.', picker) +
      `<div id="sc-msg">${msg ? `<div class="note">${msg}</div>` : ''}</div>` +
      (canSave() ? '' : connectPanel()) +
      `<div class="filters"><span class="small muted">Currencies in this build</span>${CCYS.map((c) => `<button class="chip ${card.active.includes(c) ? 'on' : ''}" data-act="toggle" data-ccy="${c}">${c}</button>`).join('')}</div>
      <div class="grid sc-grid">${card.active.map(rowPanel).join('')}</div>
      <section class="panel" style="margin-top:14px"><div class="panel-head"><h2>Rank and pairs</h2></div><div id="sc-rank">${rankBody()}</div></section>` +
      eventsPanel() + `<div id="sc-save">${saveBar()}</div>`;
  };
  // After a field changes: scores, ranking and the save bar update in place, so typing focus is never lost.
  const refresh = () => {
    prune();
    main.querySelectorAll('.sc-row').forEach((el) => { $('[data-score]', el).innerHTML = scoreHtml(el.dataset.ccy); });
    $('#sc-rank').innerHTML = rankBody();
    $('#sc-save').innerHTML = saveBar();
  };

  main.addEventListener('input', (ev) => {
    const el = ev.target.closest('.sc-row [data-f]'); if (!el) return;
    const row = card.currencies[el.closest('.sc-row').dataset.ccy], path = el.dataset.f.split('.');
    const v = el.type === 'checkbox' ? el.checked : el.type === 'number' ? (el.value === '' ? null : Number(el.value)) : el.value;
    if (path.length === 2) row[path[0]][path[1]] = v; else row[path[0]] = v;
    dirty = true; refresh();
  });
  main.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.id === 'sc-week') {
      if (dirty && !confirm('Leave this week without saving?')) { t.value = monday; return; }
      dirty = false; location.search = `?week=${t.value}`;
    } else if (t.dataset.act === 'pair') {
      const p = scPairs(card).find((x) => x.pair === t.dataset.pair);
      card.pairs = card.pairs.filter((x) => x.pair !== t.dataset.pair);
      if (t.checked && p) card.pairs.push({ pair: p.pair, dir: p.dir, diff: p.diff });
      dirty = true; refresh();
    }
  });
  main.addEventListener('click', async (ev) => {
    const b = ev.target.closest('button[data-act]'); if (!b) return;
    ev.preventDefault();
    const act = b.dataset.act;
    if (act === 'toggle') {
      const c = b.dataset.ccy, on = card.active.includes(c);
      card.active = CCYS.filter((x) => (x === c ? !on : card.active.includes(x)));
      dirty = true; draw();
    } else if (act === 'add-event') {
      const date = $('#ev-date').value, event = $('#ev-event').value.trim();
      if (!date || !event) { say('<span class="error">An event needs a date and a name.</span>'); return; }
      card.events.push({ id: `e-${Date.now().toString(36)}`, date, currency: $('#ev-ccy').value, event, ifThen: $('#ev-ifthen').value.trim() });
      dirty = true; msg = ''; draw();
    } else if (act === 'del-event') {
      card.events = card.events.filter((e) => e.id !== b.dataset.id);
      dirty = true; draw();
    } else if (act === 'save') {
      if (!canSave()) { say('<span class="error">Connect GitHub first (Kill Switches page), or use local test mode.</span>'); return; }
      say('Saving…');
      try {
        prune();
        card.updated = new Date().toISOString().slice(0, 10);
        const res = await ghUpdate(`scorecard-${monday}`, () => card, `Scorecard: week of ${monday} (desk)`);
        const entry = { monday, pairs: card.pairs.map(({ pair, dir }) => ({ pair, dir })), scores: Object.fromEntries(card.active.map((c) => [c, scScore(card.currencies[c])]).filter(([, s]) => s != null)) };
        const idx = await ghUpdate('scorecard-index', (d) => { const i = d || { weeks: [] }; i.weeks = [entry, ...i.weeks.filter((w) => w.monday !== monday)].sort((a, b) => (a.monday < b.monday ? 1 : -1)); return i; }, `Scorecard index: week of ${monday} (desk)`);
        index = idx.data; dirty = false;
        msg = res.commit === 'local' ? 'Saved in this browser (local test mode). Nothing was committed.' : `Saved to GitHub (commit ${esc(res.commit || '')}).`;
      } catch (e) { msg = `<span class="error">${esc(e.message)}</span>`; }
      draw();
    }
  });
  window.addEventListener('beforeunload', (ev) => { if (dirty) { ev.preventDefault(); ev.returnValue = ''; } });
  draw();
};

// ---------- key levels (Nathan's own list, held against live price) ----------
render.levels = async (main) => {
  let data = (await loadLive('levels', true)) || { note: '', families: {}, types: {}, statuses: {}, levels: [] };
  await loadPrices();
  const fams = data.families || {}, typeOf = (k) => data.types[k] || {};
  const stTone = { defended: 'bull', broken: 'bear', untested: 'flat', reference: 'flat', historical: 'flat' };
  const today = () => new Date().toISOString().slice(0, 10);
  let editing = null, msg = '';

  const dist = (l) => {
    const s = prices?.pairs?.[l.instrument], lv = Number(l.level);
    if (!s || !Number.isFinite(lv)) return null;
    const pct = (lv / s.last - 1) * 100;
    return { last: s.last, pct, days: s.typicalPct ? Math.abs(pct) / s.typicalPct : null };
  };
  const opts = (list, sel) => list.map(([v, l]) => `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(l)}</option>`).join('');
  const form = (k) => `<section class="panel ks-form" id="lv-form"><div class="panel-head"><h2>${k.id ? 'Edit level' : 'New level'}</h2></div>
    <div class="form-grid">
      <label>Pair<select name="instrument">${opts(ALL_PAIRS.map((p) => [p, p]), k.instrument || 'USDJPY')}</select></label>
      <label>Level<input type="number" step="any" name="level" value="${esc(k.level ?? '')}"></label>
      <label>Type<select name="type">${opts(Object.entries(data.types).map(([v, t]) => [v, `${v} · ${fams[t.family] || t.family}`]), k.type || Object.keys(data.types)[0])}</select></label>
      <label>Side<select name="side">${opts([['cap', 'cap (above price)'], ['floor', 'floor (below price)'], ['pivot', 'pivot']], k.side || 'cap')}</select></label>
      <label class="wide">Who acts here<input name="who" value="${esc(k.who || '')}" placeholder="e.g. Japan MoF / BoJ"></label>
      <label>Status<select name="status">${opts(Object.entries(data.statuses || {}).map(([v]) => [v, v]), k.status || 'untested')}</select></label>
      <label>Last touch<input type="date" name="lastTouch" value="${esc(/^\d{4}-/.test(k.lastTouch || '') ? k.lastTouch : '')}"></label>
      <label class="full">Evidence (why this level matters)<textarea name="evidence" rows="2" placeholder="What happened here, and what I read into it">${esc(k.evidence || '')}</textarea></label>
    </div>
    <div class="form-actions">
      <button class="btn primary" data-act="save">${localMode() ? 'Save (local test)' : ghToken.get() ? 'Save to GitHub' : 'Save (connect GitHub first)'}</button>
      <button class="btn" data-act="cancel">Cancel</button>${k.id ? '<button class="btn danger" data-act="delete">Delete</button>' : ''}
    </div></section>`;

  const rows = () => {
    const f = location.hash.slice(1), want = fams[f] ? f : 'all';
    main.querySelectorAll('[data-fam]').forEach((a) => a.classList.toggle('on', a.dataset.fam === want));
    const list = data.levels.filter((l) => want === 'all' || typeOf(l.type).family === want).map((l) => ({ l, d: dist(l) }))
      .sort((a, b) => (a.d ? Math.abs(a.d.pct) : 1e9) - (b.d ? Math.abs(b.d.pct) : 1e9));
    $('#lv-rows').innerHTML = list.map(({ l, d }) => `<tr>
        <td><span class="ccy">${esc(l.instrument)}</span></td><td class="num">${esc(l.level)}</td>
        <td class="num muted">${d ? pxFmt(l.instrument, d.last) : '—'}</td>
        <td class="nowrap">${d ? `${pctHtml(d.pct)} <span class="small ${d.days != null && d.days < 1 ? 'warn-t' : 'faint'}">${d.days == null ? '' : `${d.days.toFixed(1)} typical days`}</span>` : '<span class="faint">—</span>'}</td>
        <td><span class="pill flat" title="${esc(typeOf(l.type).desc || '')}">${esc(l.type)}</span></td>
        <td class="small">${esc(l.side || '')}</td>
        <td class="small">${esc(l.who || '')}<div class="muted">${esc(l.evidence || '')}</div></td>
        <td><span class="pill ${stTone[l.status] || 'flat'}">${esc(l.status)}</span></td>
        <td class="small nowrap">${/^\d{4}-/.test(l.lastTouch || '') ? fmtDate(l.lastTouch) : '—'}</td>
        <td><button class="link-btn" data-act="edit" data-id="${esc(l.id)}">Edit</button></td>
      </tr>`).join('') || `<tr><td colspan="10" class="empty">No levels yet. Add the ones you watch: intervention zones, forced-hand levels, cost-basis levels.</td></tr>`;
    $('#lv-age').innerHTML = priceAge();
  };

  const draw = () => {
    const cur = editing === 'new' ? {} : data.levels.find((l) => l.id === editing);
    main.innerHTML = head('Key Levels', 'My own levels: where big players showed their hand, their cost basis, their reference points, and levels that force a central bank\'s hand. Nearest to price first.',
        '<button class="btn primary" data-act="new">+ New level</button>') +
      (msg ? `<div class="note">${msg}</div>` : '') + (canSave() ? '' : connectPanel()) + (cur ? form(cur) : '') +
      `<div class="filters tabs" id="lv-fams">${[['all', 'All'], ...Object.entries(fams)].map(([k, v]) => `<a class="chip" data-fam="${k}" href="#${k === 'all' ? '' : k}">${esc(v)}</a>`).join('')}<span class="grow"></span><span id="lv-age"></span></div>
      <section class="panel"><div class="table-wrap"><table>
        <thead><tr><th>Pair</th><th>Level</th><th>Price now</th><th>Distance</th><th>Type</th><th>Side</th><th>Who / evidence</th><th>Status</th><th>Last touch</th><th></th></tr></thead>
        <tbody id="lv-rows"></tbody></table></div></section>
      <div class="grid hub-grid" style="margin-top:14px">
        ${Object.entries(fams).map(([f, label]) => panel(label, `<ul class="list">${Object.entries(data.types).filter(([, t]) => t.family === f).map(([k, t]) => `<li><span class="pill flat">${esc(k)}</span><span class="grow small muted">${esc(t.desc)}</span></li>`).join('')}</ul>`)).join('')}
        ${data.statuses ? panel('Status', `<ul class="list">${Object.entries(data.statuses).map(([k, v]) => `<li><span class="pill ${stTone[k] || 'flat'}">${esc(k)}</span><span class="grow small muted">${esc(v)}</span></li>`).join('')}</ul>`) : ''}
      </div>`;
    rows();
    if (cur) $('#lv-form').scrollIntoView({ block: 'nearest' });
  };

  const save = async (change, label) => {
    if (!canSave()) { msg = '<span class="error">Connect GitHub first, or use local test mode.</span>'; draw(); return; }
    msg = 'Saving…'; draw();
    try {
      const res = await ghUpdate('levels', change, `Key level: ${label} (desk)`);
      data = res.data; editing = null;
      msg = res.commit === 'local' ? 'Saved in this browser (local test mode). Nothing was committed.' : `Saved to GitHub (commit ${esc(res.commit || '')}).`;
    } catch (e) { msg = `<span class="error">${esc(e.message)}</span>`; }
    draw();
  };

  main.addEventListener('click', async (ev) => {
    const b = ev.target.closest('button[data-act]'); if (!b) return;
    ev.preventDefault();
    const act = b.dataset.act;
    if (act === 'new') { editing = 'new'; msg = ''; draw(); }
    else if (act === 'edit') { editing = b.dataset.id; msg = ''; draw(); }
    else if (act === 'cancel') { editing = null; draw(); }
    else if (act === 'delete') {
      const id = editing;
      if (!confirm('Delete this level?')) return;
      await save((d) => ({ ...d, levels: d.levels.filter((l) => l.id !== id) }), `delete ${id}`);
    } else if (act === 'save') {
      const f = $('#lv-form'), val = (n) => f.querySelector(`[name="${n}"]`).value.trim();
      if (val('level') === '' || !Number.isFinite(Number(val('level')))) { msg = '<span class="error">Give the level as a number.</span>'; draw(); return; }
      const fields = { instrument: val('instrument'), level: Number(val('level')), type: val('type'), side: val('side'), who: val('who'), status: val('status'), lastTouch: val('lastTouch') || null, evidence: val('evidence') };
      if (editing === 'new') {
        const id = `l-${fields.instrument.toLowerCase()}-${Date.now().toString(36)}`;
        await save((d) => ({ ...d, levels: [...(d.levels || []), { id, ...fields, created: today() }] }), `add ${fields.instrument} ${fields.level}`);
      } else {
        const id = editing;
        await save((d) => ({ ...d, levels: d.levels.map((l) => (l.id === id ? { ...l, ...fields, edited: today() } : l)) }), `edit ${id}`);
      }
    }
  });
  window.addEventListener('hashchange', rows);
  draw();
  setInterval(async () => { await loadPrices(); if ($('#lv-rows')) rows(); }, 60000);
};

render.killswitches = async (main) => {
  let data = (await loadLive('killswitches', true)) || { kinds: {}, effects: {}, killSwitches: [] };
  const want = new URLSearchParams(location.search).get('ccy');
  const order = { fired: 0, near: 1, armed: 2 };
  const today = () => new Date().toISOString().slice(0, 10);
  let editing = null; // id being edited, 'new', or null
  let msg = '';

  const opts = (list, sel) => list.map(([v, l]) => `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(l)}</option>`).join('');
  const form = (k) => `<section class="panel ks-form" id="ks-form"><div class="panel-head"><h2>${k.id ? 'Edit kill switch' : 'New kill switch'}</h2></div>
    <div class="form-grid">
      <label>Currency<select name="currency">${opts([...CCYS, 'XAU'].map((c) => [c, c]), k.currency || want || 'USD')}</select></label>
      <label>Kind<select name="kind">${opts(Object.entries(data.kinds).map(([v, d]) => [v, `${v} · ${d}`]), k.kind || 'data')}</select></label>
      <label>Effect<select name="effect">${opts(Object.entries(data.effects).map(([v, d]) => [v, `${v} · ${d}`]), k.effect || 'freeze')}</select></label>
      <label>Status<select name="status">${opts([['armed', 'armed'], ['near', 'near'], ['fired', 'fired']], k.status || 'armed')}</select></label>
      <label class="wide">Condition (what kills or changes the bias)<textarea name="condition" rows="2" placeholder="e.g. US core CPI above 0.4% m/m">${esc(k.condition || '')}</textarea></label>
      <label class="wide">Now (current reading, optional)<input name="now" value="${esc(k.now || '')}" placeholder="e.g. last print 0.3%"></label>
      <label>Fired on<input type="date" name="firedOn" value="${esc(k.firedOn || '')}"></label>
    </div>
    <div class="form-actions">
      <button class="btn primary" data-act="save">${localMode() ? 'Save (local test)' : ghToken.get() ? 'Save to GitHub' : 'Save (connect GitHub first)'}</button>
      <button class="btn" data-act="cancel">Cancel</button>
      ${k.id ? '<button class="btn danger" data-act="delete">Delete</button>' : ''}
    </div></section>`;

  const connect = () => {
    if (localMode()) return '<div class="note">Local test mode: saves stay in this browser.</div>';
    return ghToken.get()
      ? `<div class="note">Connected to GitHub: changes are committed to <code>${GH.dir}/killswitches.json</code> in ${esc(GH.repo)}. <button class="link-btn" data-act="forget">Forget token on this device</button></div>`
      : `<section class="panel" style="margin-bottom:14px"><div class="panel-head"><h2>Connect GitHub to edit</h2></div>
        <p class="small muted" style="margin:0 0 8px">Read-only until connected. Create a <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">fine-grained token ↗</a>: repository access <b>only ${esc(GH.repo)}</b>, permission <b>Contents: Read and write</b>, short expiry. Paste it here once per device; it stays in this browser and is only sent to api.github.com.</p>
        <div class="form-actions"><input type="password" id="gh-token" placeholder="github_pat_…" autocomplete="off" style="flex:1;min-width:200px"><button class="btn primary" data-act="token">Connect</button></div></section>`;
  };

  const draw = () => {
    const list = data.killSwitches.filter((t) => !want || t.currency === want).sort((a, b) => order[a.status] - order[b.status]);
    const cur = editing === 'new' ? {} : data.killSwitches.find((k) => k.id === editing);
    main.innerHTML = head('Kill Switches', 'What kills or changes my bias. Each kill switch = condition + effect on the bias.' + (want ? ` Showing <b>${esc(want)}</b> · <a href="kill-switches.html">show all</a>` : ''),
      '<button class="btn primary" data-act="new">+ New kill switch</button>') +
      (msg ? `<div class="note">${msg}</div>` : '') + connect() + (cur ? form(cur) : '') +
      `<section class="panel"><div class="table-wrap"><table>
      <thead><tr><th>Status</th><th>Ccy</th><th>Kind</th><th>Condition</th><th>Now</th><th>Effect</th><th>Fired</th><th></th></tr></thead>
      <tbody>${list.map((t) => `<tr>
        <td>${trigPill(t.status)}</td><td><span class="ccy">${esc(t.currency)}</span></td>
        <td class="small" title="${esc(data.kinds[t.kind])}">${esc(t.kind)}</td>
        <td>${esc(t.condition)}${t.by === 'manual' ? ' <span class="pill flat">mine</span>' : ''}</td>
        <td class="small num muted">${esc(t.now)}</td>
        <td><span class="pill flat" title="${esc(data.effects[t.effect])}">${esc(t.effect)}</span></td>
        <td class="small nowrap">${t.firedOn ? fmtDate(t.firedOn) : '—'}</td>
        <td><button class="link-btn" data-act="edit" data-id="${esc(t.id)}">Edit</button></td>
      </tr>`).join('') || '<tr><td colspan="8" class="empty">No kill switches yet.</td></tr>'}</tbody></table></div></section>
    <div class="grid hub-grid" style="margin-top:14px">
      ${panel('Kill switch kinds', `<ul class="list">${Object.entries(data.kinds).map(([k, v]) => `<li><b class="small">${esc(k)}</b><span class="grow small muted">${esc(v)}</span></li>`).join('')}</ul>`)}
      ${panel('Effects', `<ul class="list">${Object.entries(data.effects).map(([k, v]) => `<li><span class="pill flat">${esc(k)}</span><span class="grow small muted">${esc(v)}</span></li>`).join('')}</ul>`)}
    </div>`;
    if (cur) $('#ks-form').scrollIntoView({ block: 'nearest' });
  };

  const save = async (change, label) => {
    if (!canSave()) { msg = '<span class="error">Connect GitHub first.</span>'; draw(); return; }
    msg = 'Saving…'; draw();
    try {
      const res = await ghUpdate('killswitches', change, `Kill switch: ${label} (desk)`);
      data = res.data; editing = null;
      if (res.commit === 'local') {
        msg = 'Saved in this browser (local test mode). Nothing was committed.';
      } else {
        msg = `Saved to GitHub (commit ${esc(res.commit || '')}). Shows here right away; the Pages copy catches up on the next deploy.`;
      }
    } catch (e) { msg = `<span class="error">${esc(e.message)}</span>`; }
    draw();
  };

  main.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-act]'); if (!b) return;
    ev.preventDefault();
    const act = b.dataset.act;
    if (act === 'new') { editing = 'new'; msg = ''; draw(); }
    else if (act === 'edit') { editing = b.dataset.id; msg = ''; draw(); }
    else if (act === 'cancel') { editing = null; draw(); }
    else if (act === 'token') {
      const v = $('#gh-token').value.trim(); if (!v) return;
      ghToken.set(v); delete cache['live:killswitches'];
      try { data = (await ghRead('killswitches')).data; msg = 'Connected. You can add and edit kill switches now.'; }
      catch (e) { ghToken.set(''); msg = `<span class="error">Token did not work: ${esc(e.message)}</span>`; }
      draw();
    }
    else if (act === 'forget') { ghToken.set(''); msg = 'Token removed from this device.'; draw(); }
    else if (act === 'delete') {
      const id = editing;
      if (!confirm('Delete this kill switch from the repo?')) return;
      await save((d) => ({ ...d, killSwitches: d.killSwitches.filter((k) => k.id !== id) }), `delete ${id}`);
    }
    else if (act === 'save') {
      const f = $('#ks-form'), val = (n) => f.querySelector(`[name="${n}"]`).value.trim();
      if (!val('condition')) { msg = '<span class="error">Write the condition first.</span>'; draw(); return; }
      const fields = { currency: val('currency'), kind: val('kind'), effect: val('effect'), status: val('status'), condition: val('condition'), now: val('now'), firedOn: val('firedOn') || null };
      if (fields.status === 'fired' && !fields.firedOn) fields.firedOn = today();
      if (fields.status !== 'fired') fields.firedOn = null;
      if (editing === 'new') {
        const id = `k-${fields.currency.toLowerCase()}-${Date.now().toString(36)}`;
        await save((d) => ({ ...d, killSwitches: [...d.killSwitches, { id, ...fields, by: 'manual', created: today() }] }), `add ${fields.currency} ${fields.kind}`);
      } else {
        const id = editing;
        await save((d) => ({ ...d, killSwitches: d.killSwitches.map((k) => (k.id === id ? { ...k, ...fields, edited: today() } : k)) }), `edit ${id}`);
      }
    }
  });
  draw();
};

// ---------- ideas (inbox for what Nathan picks up from podcasts, videos, calls) ----------
render.ideas = async (main) => {
  let data = (await loadLive('ideas', true)) || { ideas: [] };
  const TONE = { open: 'warn', kept: 'bull', dropped: 'flat' };
  const today = () => new Date().toISOString().slice(0, 10);
  let editing = null, msg = '', filter = 'all';

  const opts = (list, sel) => list.map((v) => `<option ${v === sel ? 'selected' : ''}>${esc(v)}</option>`).join('');
  const form = (k) => `<section class="panel ks-form" id="id-form"><div class="panel-head"><h2>${k.id ? 'Edit idea' : 'New idea'}</h2></div>
    <div class="form-grid">
      <label>Date<input type="date" name="date" value="${esc(k.date || today())}"></label>
      <label class="wide">Source<input name="source" list="id-sources" value="${esc(k.source || '')}" placeholder="podcast, video, call, own">
        <datalist id="id-sources">${['Podcast', 'YouTube', 'Coaching call', 'Morning debrief', 'Weekly review', 'Own idea'].map((s) => `<option value="${s}">`).join('')}</datalist></label>
      <label>Status<select name="status">${opts(['open', 'kept', 'dropped'], k.status || 'open')}</select></label>
      <label class="full">The idea<textarea name="text" rows="3" placeholder="One idea, in my own words. What would I check to see if it holds?">${esc(k.text || '')}</textarea></label>
    </div>
    <div class="form-actions">
      <button class="btn primary" data-act="save">${localMode() ? 'Save (local test)' : ghToken.get() ? 'Save to GitHub' : 'Save (connect GitHub first)'}</button>
      <button class="btn" data-act="cancel">Cancel</button>${k.id ? '<button class="btn danger" data-act="delete">Delete</button>' : ''}
    </div></section>`;

  const draw = () => {
    const cur = editing === 'new' ? {} : data.ideas.find((i) => i.id === editing);
    const list = data.ideas.filter((i) => filter === 'all' || i.status === filter).sort((a, b) => (a.date < b.date ? 1 : -1));
    const count = (s) => data.ideas.filter((i) => s === 'all' || i.status === s).length;
    main.innerHTML = head('Ideas', 'Things I pick up from podcasts, videos and calls, in my own words. Open until I have checked them; then kept or dropped.',
        '<button class="btn primary" data-act="new">+ New idea</button>') +
      (msg ? `<div class="note">${msg}</div>` : '') + (canSave() ? '' : connectPanel()) + (cur ? form(cur) : '') +
      `<div class="filters">${['all', 'open', 'kept', 'dropped'].map((s) => `<button class="chip ${filter === s ? 'on' : ''}" data-act="filter" data-s="${s}">${s} ${count(s)}</button>`).join('')}</div>
      <section class="panel"><ul class="list">${list.map((i) => `<li><span class="small nowrap muted">${fmtDate(i.date)}</span>
        <span class="grow">${esc(i.text)}<div class="small faint">${esc(i.source || '')}</div></span>
        <span class="pill ${TONE[i.status] || 'flat'}">${esc(i.status)}</span><button class="link-btn" data-act="edit" data-id="${esc(i.id)}">Edit</button></li>`).join('') || '<div class="empty">Nothing here yet.</div>'}</ul></section>`;
    if (cur) $('#id-form').scrollIntoView({ block: 'nearest' });
  };

  const save = async (change, label) => {
    if (!canSave()) { msg = '<span class="error">Connect GitHub first, or use local test mode.</span>'; draw(); return; }
    msg = 'Saving…'; draw();
    try {
      const res = await ghUpdate('ideas', (d) => change(d || { ideas: [] }), `Idea: ${label} (desk)`);
      data = res.data; editing = null;
      msg = res.commit === 'local' ? 'Saved in this browser (local test mode). Nothing was committed.' : `Saved to GitHub (commit ${esc(res.commit || '')}).`;
    } catch (e) { msg = `<span class="error">${esc(e.message)}</span>`; }
    draw();
  };

  main.addEventListener('click', async (ev) => {
    const b = ev.target.closest('button[data-act]'); if (!b) return;
    ev.preventDefault();
    const act = b.dataset.act;
    if (act === 'new') { editing = 'new'; msg = ''; draw(); }
    else if (act === 'edit') { editing = b.dataset.id; msg = ''; draw(); }
    else if (act === 'cancel') { editing = null; draw(); }
    else if (act === 'filter') { filter = b.dataset.s; draw(); }
    else if (act === 'delete') {
      const id = editing;
      if (!confirm('Delete this idea?')) return;
      await save((d) => ({ ...d, ideas: d.ideas.filter((i) => i.id !== id) }), `delete ${id}`);
    } else if (act === 'save') {
      const f = $('#id-form'), val = (n) => f.querySelector(`[name="${n}"]`).value.trim();
      if (!val('text')) { msg = '<span class="error">Write the idea first.</span>'; draw(); return; }
      const fields = { date: val('date') || today(), source: val('source'), status: val('status'), text: val('text') };
      if (editing === 'new') {
        const id = `i-${Date.now().toString(36)}`;
        await save((d) => ({ ...d, ideas: [...d.ideas, { id, ...fields }] }), 'add');
      } else {
        const id = editing;
        await save((d) => ({ ...d, ideas: d.ideas.map((i) => (i.id === id ? { ...i, ...fields } : i)) }), `edit ${id}`);
      }
    }
  });
  draw();
};

// ---------- review (were my calls right? graded from prices, not from memory) ----------
render.review = async (main) => {
  const [index] = await Promise.all([loadLive('scorecard-index', true), loadPrices()]);
  const weeks = index?.weeks || [];
  const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const hitPill = (r) => (r == null ? '<span class="pill flat">no data</span>' : `<span class="pill ${r > 0.05 ? 'bull' : r < -0.05 ? 'bear' : 'flat'}">${r > 0.05 ? 'right' : r < -0.05 ? 'wrong' : 'flat'}</span>`);

  // A week runs from the last close before its Monday to its Friday close (or the latest price while it is running).
  const grade = (w) => {
    const dates = prices?.history?.dates || [];
    const friday = addDays(w.monday, 4);
    let ref = -1, end = -1;
    dates.forEach((d, i) => { if (d < w.monday) ref = i; if (d >= w.monday && d <= friday) end = i; });
    if (ref < 0 || end < 0) return { state: ref < 0 ? 'too old for the price history' : 'not started', pairs: [], calls: [] };
    const running = Date.now() <= Date.parse(friday + 'T22:00:00Z');
    // While the week runs, its end is the live quote; afterwards, its Friday close.
    const val = (c, i) => (running && i === end ? prices.liveUsd[c] : histUsd(c, i));
    const px = (b, q, i) => val(b, i) / val(q, i);
    const basket = (c) => { const o = CCYS.filter((x) => x !== c); return o.reduce((s, x) => s + (px(c, x, end) / px(c, x, ref) - 1) * 100, 0) / o.length; };
    return {
      state: running ? 'running' : 'closed', from: dates[ref], to: dates[end],
      pairs: (w.pairs || []).map((p) => { const b = p.pair.slice(0, 3), q = p.pair.slice(3); const move = (px(b, q, end) / px(b, q, ref) - 1) * 100; return { ...p, move, mine: move * (p.dir === 'LONG' ? 1 : -1) }; }),
      calls: Object.entries(w.scores || {}).filter(([, s]) => s !== 0).map(([c, s]) => { const move = basket(c); return { c, s, move, mine: move * Math.sign(s) }; }),
    };
  };
  const graded = weeks.map((w) => ({ w, g: grade(w) }));
  const closed = graded.filter((x) => x.g.state === 'closed');
  const tally = (key) => { const all = closed.flatMap((x) => x.g[key]); const right = all.filter((r) => r.mine > 0.05).length, wrong = all.filter((r) => r.mine < -0.05).length; return { n: all.length, right, wrong }; };
  const tp = tally('pairs'), tc = tally('calls');
  const stat = (label, t) => `<div><label>${label}</label><span class="num big">${t.n ? `${t.right} of ${t.n}` : '—'}</span><div class="small faint">${t.n ? `${t.wrong} wrong, ${t.n - t.right - t.wrong} flat` : 'no closed week yet'}</div></div>`;

  main.innerHTML = head('Review', 'Were my calls right? Each saved week is graded from prices: pairs by their move in my direction, currency calls by the currency against the other seven.', `<span>${priceAge()}</span>`) +
    `<section class="panel" style="margin-bottom:14px"><div class="kpis">${stat('Pairs right, closed weeks', tp)}${stat('Currency calls right, closed weeks', tc)}
      <div><label>Weeks saved</label><span class="num big">${weeks.length}</span></div></div></section>` +
    (graded.map(({ w, g }) => `<section class="panel" style="margin-bottom:14px">
      <div class="panel-head"><h2>Week of ${fmtDate(w.monday)}</h2><span><span class="pill ${g.state === 'running' ? 'warn' : 'flat'}">${esc(g.state)}</span> <a href="scorecard.html?week=${w.monday}">Scorecard →</a></span></div>
      ${g.from ? `<p class="small faint" style="margin:0 0 8px">Measured from the close of ${fmtDate(g.from)} to ${g.state === 'running' ? 'now' : `the close of ${fmtDate(g.to)}`}.</p>` : ''}
      <div class="grid sc-grid">
        <div><div class="small muted" style="margin-bottom:4px">Pairs</div><ul class="list">${g.pairs.map((p) => `<li><b>${esc(p.pair)}</b> <span class="pill ${p.dir === 'LONG' ? 'bull' : 'bear'}">${esc(p.dir)}</span><span class="grow small muted">pair moved ${pctHtml(p.move)}</span>${hitPill(p.mine)}</li>`).join('') || `<li class="small faint">${(w.pairs || []).length ? 'Not measurable yet.' : 'No pairs confirmed that week.'}</li>`}</ul></div>
        <div><div class="small muted" style="margin-bottom:4px">Currency calls</div><ul class="list">${g.calls.map((c) => `<li><span class="ccy">${esc(c.c)}</span> ${scoreChip(c.s)}<span class="grow small muted">vs the other seven ${pctHtml(c.move)}</span>${hitPill(c.mine)}</li>`).join('') || `<li class="small faint">${Object.keys(w.scores || {}).length ? 'Not measurable yet, or all calls were "about right".' : 'No calls that week.'}</li>`}</ul></div>
      </div></section>`).join('') || '<section class="panel"><div class="empty">No scorecard saved yet. This page fills itself once a week has been saved. <a href="scorecard.html">Do the weekly build →</a></div></section>') +
    `<p class="small faint">A call counts as right when price moved more than 0.05% its way over the week. This grades direction only, not entries or exits. My own verdict per call and the monthly review come next.</p>`;
};

// ---------- boot ----------
(async () => {
  const page = document.body.dataset.page;
  const main = document.createElement('main');
  document.body.appendChild(main);
  shell(page);
  try {
    if (typeof render[page] !== 'function') throw new Error('Unknown page');
    await render[page](main);
  } catch (err) {
    const hint = location.protocol === 'file:' ? ' Open through a web server (e.g. npm run desk), not as a file.' : '';
    main.innerHTML = `<p class="error">Could not load this page: ${esc(err.message)}.${hint}</p>`;
  }
})();
