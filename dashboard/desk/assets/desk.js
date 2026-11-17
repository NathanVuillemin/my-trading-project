// Trading Desk: shared shell + page renderers.
// Every page is a thin HTML file with <body data-page="...">; this script draws the nav bar and the
// page. The desk holds Nathan's own layer only: what he types (scorecard, kill switches, levels, notes,
// ideas) is saved to ./data/ through GitHub; the one thing it reads is a small live price file, used
// to hold his entries against the market. It shows no data he is already sent elsewhere.

const PAGES = [
  { id: 'hub', href: 'index.html', label: 'Today' },
  { id: 'scorecard', href: 'scorecard.html', label: 'Scorecard' },
  { id: 'countries', href: 'countries.html', label: 'Countries' },
  { id: 'playbook', href: 'playbook.html', label: 'Playbook' },
  { id: 'killswitches', href: 'kill-switches.html', label: 'Kill Switches' },
  { id: 'levels', href: 'levels.html', label: 'Key Levels' },
  { id: 'positioning', href: 'positioning.html', label: 'Positioning' },
  { id: 'drivers', href: 'drivers.html', label: 'Drivers' },
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
  const [index, ks, lv, notes, news] = await Promise.all([loadLive('scorecard-index', true), loadLive('killswitches', true), loadLive('levels', true), loadLive('daily-notes', true), loadLive('news', true).catch(() => null), loadPrices()]);
  let attrKey = 'wtdPct';
  // News stays where it is published: links out, plus a short written brief (data/news.json) of what happened and
  // what to look for. No feed on the desk.
  const newsHtml = () => {
    const b = news?.brief, groups = [...new Set((news?.links || []).map((l) => l.group))];
    return `${b ? `<div class="news-brief"><div class="small muted">Brief written ${esc(fmtDate(b.date))}${b.date < ymd(new Date(Date.now() - 2 * 864e5)) ? ' <span class="pill warn">old</span>' : ''}</div>
        <div class="nb-cols"><div><div class="pc-h">What happened</div><ul class="list">${(b.summary || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
        <div><div class="pc-h">What to look for</div><ul class="list">${(b.watch || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div></div>
        ${(b.sources || []).length ? `<div class="small faint">Read in full: ${b.sources.map((x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a>`).join(' · ')}</div>` : ''}</div>`
      : '<div class="empty small">No brief yet. Ask Claude for "today\'s news brief" and it writes one here.</div>'}
      <div class="news-links">${groups.map((g) => `<div><div class="small muted">${esc(g)}</div>${news.links.filter((l) => l.group === g).map((l) => `<a class="chip-link" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.title)} ↗</a>`).join('')}</div>`).join('')}</div>`;
  };
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
    return `<div class="table-wrap"><table><thead><tr><th>Ccy</th><th>My score</th><th>Today</th><th>This week</th><th title="Where the currency's move over the last month ranks against the other seven: 1 = strongest, 8 = weakest">1-month move rank</th><th>Week vs my call</th></tr></thead><tbody>${order.map((c) => {
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
      </div>
      <section class="panel" style="margin-top:14px"><div class="panel-head"><h2>Whose story is it? Each currency against each other</h2>
        <span>${[['dayPct', 'Today'], ['wtdPct', 'This week'], ['m1Pct', '1 month']].map(([k, l]) => `<button class="chip ${attrKey === k ? 'on' : ''}" data-act="attr" data-k="${k}">${l}</button>`).join('')}</span></div>
        <div id="hub-attr">${attributionHtml(attrKey)}</div></section>
      ${panel('News: summary and where to read it', newsHtml())}`;
    main.querySelectorAll('.tv[data-symbol]').forEach((el) => tvMini(el, el.dataset.symbol));
  };
  // Live parts only: the forms and the charts are left alone.
  const paint = () => {
    $('#hub-status').innerHTML = statusHtml();
    main.querySelectorAll('.pcard').forEach((el) => { const p = myPairs.find((x) => x.pair === el.dataset.pair); if (p) $('[data-live]', el).innerHTML = pairLive(p); });
    $('#hub-calls').innerHTML = callsHtml();
    $('#hub-attr').innerHTML = attributionHtml(attrKey);
  };
  const say = (html) => { msg = html; $('#hub-msg').innerHTML = html ? `<div class="note">${html}</div>` : ''; };

  main.addEventListener('click', async (ev) => {
    const b = ev.target.closest('button[data-act]'); if (!b) return;
    ev.preventDefault();
    if (b.dataset.act === 'attr') {
      attrKey = b.dataset.k;
      b.parentElement.querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x === b));
      $('#hub-attr').innerHTML = attributionHtml(attrKey);
    } else if (b.dataset.act === 'save-links') {
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
// One card per trading week, named by its Monday. Data fields are filled from Market Context; "My view" comes from
// the Countries page (data/views.json); the call and the rest Nathan types here.
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

// ---------- my view per currency (written on Countries, shown on the Scorecard) ----------
// data/views.json: { views: { CCY: [{ date, text }] } }, newest first. One entry per day; a later save that day replaces it.
const VIEW_PLACEHOLDER = 'Growth is __, inflation is __, labour is __, so the bank leans __.';
const loadViews = async () => { const d = await loadLive('views', true).catch(() => null); return { views: {}, ...(d || {}) }; };
// The view in force for a scorecard week: newest entry dated on or before that week's Friday.
function viewFor(views, code, monday) {
  const fri = new Date(Date.parse(monday + 'T12:00:00Z') + 4 * 864e5).toISOString().slice(0, 10);
  return (views?.views?.[code] || []).find((v) => v.date <= fri) || null;
}
const viewAge = (date) => { const n = Math.round((Date.parse(ymd() + 'T12:00:00Z') - Date.parse(date + 'T12:00:00Z')) / 864e5); return n <= 0 ? 'today' : n === 1 ? '1 day old' : `${n} days old`; };
const saveView = (code, text) => ghUpdate('views', (d) => {
  const next = { views: {}, ...(d || {}) }, date = ymd();
  next.views[code] = [{ date, text }, ...(next.views[code] || []).filter((v) => v.date !== date)];
  return next;
}, `View: ${code} (desk)`);

render.scorecard = async (main) => {
  const asked = new URLSearchParams(location.search).get('week') || '';
  const monday = /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : scMonday();
  let index = (await loadLive('scorecard-index', true)) || { weeks: [] };
  const [pos, drv, views] = await Promise.all([loadLive('positioning', true).catch(() => null), loadLive('drivers', true).catch(() => null), loadViews(), loadPrices()]);
  const PC = pos?.currencies || {};
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

  // Fields filled for Nathan (scripts/desk-fill.mjs) keep their evidence in `row.auto`: the figure behind each
  // label, where it was read and when. A dropdown that no longer matches what was filled is marked as his change.
  const AUTO_ROWS = [['inflation', 'Inflation'], ['growth', 'Growth'], ['labour', 'Unemployment']];
  const evidence = (code) => {
    const r = card.currencies[code], a = r.auto;
    if (!a) return '';
    const line = ([key, label]) => {
      const e = a[key]; if (!e) return '';
      const mine = r[key].level !== e.level || r[key].dir !== e.dir;
      return `<li><span class="grow"><b>${label}</b> <span class="muted">${esc(e.name || '')}</span> <span class="num">${esc(e.value ?? '')}</span>${e.projection != null && e.projection !== '' ? ` <span class="faint">projected ${esc(e.projection)}</span>` : ''}</span>
        <span class="small ${mine ? 'warn-t' : 'muted'}">${esc(e.level)} · ${esc(e.dir)}${mine ? ' (I changed it)' : ''}</span></li>`;
    };
    const b = a.rates, leanMine = b && r.lean !== b.stance;
    const bank = b ? `<li><span class="grow"><b>Bank</b> <span class="muted">policy</span> <span class="num">${esc(b.policy ?? '')}</span> <span class="muted">2Y</span> <span class="num">${esc(b.y2 ?? '')}</span>${b.spreadBp != null ? ` <span class="faint">${b.spreadBp > 0 ? '+' : ''}${esc(b.spreadBp)}bp${b.priced ? `, ${esc(String(b.priced).toLowerCase())}` : ''}</span>` : ''}</span>
        <span class="small ${leanMine ? 'warn-t' : 'muted'}">${esc(b.stance || '')}${leanMine ? ' (I changed it)' : ''}</span></li>` : '';
    return `<ul class="list sc-evidence">${AUTO_ROWS.map(line).join('')}${bank}</ul>
      <p class="small faint" style="margin:4px 0 10px">${esc(a.source)}, read ${new Date(a.readAt).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}. Unemployment "low" means a tight jobs market.</p>`;
  };
  // The 1-month rank comes from the desk's own live prices unless Nathan types another; it is stored on save.
  const liveRank = (code) => prices?.currencies?.[code]?.rankM1 ?? null;

  // COT positioning (data/positioning.json). "COT crowded my way" fills itself once a call is made: yes when asset
  // managers or leveraged funds already sit at an extreme in the call's direction. Once Nathan ticks or unticks the
  // box himself (crowdedBy: 'me'), his choice stands and the hint shows where COT disagrees.
  const callSign = (r) => ({ tooLittle: 1, tooMuch: -1 }[r.call] || 0);
  const cotFor = (code) => posCrowdedMyWay(PC[code], callSign(card.currencies[code]));
  const applyCot = () => {
    let changed = false;
    for (const c of card.active) {
      const r = card.currencies[c], v = cotFor(c);
      if (!v || r.crowdedBy === 'me') continue;
      if (r.crowded !== v.yes || r.crowdedBy !== 'cot') { changed = changed || r.crowded !== v.yes; r.crowded = v.yes; r.crowdedBy = 'cot'; }
    }
    return changed;
  };
  const cotHint = (code) => {
    if (!PC[code]) return '';
    const r = card.currencies[code], v = cotFor(code);
    if (!v) return '<span class="cot-hint faint">fills from COT once I make a call</span>';
    const said = v.yes ? `yes: ${esc(v.why)}` : 'no extreme my way';
    if (r.crowdedBy === 'me' && r.crowded !== v.yes) return `<span class="cot-hint warn-t">my override; COT says ${said}</span>`;
    return `<span class="cot-hint ${v.yes ? 'warn-t' : 'muted'}">${r.crowdedBy === 'me' ? 'my choice' : 'from COT'}: ${said}</span>`;
  };
  const cotBlock = (code) => (PC[code] ? `<div class="sc-cot">${posGauge(PC[code], { compact: true })}<div class="pos-legend">${posLegend(PC[code])}</div>${posSqueeze(PC[code])}</div>` : '');
  const posMap = () => (!pos ? '' : `<section class="panel" style="margin-bottom:14px"><div class="panel-head"><h2>Positioning · COT of ${fmtDate(pos.cotDate)}</h2><a href="positioning.html">Positioning →</a></div>
    <div class="pos-map">${CCYS.filter((c) => PC[c]).sort((a, b) => (posGrp(PC[b], 'slow')?.index ?? 0) - (posGrp(PC[a], 'slow')?.index ?? 0)).map((c) => `<div class="pos-map-row ${card.active.includes(c) ? '' : 'dim'}"><span class="ccy">${c}</span>${posGauge(PC[c], { compact: true })}</div>`).join('')}</div>
    <p class="small faint" style="margin:6px 0 0">● asset managers (slow) · ◆ leveraged funds (fast) · hollow = 4 weeks ago · shaded ends = crowded. "COT crowded my way" in each currency fills itself from this once I make a call; ticking it myself overrides.</p></section>`);
  dirty = applyCot() || dirty;

  // The course's five layers against my call for this currency. Each layer reads one thing already on the card:
  //   Country = context only (link). Data = growth, inflation, unemployment directions (rising growth and inflation,
  //   falling unemployment lean bullish). Markets = 1-month move rank (top 3 / bottom 3). Expectations = the bank's
  //   lean against my call. Positioning = COT: crowded my way is a risk, positioned against me is room.
  const FUNNEL = ['Country', 'Economic data', 'Markets', 'Expectations', 'Positioning'];
  const layerReads = (code) => {
    const r = card.currencies[code], s = callSign(r);
    const d = { rising: 1, falling: -1 }, dataSum = (d[r.growth.dir] || 0) + (d[r.inflation.dir] || 0) - (d[r.labour.dir] || 0);
    const dataKnown = r.growth.dir || r.inflation.dir || r.labour.dir;
    const rank = r.rank1m ?? liveRank(code), mk = rank == null ? null : rank <= 3 ? 1 : rank >= 6 ? -1 : 0;
    const lean = { hawkish: 1, dovish: -1, neutral: 0 }[r.lean];
    const cot = cotFor(code), pc = PC[code];
    const against = pc && s ? posPair(pc).some((g) => (s > 0 ? g.index <= 20 : g.index >= 80)) : false;
    const vs = (v) => (v == null || !s ? 'flat' : v === 0 ? 'flat' : Math.sign(v) === s ? 'bull' : 'bear');
    return [
      { tone: 'flat', text: `<a href="countries.html#${code}">profile →</a>` },
      { tone: dataKnown ? vs(Math.sign(dataSum)) : 'flat', text: !dataKnown ? 'not filled' : dataSum > 0 ? 'data leans stronger' : dataSum < 0 ? 'data leans weaker' : 'data mixed' },
      { tone: vs(mk), text: rank == null ? 'no price yet' : `ranked ${rank} of 8 over a month` },
      { tone: vs(lean), text: lean == null ? 'bank lean not set' : `bank ${r.lean}${s ? ` vs ${s > 0 ? 'too little' : 'too much'} priced` : ''}` },
      { tone: !s || !pc ? 'flat' : cot?.yes ? 'warn' : against ? 'bull' : 'flat', text: !pc ? 'no COT data' : !s ? 'make a call' : cot?.yes ? 'crowded my way: late' : against ? 'positioned against me: room' : 'no extreme' },
    ];
  };
  const funnelBlock = (code) => {
    const reads = layerReads(code), s = callSign(card.currencies[code]);
    const lined = reads.slice(1).filter((x) => x.tone === 'bull').length, opposed = reads.slice(1).filter((x) => x.tone === 'bear').length;
    return `<div class="sc-funnel">${pbFunnel(FUNNEL.map((name) => ({ name })), { tones: reads.map((x) => x.tone), compact: true, links: false })}
      <ol class="fn-reads">${reads.map((x, i) => `<li><span class="fn-dot ${x.tone}"></span><b>${FUNNEL[i]}</b> <span class="small muted">${x.text}</span></li>`).join('')}</ol>
      <div class="small fn-sum">${s ? `<b>${lined} of 4</b> layers line up with my call${opposed ? `, <span class="down">${opposed} against</span>` : ''}` : '<span class="faint">Make a call to see which layers line up.</span>'}</div></div>`;
  };

  // My view comes from the Countries page (data/views.json): the entry in force this week, with its age.
  // Older cards whose sentence was typed here still show it.
  const viewBlock = (code) => {
    const v = viewFor(views, code, monday), old = card.currencies[code].sentence;
    const link = `<a class="small" href="countries.html#${code}">${v || old ? 'edit on Countries →' : 'Write one on Countries →'}</a>`;
    const meta = v ? `<span class="pill ${v.date < monday ? 'warn' : 'flat'}">written ${esc(fmtDate(v.date))} · ${viewAge(v.date)}</span>` : old ? '<span class="pill flat">written on the scorecard</span>' : '<span class="faint">No view written.</span>';
    return `<div class="sc-view"><div class="sc-view-head"><span class="sc-view-label">My view</span> ${meta} ${link}</div>${v || old ? `<p class="sc-view-text">${esc(v ? v.text : old)}</p>` : ''}</div>`;
  };

  const rowPanel = (code) => {
    const r = card.currencies[code];
    return `<section class="panel sc-row" data-ccy="${code}">
      <div class="panel-head"><h2><span class="ccy">${code}</span></h2><span data-score>${scoreHtml(code)}</span></div>
      <div data-funnel>${funnelBlock(code)}</div>
      <div data-evidence>${evidence(code)}</div>
      ${cotBlock(code)}
      <div class="form-grid">
        ${pick('Growth level', 'growth.level', same(SC_LEVELS), r.growth.level)}${pick('Growth direction', 'growth.dir', same(SC_DIRS), r.growth.dir)}
        ${pick('Inflation level', 'inflation.level', same(SC_LEVELS), r.inflation.level)}${pick('Inflation direction', 'inflation.dir', same(SC_DIRS), r.inflation.dir)}
        ${pick('Unemployment level', 'labour.level', same(SC_LEVELS), r.labour.level)}${pick('Unemployment direction', 'labour.dir', same(SC_DIRS), r.labour.dir)}
        ${pick('Bank leans', 'lean', same(SC_LEANS), r.lean)}${num(r.rank1m == null && liveRank(code) != null ? '1-month move rank (live, 1 = strongest)' : '1-month move rank (1 = strongest)', 'rank1m', r.rank1m ?? liveRank(code), 'min="1" max="8" step="1" title="From the desk\'s own live prices unless you type another; stored when you save"')}
        <div class="full">${viewBlock(code)}</div>
        ${num('Priced 12m (bp)', 'priced12m', r.priced12m)}${num("Week's change (bp)", 'weekChange', r.weekChange)}
        ${pick('My call', 'call', Object.entries(SC_CALLS), r.call, 'wide')}
        <label class="check"><input type="checkbox" data-f="strong" ${r.strong ? 'checked' : ''}> Strong</label>
        <label class="check"><input type="checkbox" data-f="crowded" ${r.crowded ? 'checked' : ''}> COT crowded my way</label>
        <div class="full" data-cothint>${cotHint(code)}</div>
      </div></section>`;
  };

  // Regime dial (MMH 04/05): every currency placed from its own fields on this card. Dimmed = not in this build.
  const DIRV = { rising: 1, steady: 0, falling: -1 }, LEVV = { high: 1, normal: 0, low: -1 };
  const regimePanel = () => {
    const rows = CCYS.map((c) => ({ c, r: card.currencies[c] })).filter(({ r }) => r.growth.dir || r.inflation.dir);
    if (!rows.length) return '';
    const momentum = regimeDialSvg(rows.filter(({ r }) => r.growth.dir && r.inflation.dir).map(({ c, r }) => ({ code: c, x: DIRV[r.growth.dir] ?? 0, y: DIRV[r.inflation.dir] ?? 0, dim: !card.active.includes(c) })),
      { title: 'Growth momentum by inflation momentum', xLabels: ['growth slowing', 'growth rising'], yLabels: ['inflation falling', 'inflation rising'], quads: ['Stagflation', 'Reflation', 'Deflationary slowdown', 'Goldilocks'] });
    const level = regimeDialSvg(rows.filter(({ r }) => r.inflation.level && r.inflation.dir).map(({ c, r }) => ({ code: c, x: DIRV[r.inflation.dir] ?? 0, y: LEVV[r.inflation.level] ?? 0, dim: !card.active.includes(c) })),
      { title: 'Inflation level by direction', xLabels: ['falling', 'rising'], yLabels: ['level low', 'level high'], quads: ['Disinflation', 'Overheat', 'Deflation scare', 'Reflation'] });
    return `<section class="panel" style="margin-bottom:14px"><div class="panel-head"><h2>Regime dial</h2><a href="playbook.html#pb-quadrant">Playbook →</a></div>
      <div class="rd-grid"><div><div class="small muted">Growth momentum × inflation momentum</div>${momentum}
        <ul class="small muted rd-keys"><li><b>Goldilocks</b>: equities and credit lead, duration fine, volatility sold</li><li><b>Reflation / overheat</b>: commodities and commodity FX lead, bonds suffer</li><li><b>Stagflation</b>: gold and energy hold, stocks and bonds both struggle</li><li><b>Deflationary slowdown</b>: long bonds and havens lead</li></ul></div>
      <div><div class="small muted">Inflation level × direction</div>${level}
        <ul class="small muted rd-keys"><li><b>Disinflation from a peak</b>: duration rallies, quality equities lead (2023)</li><li><b>Overheat</b>: commodities and cash lead, stock-bond hedge fails (2022)</li><li><b>Deflation scare</b>: long bonds and gold lead (2008, 2020)</li><li><b>Reflation</b>: cyclicals, value, commodity FX lead</li></ul></div></div>
      <p class="small faint">Placed from this card's growth and inflation fields (steady sits on the middle line). Tendencies from the course, not laws. Dimmed currencies are not in this build.</p></section>`;
  };
  // Pages in the book (MMH 10): independent reasons for a pair. One page is a guess, five a book.
  const dataLean = (c) => { const r = card.currencies[c]; return (DIRV[r.growth.dir] || 0) + (DIRV[r.inflation.dir] || 0) - (DIRV[r.labour.dir] || 0); };
  const leanOf = (c) => ({ hawkish: 1, dovish: -1 }[card.currencies[c].lean] || 0);
  const pagesOf = (p) => {
    const b = p.pair.slice(0, 3), q = p.pair.slice(3), s = p.dir === 'LONG' ? 1 : -1;
    const pr = prices?.pairs?.[p.pair], tr = drv?.pairs?.pairs?.[p.pair], ps = pos ? posPairState(PC, p.pair, p.dir) : null;
    const wkEnd = new Date(Date.parse(monday + 'T12:00:00Z') + 5 * 864e5).toISOString().slice(0, 10);
    const ev = card.events.filter((e) => (e.currency === b || e.currency === q) && e.date >= monday && e.date <= wkEnd);
    return [
      { name: 'Data', ok: (dataLean(b) - dataLean(q)) * s > 0, why: `data lean ${b} ${dataLean(b)} vs ${q} ${dataLean(q)}` },
      { name: 'Banks', ok: (leanOf(b) - leanOf(q)) * s > 0, why: `${card.currencies[b].lean || '?'} vs ${card.currencies[q].lean || '?'}` },
      { name: 'Price', ok: pr ? pr.m1Pct * s > 0 : false, why: pr ? `1 month ${sgn(pr.m1Pct)}%` : 'no price' },
      { name: 'Trend', ok: tr ? (tr.trend === 'up') === (s > 0) : false, why: tr ? tr.regime : 'no trend data' },
      { name: 'Positioning', ok: ps ? ps.against && !ps.mine : false, bad: ps?.mine, why: !ps ? 'no COT' : ps.mine ? 'crowded my way' : ps.against ? 'positioned against me: room' : 'no extreme' },
      { name: 'Catalyst', ok: ev.length > 0, why: ev.length ? ev.map((e) => e.event).join(', ') : 'no event written this week' },
    ];
  };
  const pagesHtml = (p) => {
    const pg = pagesOf(p), n = pg.filter((x) => x.ok).length;
    return `<div class="pages"><b class="small">${n} of ${pg.length} pages</b> ${pg.map((x) => `<span class="page ${x.ok ? 'on' : x.bad ? 'bad' : ''}" title="${esc(x.name)}: ${esc(x.why)}">${esc(x.name)}</span>`).join('')}</div>`;
  };

  const rankBody = () => {
    const scored = card.active.map((code) => ({ code, net: scScore(card.currencies[code]) })).filter((c) => c.net != null);
    const pairs = scPairs(card), chosen = new Set(card.pairs.map((p) => p.pair));
    return `<div class="grid sc-grid">
      <div>${scored.length >= 2 ? strengthBars(scored) : '<div class="empty">Make a call on at least two currencies.</div>'}</div>
      <div>${pairs.length ? `<ul class="list">${pairs.map((p) => `<li><label class="check"><input type="checkbox" data-act="pair" data-pair="${p.pair}" ${chosen.has(p.pair) ? 'checked' : ''}></label>
          <span class="grow"><b>${p.pair}</b> <span class="pill ${p.dir === 'LONG' ? 'bull' : 'bear'}">${p.dir}</span> <span class="small muted">gap ${p.diff}</span>
            ${pos ? `<div class="pos-pairline">${posPairBar(PC, p.pair)} ${posPairVerdict(PC, p.pair, p.dir)}</div>` : ''}${pagesHtml(p)}</span>
          ${p.top ? '<span class="pill warn">top vs bottom</span>' : ''}</li>`).join('')}</ul>` : '<div class="empty">No pairs yet: two currencies need different scores.</div>'}
        ${card.pairs.length > 3 ? '<div class="note" style="margin:10px 0 0">More than three pairs. The routine says two or three.</div>' : ''}</div>
    </div>`;
  };

  const eventsPanel = () => `<section class="panel" style="margin-top:14px"><div class="panel-head"><h2>Week ahead: events and if / then</h2></div>
    <div class="table-wrap"><table><thead><tr><th>Date</th><th>Ccy</th><th>Event</th><th>If / then</th><th title="Print against consensus, for the currency (beat = better for it). The price reaction is read from the desk's closes.">Reaction</th><th></th></tr></thead>
    <tbody>${[...card.events].sort((a, b) => (a.date < b.date ? -1 : 1)).map((e) => { const done = e.date <= ymd(), r = done ? reactionOf(e) : null; return `<tr>
      <td class="small nowrap">${fmtDate(e.date)}</td><td><span class="ccy">${esc(e.currency)}</span></td><td>${esc(e.event)}</td><td class="small">${esc(e.ifThen)}</td>
      <td class="small">${done ? `<select data-act="rx" data-id="${esc(e.id)}"><option value="">print?</option>${Object.entries(RX_PRINT).map(([k, l]) => `<option value="${k}" ${e.reaction?.print === k ? 'selected' : ''}>${l}</option>`).join('')}</select> ${rxCell(r)}<div>${rxMove(r)}</div>` : '<span class="faint">after the release</span>'}</td>
      <td><button class="link-btn" data-act="del-event" data-id="${esc(e.id)}">Delete</button></td></tr>`; }).join('') || '<tr><td colspan="6" class="empty">No events yet.</td></tr>'}</tbody></table></div>
    <p class="small faint" style="margin:6px 0 0">Reaction: pick how the print landed against consensus for the currency (Market Context shows it). The desk reads how the currency moved against the other seven that day, in σ of a normal day, whether it held, and the next three days. Contradictions are the signal; the Review page tallies them.</p>
    <div class="form-grid" style="margin-top:12px">
      <label>Date<input type="date" id="ev-date"></label>
      <label>Currency<select id="ev-ccy">${card.active.map((c) => `<option>${c}</option>`).join('')}</select></label>
      <label class="wide">Event<input id="ev-event" placeholder="e.g. US CPI"></label>
      <label class="wide">If / then<textarea id="ev-ifthen" rows="2" placeholder="If the print is above __, pricing moves __, the pair should __"></textarea></label>
    </div>
    <div class="form-actions"><button class="btn" data-act="add-event">+ Add event</button></div></section>`;

  // Shown twice: in the page head (always in reach on a long page) and after the events. Ctrl+S saves too.
  const saveBar = (top = false) => `<div class="form-actions" style="${top ? 'margin:0' : 'margin-top:14px'}">
    <button class="btn primary" data-act="save" title="Ctrl+S">${localMode() ? 'Save (local test)' : ghToken.get() ? 'Save to GitHub' : 'Save (connect GitHub first)'}</button>
    ${dirty ? '<span class="pill warn">unsaved changes</span>' : ''}${card.updated && !top ? `<span class="small faint">last saved ${fmtDate(card.updated)}</span>` : ''}</div>`;
  const say = (html) => { msg = html; $('#sc-msg').innerHTML = html ? `<div class="note">${html}</div>` : ''; };

  const draw = () => {
    prune();
    const weeks = [...new Set([monday, ...index.weeks.map((w) => w.monday)])].sort().reverse();
    const saved = new Set(index.weeks.map((w) => w.monday));
    const picker = `<select id="sc-week">${weeks.map((m) => `<option value="${m}" ${m === monday ? 'selected' : ''}>Week of ${fmtDate(m)}${saved.has(m) ? '' : ' (new)'}</option>`).join('')}</select>`;
    main.innerHTML = head(`Scorecard · week of ${fmtDate(monday)}`, 'Weekly build. First my own read of each economy, then what is priced, then rank and pair. Only the gap pays.',
      `<div class="form-actions" style="margin:0;align-items:center">${picker}<span id="sc-save-top">${saveBar(true)}</span></div>`) +
      `<div id="sc-msg">${msg ? `<div class="note">${msg}</div>` : ''}</div>` +
      (canSave() ? '' : connectPanel()) +
      (card.autoFill ? `<div class="note"><b>Data fields filled from ${esc(card.autoFill.source)}</b>, read ${new Date(card.autoFill.readAt).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}, for ${esc((card.autoFill.currencies || []).join(', '))}.
        Level and direction for inflation, growth and unemployment, and the bank's lean, are ${esc(card.autoFill.source)}'s own labels, copied as they stood. Check them, then make the call yourself. My view of each economy is written on Countries.${(card.autoFill.missing || []).length ? ` <span class="warn-t">Not filled: ${esc(card.autoFill.missing.join('; '))}.</span>` : ''}</div>` : '') +
      `<div class="filters"><span class="small muted">Currencies in this build</span>${CCYS.map((c) => `<button class="chip ${card.active.includes(c) ? 'on' : ''}" data-act="toggle" data-ccy="${c}">${c}</button>`).join('')}</div>
      ${posMap()}${regimePanel()}<div class="grid sc-grid">${card.active.map(rowPanel).join('')}</div>
      <section class="panel" style="margin-top:14px"><div class="panel-head"><h2>Rank and pairs</h2></div><div id="sc-rank">${rankBody()}</div></section>` +
      eventsPanel() + `<div id="sc-save">${saveBar()}</div>`;
  };
  // After a field changes: scores, ranking and the save bar update in place, so typing focus is never lost.
  const refresh = () => {
    applyCot();
    prune();
    main.querySelectorAll('.sc-row').forEach((el) => {
      const code = el.dataset.ccy;
      $('[data-score]', el).innerHTML = scoreHtml(code); $('[data-evidence]', el).innerHTML = evidence(code);
      $('[data-f="crowded"]', el).checked = !!card.currencies[code].crowded;
      const hint = $('[data-cothint]', el); if (hint) hint.innerHTML = cotHint(code);
      $('[data-funnel]', el).innerHTML = funnelBlock(code);
    });
    $('#sc-rank').innerHTML = rankBody();
    $('#sc-save').innerHTML = saveBar();
    $('#sc-save-top').innerHTML = saveBar(true);
  };

  main.addEventListener('input', (ev) => {
    const el = ev.target.closest('.sc-row [data-f]'); if (!el) return;
    const row = card.currencies[el.closest('.sc-row').dataset.ccy], path = el.dataset.f.split('.');
    const v = el.type === 'checkbox' ? el.checked : el.type === 'number' ? (el.value === '' ? null : Number(el.value)) : el.value;
    if (path.length === 2) row[path[0]][path[1]] = v; else row[path[0]] = v;
    if (el.dataset.f === 'crowded') row.crowdedBy = 'me';
    dirty = true; refresh();
  });
  main.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.id === 'sc-week') {
      if (dirty && !confirm('Leave this week without saving?')) { t.value = monday; return; }
      dirty = false; location.search = `?week=${t.value}`;
    } else if (t.dataset.act === 'rx') {
      const e = card.events.find((x) => x.id === t.dataset.id);
      if (e) { if (t.value) e.reaction = { print: t.value }; else delete e.reaction; }
      dirty = true; draw();
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
      await save();
    }
  });
  const save = async () => {
    {
      if (!canSave()) { say('<span class="error">Connect GitHub first (Kill Switches page), or use local test mode.</span>'); return; }
      say('Saving…');
      try {
        prune();
        for (const c of card.active) if (card.currencies[c].rank1m == null && liveRank(c) != null) card.currencies[c].rank1m = liveRank(c);
        card.updated = new Date().toISOString().slice(0, 10);
        const res = await ghUpdate(`scorecard-${monday}`, () => card, `Scorecard: week of ${monday} (desk)`);
        const entry = { monday, pairs: card.pairs.map(({ pair, dir }) => ({ pair, dir })), scores: Object.fromEntries(card.active.map((c) => [c, scScore(card.currencies[c])]).filter(([, s]) => s != null)) };
        const idx = await ghUpdate('scorecard-index', (d) => { const i = d || { weeks: [] }; i.weeks = [entry, ...i.weeks.filter((w) => w.monday !== monday)].sort((a, b) => (a.monday < b.monday ? 1 : -1)); return i; }, `Scorecard index: week of ${monday} (desk)`);
        index = idx.data; dirty = false;
        msg = res.commit === 'local' ? 'Saved in this browser (local test mode). Nothing was committed.' : `Saved to GitHub (commit ${esc(res.commit || '')}).`;
      } catch (e) { msg = `<span class="error">${esc(e.message)}</span>`; }
      draw();
    }
  };
  document.addEventListener('keydown', (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's') { ev.preventDefault(); if (dirty) save(); }
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
  const [ideasData, pos] = await Promise.all([loadLive('ideas', true), loadLive('positioning', true).catch(() => null)]);
  let data = ideasData || { ideas: [] };
  const TONE = { open: 'warn', kept: 'bull', dropped: 'flat' };
  // Once an idea is researched, how capital is positioned in its markets shows under it, open, as cards.
  const positioning = (i) => (!i.research || !pos ? '' : `<details class="idea-pos" open><summary>Positioning · COT of ${esc(fmtDate(pos.cotDate))} <a class="small" href="positioning.html">all →</a></summary>${posIdeaCards(pos, i)}
    <p class="small faint" style="margin:4px 0 0">● asset managers (slow) · ◆ leveraged funds / managed money (fast) · hollow = 4 weeks ago · shaded ends = crowded.</p></details>`);
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

  // Research written by the idea-researcher agent (scripts/idea-research.mjs). Evidence and a suggestion; the
  // decision stays Nathan's, so it is read-only here and survives his edits of the idea.
  const VTONE = { holds: 'bull', breaks: 'bear', unclear: 'flat' }, STONE = { keep: 'bull', drop: 'bear', watch: 'warn' };
  const ul = (xs) => (xs || []).length ? `<ul>${xs.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '<span class="faint">none</span>';
  const research = (r) => !r ? '' : `<details class="research"><summary>Research ${esc(fmtDate(r.researchedAt))} · suggests <span class="pill ${STONE[r.suggest] || 'flat'}">${esc(r.suggest)}</span></summary>
    <p class="thesis"><b>Thesis.</b> ${esc(r.thesis)}</p>
    <p class="small muted">${(r.instruments || []).map((t) => `<code>${esc(t)}</code>`).join(' ')}${r.horizon ? ` · horizon ${esc(r.horizon)}` : ''}</p>
    <dl><dt>Claims</dt><dd><ul>${(r.claims || []).map((c) => `<li><span class="pill ${VTONE[c.verdict] || 'flat'}">${esc(c.verdict)}</span> ${esc(c.claim)}<div class="small muted">${esc(c.evidence)}${c.source ? ` <span class="faint">(${esc(c.source)})</span>` : ''}</div></li>`).join('')}</ul></dd>
    <dt>Priced</dt><dd>${esc(r.priced)}</dd>
    <dt>Confirms</dt><dd>${ul(r.confirm)}</dd>
    <dt>Kills</dt><dd>${ul(r.kill)}</dd>
    <dt>My routine</dt><dd>${esc(r.routineFit)}</dd>
    <dt>Watch</dt><dd>${(r.watch || []).length ? `<ul>${r.watch.map((w) => `<li>${esc(w.what)} <span class="faint">${esc(w.when)}</span></li>`).join('')}</ul>` : '<span class="faint">none</span>'}</dd>
    <dt>Why</dt><dd>${esc(r.why)}</dd>
    <dt>Sources</dt><dd class="small">${(r.sources || []).map((s) => s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title || s.url)}</a>` : esc(s.title)).join(' · ')}</dd></dl></details>`;

  const draw = () => {
    const cur = editing === 'new' ? {} : data.ideas.find((i) => i.id === editing);
    const list = data.ideas.filter((i) => filter === 'all' || i.status === filter).sort((a, b) => (a.date < b.date ? 1 : -1));
    const count = (s) => data.ideas.filter((i) => s === 'all' || i.status === s).length;
    main.innerHTML = head('Ideas', 'Things I pick up from podcasts, videos and calls, in my own words. Open until I have checked them; then kept or dropped.',
        '<button class="btn primary" data-act="new">+ New idea</button>') +
      (msg ? `<div class="note">${msg}</div>` : '') + (canSave() ? '' : connectPanel()) + (cur ? form(cur) : '') +
      `<div class="filters">${['all', 'open', 'kept', 'dropped'].map((s) => `<button class="chip ${filter === s ? 'on' : ''}" data-act="filter" data-s="${s}">${s} ${count(s)}</button>`).join('')}</div>
      <section class="panel"><ul class="list">${list.map((i) => `<li><span class="small nowrap muted">${fmtDate(i.date)}</span>
        <span class="grow">${esc(i.text)}<div class="small faint">${esc(i.source || '')}</div>${positioning(i)}${research(i.research)}</span>
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

// ---------- positioning (how capital is positioned in my currencies, pairs and ideas) ----------
// Read-only. scripts/desk-positioning.mjs writes data/positioning.json in CI from CFTC COT (TFF for FX and
// financials, disaggregated for commodities) and Japan's MoF weekly flows. Every number is an index: where a
// group's net sits in its own three-year range. Tags follow fixed rules shown at the foot of the page, so the
// page reports positioning and never makes a call.
const POS_TAG = {
  'crowded-long': ['crowded long', 'warn'], 'crowded-short': ['crowded short', 'warn'],
  'unwinding-long': ['longs unwinding', 'bear'], 'unwinding-short': ['shorts covering', 'bull'],
  'building-long': ['building long', 'bull'], 'building-short': ['building short', 'bear'], neutral: ['no extreme', 'flat'],
};
// Words in an idea that point at a market on this page. Uranium has no CFTC futures, so it is named, not matched.
const POS_IDEA_MARKETS = [
  [/\bgold\b|xau|precious/i, ['GOLD']], [/silver|xag/i, ['SILVER']], [/copper/i, ['COPPER']], [/platinum/i, ['PLATINUM']],
  [/\boil\b|crude|\bwti\b|brent|opec/i, ['WTI', 'BRENT']], [/natural gas|nat ?gas|\blng\b/i, ['NATGAS']],
  [/nasdaq|\bndx\b|\bnq\b|nvidia|nvda|semis|\bsmh\b|\bsox\b|\bai\b|tech/i, ['NDX']], [/s&p|\bspx\b|\bes\b|equities|stocks/i, ['SPX']],
  [/\bvix\b|volatility/i, ['VIX']], [/treasur|\b10y\b|10-year|yields?\b/i, ['UST10']], [/\b2y\b|2-year/i, ['UST2']],
];
const POS_NO_MARKET = [[/uranium|\bura\b|urnm|cameco|\bccj\b/i, 'Uranium: no regulated futures positioning is published.']];
const POS_CCY_WORDS = [[/dollar|greenback|\bdxy\b/i, 'USD'], [/\byen\b/i, 'JPY'], [/\beuro\b/i, 'EUR'], [/sterling|\bpound\b/i, 'GBP'], [/\bfranc\b/i, 'CHF'], [/loonie/i, 'CAD'], [/aussie/i, 'AUD'], [/\bkiwi\b/i, 'NZD']];

function posLinks(idea) {
  const text = [idea.text, ...(idea.research?.instruments || [])].join(' \n ');
  const markets = new Set(), ccys = new Set(), pairs = new Set(), none = [];
  for (const [re, keys] of POS_IDEA_MARKETS) if (re.test(text)) keys.forEach((k) => markets.add(k));
  for (const [re, msg] of POS_NO_MARKET) if (re.test(text)) none.push(msg);
  for (const [re, c] of POS_CCY_WORDS) if (re.test(text)) ccys.add(c);
  for (const m of text.matchAll(/\b(USD|EUR|GBP|JPY|CHF|CAD|AUD|NZD)(USD|EUR|GBP|JPY|CHF|CAD|AUD|NZD)?\b/g)) {
    ccys.add(m[1]); if (m[2]) { ccys.add(m[2]); pairs.add(m[1] + m[2]); }
  }
  return { markets: [...markets], ccys: [...ccys], pairs: [...pairs], none };
}

// ---- shared positioning visuals (Positioning, Scorecard, Ideas) ----
const posGrp = (x, role) => x?.groups?.find((g) => g.role === role) || null;
const posTagPill = (t) => (t && POS_TAG[t] ? `<span class="pill ${POS_TAG[t][1]}">${POS_TAG[t][0]}</span>` : '');
const POS_ROLE = { slow: { shape: 'circle', color: 'var(--pos-slow)' }, fast: { shape: 'diamond', color: 'var(--pos-fast)' } };
// Who is slow and who is fast differs by report: TFF has asset managers, commodities only managed money (fast).
const posPair = (x) => [posGrp(x, 'slow'), posGrp(x, 'fast')].filter(Boolean);
const posMarker = (role, x, y, r, attrs = '') => (POS_ROLE[role].shape === 'circle'
  ? `<circle cx="${x}" cy="${y}" r="${r}" ${attrs}/>`
  : `<rect x="${x - r * 0.8}" y="${y - r * 0.8}" width="${r * 1.6}" height="${r * 1.6}" transform="rotate(45 ${x} ${y})" ${attrs}/>`);

// Gauge: where each group sits in its 3-year range today (solid marker) and 4 weeks ago (hollow), with the move between.
// The two ends are the crowded zones.
function posGauge(x, { compact = false } = {}) {
  const groups = posPair(x);
  if (!groups.length) return '<span class="faint small">no positioning data</span>';
  const W = 300, L = 12, R = 288, X = (v) => L + ((R - L) * v) / 100, ty = compact ? 20 : 24, H = compact ? 34 : 50;
  const lbl = [];
  const body = groups.map((g) => {
    const c = POS_ROLE[g.role].color, now = X(g.index);
    const was = g.index4w == null ? null : X(g.index4w);
    const trail = was != null && Math.abs(now - was) > 3
      ? `<line x1="${was}" y1="${ty}" x2="${now}" y2="${ty}" stroke="${c}" stroke-width="2.5" stroke-opacity="0.45" stroke-linecap="round"/>${posMarker(g.role, was, ty, 4, `fill="var(--panel)" stroke="${c}" stroke-opacity="0.6" stroke-width="1.5"`)}` : '';
    lbl.push({ x: now, v: g.index, c });
    return trail + posMarker(g.role, now, ty, 6, `fill="${c}" stroke="var(--bg)" stroke-width="1.5"`);
  }).join('');
  // Number labels above the markers; nudge apart when the two sit close together.
  lbl.sort((a, b) => a.x - b.x);
  if (lbl.length === 2 && lbl[1].x - lbl[0].x < 22) { lbl[0].x -= 11; lbl[1].x += 11; }
  const labels = lbl.map((l) => `<text x="${Math.min(R, Math.max(L, l.x))}" y="${ty - 10}" text-anchor="middle" class="g-num" fill="${l.c}">${l.v}</text>`).join('');
  const scale = compact ? '' : `<text x="${L}" y="${H - 3}" class="g-axis">0 short</text><text x="${X(20)}" y="${H - 3}" text-anchor="middle" class="g-axis">20</text>
    <text x="${X(50)}" y="${H - 3}" text-anchor="middle" class="g-axis">3-year range</text><text x="${X(80)}" y="${H - 3}" text-anchor="middle" class="g-axis">80</text><text x="${R}" y="${H - 3}" text-anchor="end" class="g-axis">long 100</text>`;
  const title = groups.map((g) => `${g.name} ${g.index}${g.index4w != null ? ` (4 weeks ago ${g.index4w})` : ''}`).join('; ');
  return `<svg class="pos-gauge" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title>
    <rect x="${L}" y="${ty - 4}" width="${R - L}" height="8" rx="4" fill="var(--panel-2)" stroke="var(--line)"/>
    <rect x="${L}" y="${ty - 4}" width="${X(20) - L}" height="8" rx="4" fill="var(--warn-bg)"/><rect x="${X(80)}" y="${ty - 4}" width="${R - X(80)}" height="8" rx="4" fill="var(--warn-bg)"/>
    <line x1="${X(50)}" x2="${X(50)}" y1="${ty - 6}" y2="${ty + 6}" stroke="var(--faint)"/>${body}${labels}${scale}</svg>`;
}

// 26-week trend of each group's index, crowded zones shaded.
function posTrend(x) {
  const groups = posPair(x).filter((g) => (g.spark || []).length > 1);
  if (!groups.length) return '';
  const W = 300, H = 74, T = 6, B = 62, Y = (v) => B - ((B - T) * v) / 100;
  const lines = groups.map((g) => {
    const n = g.spark.length, X = (i) => 4 + ((W - 8) * i) / (n - 1);
    const pts = g.spark.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
    return `<polyline fill="none" stroke="${POS_ROLE[g.role].color}" stroke-width="2" stroke-linejoin="round" points="${pts}"/>${posMarker(g.role, X(n - 1), Y(g.spark[n - 1]), 4, `fill="${POS_ROLE[g.role].color}"`)}`;
  }).join('');
  return `<svg class="pos-trend" viewBox="0 0 ${W} ${H}" role="img" aria-label="Positioning index over the last 26 weeks"><title>Last 26 weeks</title>
    <rect x="0" y="${Y(100)}" width="${W}" height="${Y(80) - Y(100)}" fill="var(--warn-bg)"/><rect x="0" y="${Y(20)}" width="${W}" height="${Y(0) - Y(20)}" fill="var(--warn-bg)"/>
    <line x1="0" x2="${W}" y1="${Y(50)}" y2="${Y(50)}" stroke="var(--line)" stroke-dasharray="3 3"/>${lines}
    <text x="2" y="${H - 1}" class="g-axis">26 weeks ago</text><text x="${W - 2}" y="${H - 1}" text-anchor="end" class="g-axis">now</text></svg>`;
}
const posLegend = (x) => posPair(x).map((g) => `<span class="pos-key"><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">${posMarker(g.role, 6, 6, 4.5, `fill="${POS_ROLE[g.role].color}"`)}</svg>${esc(g.name)} <b class="num">${g.index}</b> ${posTagPill(g.tag)}</span>`).join('');
const posSqueeze = (x) => (x?.squeeze ? `<div class="small warn-t">Squeeze risk: ${esc(x.squeeze)}</div>` : '');
// One card per currency or market: name, gauge, trend, legend.
const posCard = (title, x, sub = '') => `<div class="pos-card"><div class="pos-card-head"><b>${title}</b>${sub ? ` <span class="small faint">${sub}</span>` : ''}</div>
  ${posGauge(x)}${posTrend(x)}<div class="pos-legend">${posLegend(x)}</div>${posSqueeze(x)}</div>`;

// Pair read: base against quote, for one trader group. Positive gap = that group is longer the base than the quote.
const posPairRead = (C, pair, role) => {
  const b = posGrp(C[pair.slice(0, 3)], role), q = posGrp(C[pair.slice(3)], role);
  return b && q ? { b, q, gap: b.index - q.index } : null;
};
// Crowded my way: the group already sits at an extreme in my direction on either leg. Against me: the opposite.
function posPairVerdict(C, pair, dir) {
  const s = dir === 'LONG' ? 1 : -1, out = [];
  for (const role of ['slow', 'fast']) {
    const r = posPairRead(C, pair, role); if (!r) continue;
    const name = role === 'slow' ? 'asset managers' : 'leveraged funds';
    const mine = (s > 0 ? r.b.index >= 80 || r.q.index <= 20 : r.b.index <= 20 || r.q.index >= 80);
    const against = (s > 0 ? r.b.index <= 20 || r.q.index >= 80 : r.b.index >= 80 || r.q.index <= 20);
    if (mine) out.push(`<span class="pill warn">${name} crowded my way</span>`);
    else if (against) out.push(`<span class="pill flat">${name} positioned against me</span>`);
  }
  return out.join(' ') || '<span class="pill flat">no extreme either side</span>';
}
// Same rule as a yes/no per pair: any group crowded my way, any group positioned against me.
function posPairState(C, pair, dir) {
  const s = dir === 'LONG' ? 1 : -1; let mine = false, against = false;
  for (const role of ['slow', 'fast']) {
    const r = posPairRead(C, pair, role); if (!r) continue;
    if (s > 0 ? r.b.index >= 80 || r.q.index <= 20 : r.b.index <= 20 || r.q.index >= 80) mine = true;
    else if (s > 0 ? r.b.index <= 20 || r.q.index >= 80 : r.b.index >= 80 || r.q.index <= 20) against = true;
  }
  return { mine, against };
}
// Pair as a tug of war: base leg's index against the quote leg's, per group. Bar runs from the centre toward the
// leg that group favours.
function posPairBar(C, pair) {
  const rows = ['slow', 'fast'].map((role) => ({ role, r: posPairRead(C, pair, role) })).filter((x) => x.r);
  if (!rows.length) return '';
  const W = 160, M = W / 2, rh = 11;
  const bars = rows.map(({ role, r }, i) => {
    const w = (Math.abs(r.gap) / 100) * (M - 4), y = 2 + i * (rh + 3), c = POS_ROLE[role].color;
    return `<rect x="${r.gap >= 0 ? M : M - w}" y="${y}" width="${Math.max(w, 1.5)}" height="${rh}" rx="2" fill="${c}" fill-opacity="0.85"/>`;
  }).join('');
  const h = rows.length * (rh + 3) + 1;
  const t = rows.map(({ role, r }) => `${role === 'slow' ? 'Asset managers' : 'Leveraged funds'}: ${pair.slice(0, 3)} ${r.b.index} vs ${pair.slice(3)} ${r.q.index}`).join('; ');
  return `<svg class="pos-pairbar" width="${W}" height="${h}" viewBox="0 0 ${W} ${h}" role="img" aria-label="${esc(t)}"><title>${esc(t)}</title>
    <line x1="${M}" x2="${M}" y1="0" y2="${h}" stroke="var(--faint)"/>${bars}</svg>`;
}
// The markets and currencies an idea touches, as positioning cards. Shared by the Positioning and Ideas pages.
function posIdeaCards(pos, idea) {
  const C = pos.currencies || {}, M = Object.fromEntries((pos.markets || []).map((m) => [m.key, m]));
  const L = posLinks(idea);
  const cards = [
    ...L.markets.map((k) => M[k]).filter(Boolean).map((m) => posCard(esc(m.label), m, esc(m.group))),
    ...L.ccys.filter((c) => C[c]).map((c) => posCard(`<span class="ccy">${c}</span>`, C[c], C[c].derived ? 'derived' : '')),
  ];
  const pairs = L.pairs.filter((p) => posPairRead(C, p, 'slow')).map((p) => `<div class="pos-pairline"><b>${p}</b> ${posPairBar(C, p)} <span class="small faint">right of the line: favours ${p.slice(0, 3)}</span></div>`).join('');
  const none = L.none.map((n) => `<p class="small faint">${esc(n)}</p>`).join('');
  if (!cards.length && !pairs && !none) return '<p class="small faint">No market or currency on the Positioning page matches this idea\'s words. Name the market or currency in the idea to link it.</p>';
  return `${cards.length ? `<div class="pos-grid">${cards.join('')}</div>` : ''}${pairs}${none}`;
}

// Does positioning agree with "crowded my way" for a currency call? +1 = I see it underpriced (bullish), -1 = overpriced.
function posCrowdedMyWay(x, callSign) {
  if (!x || !callSign) return null;
  const hits = posPair(x).filter((g) => (callSign > 0 ? g.index >= 80 : g.index <= 20));
  return { yes: hits.length > 0, why: hits.map((g) => `${g.name} ${g.index}`).join(', ') };
}

render.positioning = async (main) => {
  const [pos, ideas, index] = await Promise.all([loadLive('positioning', true), loadLive('ideas', true), loadLive('scorecard-index', true)]);
  if (!pos) { main.innerHTML = head('Positioning', '') + '<section class="panel"><div class="empty">No positioning file yet. It is written by <code>scripts/desk-positioning.mjs</code> in the daily CI run.</div></section>'; return; }
  const C = pos.currencies || {};
  const grp = posGrp;
  const ageDays = Math.round((Date.now() - Date.parse(pos.cotDate + 'T12:00:00Z')) / 864e5);

  const sqz = posSqueeze;
  const pairRead = (pair, role) => posPairRead(C, pair, role);
  const pairVerdict = (pair, dir) => posPairVerdict(C, pair, dir);
  const gapCell = (r) => (!r ? '<td class="faint">—</td>' : `<td class="nowrap num ${r.gap >= 40 ? 'up' : r.gap <= -40 ? 'down' : 'muted'}">${sign(r.gap)}<div class="small faint">${r.b.index} vs ${r.q.index}</div></td>`);

  // ---- my pairs ----
  const week = (index?.weeks || []).find((w) => (w.pairs || []).length);
  const myPairs = week?.pairs || [];
  const pairsPanel = panel(week ? `My pairs, week of ${fmtDate(week.monday)}` : 'My pairs', myPairs.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Pair</th><th>Base vs quote</th><th>Asset managers</th><th>Leveraged funds</th><th>Against my direction</th></tr></thead>
      <tbody>${myPairs.map((p) => `<tr><td class="nowrap"><b>${esc(p.pair)}</b> <span class="pill ${p.dir === 'LONG' ? 'bull' : 'bear'}">${esc(p.dir)}</span></td><td>${posPairBar(C, p.pair)}</td>
        ${gapCell(pairRead(p.pair, 'slow'))}${gapCell(pairRead(p.pair, 'fast'))}<td>${pairVerdict(p.pair, p.dir)}${sqz(C[p.pair.slice(0, 3)])}${sqz(C[p.pair.slice(3)])}</td></tr>`).join('')}</tbody></table></div>`
    : '<div class="empty">No pairs confirmed on a scorecard yet. Once a week has pairs, they show here against positioning. All 28 pairs are below.</div>',
    { href: 'scorecard.html', label: 'Scorecard' });

  // ---- currencies: one card each, longest asset-manager positioning first ----
  const ccyRows = CCYS.filter((c) => C[c]).sort((a, b) => (grp(C[b], 'slow')?.index ?? 0) - (grp(C[a], 'slow')?.index ?? 0));
  const dealerLine = (x) => { const d = grp(x, 'hedging'); return d ? `<div class="small faint">Dealers ${d.index} (hedging, not a view)</div>` : ''; };
  const ccyPanel = panel('Currencies', `<div class="pos-grid">${ccyRows.map((c) => posCard(`<span class="ccy">${c}</span>`, C[c], C[c].derived ? 'derived from the seven' : '').replace(/<\/div>$/, `${dealerLine(C[c])}</div>`)).join('')}</div>
    <p class="small faint">● asset managers (slow, real money) · ◆ leveraged funds (fast money). Hollow marker: 4 weeks ago. Shaded ends: crowded. USD has no futures contract of its own in the COT data: its line is the dollar side of the seven currency futures, converted to dollars at each week's close.</p>`);

  // ---- JPY flows: diverging bars, last 4 weeks, coloured by what they do to the yen ----
  const jf = pos.jpyFlows;
  const jpyBars = () => {
    const max = Math.max(...jf.lines.map((l) => Math.abs(l.sum4w)), 1), W = 300, M = W / 2;
    return jf.lines.map((l) => {
      const effect = Math.sign(l.sum4w) * l.jpy, w = (Math.abs(l.sum4w) / max) * (M - 10);
      const col = effect > 0 ? 'var(--bull)' : effect < 0 ? 'var(--bear)' : 'var(--flat)';
      return `<div class="jpy-row"><div class="small">${esc(l.label)} <span class="faint">· week ${sign(l.week)}</span></div>
        <svg viewBox="0 0 ${W} 18" class="jpy-bar" role="img" aria-label="${esc(l.label)}: ${sign(l.sum4w)} bn over 4 weeks"><line x1="${M}" x2="${M}" y1="0" y2="18" stroke="var(--faint)"/>
        <rect x="${l.sum4w >= 0 ? M : M - w}" y="3" width="${Math.max(w, 1.5)}" height="12" rx="2" fill="${col}"/>
        <text x="${l.sum4w >= 0 ? M - 4 : M + 4}" y="13" text-anchor="${l.sum4w >= 0 ? 'end' : 'start'}" class="g-num" fill="var(--muted)">${sign(l.sum4w)}</text></svg>
        <span class="pill ${effect > 0 ? 'bull' : effect < 0 ? 'bear' : 'flat'}">${effect > 0 ? 'JPY inflow' : effect < 0 ? 'JPY outflow' : 'flat'}</span> <span class="small faint">4-week total sits at ${l.index} of its 3-year range</span></div>`;
    }).join('');
  };
  const jpyPanel = !jf ? '' : panel(`JPY: Japan's real-money flows, 4 weeks to ${fmtDate(jf.weekEnding)}`, `${jpyBars()}
    <p class="small faint">${esc(jf.source)}. ${esc(jf.unit)}. Bars left of the line are net selling, right net buying. Published Thursdays. Japanese buying abroad sells yen unless hedged; foreigners buying Japan buys yen unless hedged.</p>`);

  // ---- ideas: a card per linked market and currency ----
  const openIdeas = (ideas?.ideas || []).filter((i) => i.status !== 'dropped').sort((a, b) => (a.date < b.date ? 1 : -1));
  const ideaBlock = (i) => `<details class="research pos-idea" open><summary>${esc(i.text.split('\n')[0].slice(0, 110))} <span class="faint small">${esc(fmtDate(i.date))} · ${esc(i.status)}</span></summary>${posIdeaCards(pos, i)}</details>`;
  const ideasPanel = panel('My ideas', openIdeas.map(ideaBlock).join('') || '<div class="empty">No open ideas.</div>', { href: 'ideas.html', label: 'Ideas' });

  // ---- all pairs: tug-of-war bars ----
  const allPairs = ALL_PAIRS.map((p) => ({ p, s: pairRead(p, 'slow'), f: pairRead(p, 'fast') })).filter((r) => r.s).sort((a, b) => Math.abs(b.s.gap) - Math.abs(a.s.gap));
  const allPanel = panel('All 28 pairs', `<details class="research"><summary>Sorted by how far apart asset managers are on the two legs. Bar right of the line: that group favours the base currency.</summary><div class="table-wrap"><table>
      <thead><tr><th>Pair</th><th>Base vs quote</th><th>Asset managers</th><th>Leveraged funds</th><th>Squeeze risk on a leg</th></tr></thead>
      <tbody>${allPairs.map((r) => `<tr><td><b>${r.p}</b></td><td>${posPairBar(C, r.p)}</td>${gapCell(r.s)}${gapCell(r.f)}<td class="small">${[r.p.slice(0, 3), r.p.slice(3)].filter((c) => C[c]?.squeeze).map((c) => `${c}: ${esc(C[c].squeeze)}`).join('<br>') || '<span class="faint">none</span>'}</td></tr>`).join('')}</tbody></table></div></details>`);

  // ---- all markets: cards grouped by kind ----
  const kinds = [...new Set((pos.markets || []).map((m) => m.group))];
  const marketsPanel = panel('Markets', kinds.map((k) => `<div class="small muted pos-kind">${esc(k)}</div><div class="pos-grid">${(pos.markets || []).filter((m) => m.group === k).map((m) => posCard(esc(m.label), m, m.report === 'disagg' ? 'managed money only: commodities have no asset-manager split' : '')).join('')}</div>`).join(''));

  main.innerHTML = head('Positioning', `How capital is positioned in my currencies, my pairs and the markets my ideas touch. CFTC report of ${esc(fmtDate(pos.cotDate))} (Tuesday snapshot, released the Friday after). Each number is where that group's net position sits in its own ${pos.lookbackYears}-year range: 0 is the shortest it has been, 100 the longest.`,
      `<span class="pill ${ageDays > 11 ? 'warn' : 'flat'}">COT ${ageDays} days old</span>`) +
    ((pos.warns || []).length ? `<div class="note small">Data warnings: ${pos.warns.map(esc).join(' · ')}</div>` : '') +
    pairsPanel + ccyPanel + ideasPanel + jpyPanel + allPanel + marketsPanel +
    `<section class="panel"><div class="panel-head"><h2>How to read it</h2></div><ul class="small muted">
      <li><b>Crowded</b>: index 80 or higher (long) or 20 or lower (short). Crowded is not a signal on its own: extremes can last months.</li>
      <li><b>Longs unwinding / shorts covering</b>: was at an extreme in the last 8 weeks and has come back 15+ points. This is when crowding starts to move price.</li>
      <li><b>Building</b>: moved 20+ points in 4 weeks without reaching an extreme: fresh positioning.</li>
      <li><b>Squeeze risk</b>: fast money at one extreme (25 or lower, or 75 or higher) while real money sits at the other.</li>
      <li><b>Hedging groups</b> (dealers, producers, swap dealers) take the other side of flow by obligation. Their extremes mark size, not a crowd, so they carry no tag.</li>
      <li>For commodities the disaggregated report is used; for currencies and financials the TFF report. Legacy "commercials" are never used for currencies: they mix dealer hedging with real money.</li>
      <li>Not here: CME daily open interest (CME blocks automated access) and retail sentiment (no open source found).</li>
    </ul></section>`;
};

// ---------- shared charts ----------
// Line chart for [[date, value], ...]. extra: more series drawn on the same scale. hlines: reference lines.
function lineSvg(data, { w = 300, h = 90, color = 'var(--accent)', extra = [], hlines = [], bands = [], min = null, max = null, label = '' } = {}) {
  const all = [data, ...extra.map((e) => e.data)].flat().map((x) => x[1]).filter((v) => v != null && Number.isFinite(v));
  if (all.length < 2) return '<span class="faint small">no data</span>';
  const lo = min ?? Math.min(...all, ...hlines.map((l) => l.v)), hi = max ?? Math.max(...all, ...hlines.map((l) => l.v));
  const axis = h >= 50, pad = (hi - lo) * 0.08 || 1, L = lo - pad, U = hi + pad, T = 4, B = axis ? h - 12 : h - 3;
  const n = Math.max(data.length, ...extra.map((e) => e.offset ? e.offset + e.data.length : e.data.length));
  const Y = (v) => B - ((v - L) / (U - L)) * (B - T), X = (i) => 2 + ((w - 4) * i) / Math.max(1, n - 1);
  const path = (d, off = 0) => d.map((p, i) => (p[1] == null ? null : `${X(i + off).toFixed(1)},${Y(p[1]).toFixed(1)}`)).filter(Boolean).join(' ');
  const bandSvg = bands.map((b) => `<rect x="0" y="${Y(Math.min(U, b.to))}" width="${w}" height="${Math.max(0, Y(Math.max(L, b.from)) - Y(Math.min(U, b.to)))}" fill="${b.fill || 'var(--warn-bg)'}"/>`).join('');
  const hl = hlines.map((l) => `<line x1="0" x2="${w}" y1="${Y(l.v)}" y2="${Y(l.v)}" stroke="${l.color || 'var(--faint)'}" stroke-dasharray="${l.dash || '3 3'}"/>${l.label ? `<text x="${l.anchor === 'start' ? 4 : w - 2}" y="${Y(l.v) - 3}" text-anchor="${l.anchor === 'start' ? 'start' : 'end'}" class="g-axis">${esc(l.label)}</text>` : ''}`).join('');
  const lines = extra.map((e) => `<polyline fill="none" stroke="${e.color}" stroke-width="${e.width || 1.6}" ${e.dash ? `stroke-dasharray="${e.dash}"` : ''} points="${path(e.data, e.offset || 0)}"/>`).join('');
  const lastPt = data.filter((p) => p[1] != null).at(-1);
  return `<svg class="line-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}">${bandSvg}${hl}<polyline fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" points="${path(data)}"/>${lines}
    ${lastPt ? `<circle cx="${X(data.lastIndexOf(lastPt))}" cy="${Y(lastPt[1])}" r="3" fill="${color}"/>` : ''}
    ${axis ? `<text x="2" y="${h - 1}" class="g-axis">${esc(String(data[0]?.[0] || '').slice(0, 7))}</text><text x="${w - 2}" y="${h - 1}" text-anchor="end" class="g-axis">${esc(String(lastPt?.[0] || '').slice(0, 10))}</text>` : ''}</svg>`;
}
const pctileBar = (p, { goodHigh = null } = {}) => `<span class="idx" title="Where today sits in its 1-year range: ${p} of 100"><span class="idx-track"><span class="idx-mark" style="left:${p}%"></span></span><b class="num small">${p}</b></span>`;
const sgn = (n, d = 2) => (n == null ? '—' : `${n > 0 ? '+' : ''}${Number(n).toFixed(d)}`);

// ---------- release-to-reaction (MMH 00.7) ----------
// How a currency's basket (against the other seven) moved on an event day, read from the desk's own closes.
// Market Context already shows the print against consensus; this adds the half it does not: the price reaction.
const RX_PRINT = { beat: 'Beat', inline: 'In line', miss: 'Miss' }, RX_PRICE = { up: 'Up', flat: 'Flat', down: 'Down' };
function reactionOf(e) {
  const H = prices?.history, dates = H?.dates || [];
  if (!H || !CCYS.includes(e.currency)) return null;
  const i = dates.indexOf(e.date);
  if (i < 21) return { pending: dates.length && e.date > dates[dates.length - 1] ? 'after the last close' : 'outside the price history' };
  const hv = (c, k) => (c === 'USD' ? 1 : H.usd[c][k]);
  const basket = (k) => { const o = CCYS.filter((x) => x !== e.currency); return o.reduce((s, x) => s + ((hv(e.currency, k) / hv(x, k)) / (hv(e.currency, k - 1) / hv(x, k - 1)) - 1) * 100, 0) / o.length; };
  const move = basket(i), typ = Array.from({ length: 20 }, (_, j) => Math.abs(basket(i - 1 - j))).reduce((a, b) => a + b, 0) / 20;
  const price = move > 0.5 * typ ? 'up' : move < -0.5 * typ ? 'down' : 'flat';
  const N = dates.length, s = Math.sign(move) || 1;
  const held = i + 1 < N ? basket(i + 1) * s > -0.5 * Math.abs(move) : null;
  let follow3 = null;
  if (i + 1 < N) { let acc = 0; for (let k = i + 1; k <= Math.min(i + 3, N - 1); k++) acc += basket(k); follow3 = acc * s; }
  const p = e.reaction?.print;
  const tone = !p ? null : price === 'flat' ? (p === 'inline' ? 'textbook' : 'absorbed') : p === 'inline' ? 'else' : (p === 'beat') === (price === 'up') ? 'textbook' : 'signal';
  return { move, sigma: move / typ, price, held, follow3, tone };
}
const RX_TONE = { textbook: ['textbook', 'flat'], absorbed: ['absorbed: already priced', 'warn'], signal: ['contradiction: signal', 'bear'], else: ['moved on an in-line print: something else priced', 'warn'] };
const rxCell = (r) => (r?.tone ? `<span class="pill ${RX_TONE[r.tone][1]}">${RX_TONE[r.tone][0]}</span>` : '');
const rxMove = (r) => (!r ? '' : r.pending ? `<span class="small faint">${esc(r.pending)}</span>` : `<span class="small">${RX_PRICE[r.price]} ${pctHtml(r.move)} <span class="faint">(${sgn(r.sigma, 1)}σ)</span>${r.held == null ? '' : r.held ? ' · held next day' : ' · <span class="warn-t">given back next day</span>'}${r.follow3 == null ? '' : ` · next 3 days ${r.follow3 >= 0 ? 'continued' : 'reversed'} ${Math.abs(r.follow3).toFixed(2)}%`}</span>`);

// ---------- attribution (MMH 01 FX I, 01.4 FX V) ----------
// Each currency (row) against each other (column). Down against everything = its own story; down against one = the other side's.
function attributionHtml(key = 'wtdPct') {
  if (!prices) return '<div class="empty">No prices yet.</div>';
  const mv = (b, q) => { const p = prices.pairs[b + q]; if (p) return p[key]; const r = prices.pairs[q + b]; return r ? (1 / (1 + r[key] / 100) - 1) * 100 : 0; };
  const order = [...CCYS].sort((a, b) => prices.currencies[b][key] - prices.currencies[a][key]);
  const max = Math.max(0.2, ...order.flatMap((b) => order.filter((q) => q !== b).map((q) => Math.abs(mv(b, q)))));
  const cell = (v) => { const a = Math.min(1, Math.abs(v) / max); return `background:${v >= 0 ? `rgba(52,195,122,${(0.12 + a * 0.6).toFixed(2)})` : `rgba(240,96,106,${(0.12 + a * 0.6).toFixed(2)})`}`; };
  const story = (c) => { const o = order.filter((x) => x !== c).map((x) => mv(c, x)), up = o.filter((v) => v > 0).length; return up >= 6 ? `<span class="pill bull">${c} story: up vs ${up} of 7</span>` : up <= 1 ? `<span class="pill bear">${c} story: down vs ${7 - up} of 7</span>` : `<span class="pill flat">mixed ${up} up / ${7 - up} down</span>`; };
  return `<div class="table-wrap"><table class="attr"><thead><tr><th></th>${order.map((c) => `<th>${c}</th>`).join('')}<th>Read</th></tr></thead>
    <tbody>${order.map((b) => `<tr><th class="ccy">${b}</th>${order.map((q) => (b === q ? '<td class="attr-self"></td>' : `<td style="${cell(mv(b, q))}" title="${b}${q}: ${sgn(mv(b, q))}%">${sgn(mv(b, q), 2)}</td>`)).join('')}<td>${story(b)}</td></tr>`).join('')}</tbody></table></div>
    <p class="small faint">Row currency against column currency, in %. A row that is green across the board is that currency's own story; a single red or green column is the other side's story.</p>`;
}

// ---------- regime dial (MMH 04 Growth, 05 Inflation) ----------
// Plots each currency from the Scorecard's own fields. Growth momentum x inflation momentum, and inflation level x direction.
function regimeDialSvg(points, { xLabels, yLabels, quads, title }) {
  const W = 320, H = 260, M = 30, cx = W / 2, cy = H / 2;
  const seen = {};
  const dots = points.map((p) => {
    const key = `${p.x},${p.y}`, k = (seen[key] = (seen[key] || 0) + 1) - 1;
    const ang = k * 1.1, rad = k ? 14 + k * 3 : 0;
    const x = cx + p.x * (W / 2 - M) * 0.52 + Math.cos(ang) * rad, y = cy - p.y * (H / 2 - M) * 0.5 + Math.sin(ang) * rad;
    return `<g class="rd-dot ${p.dim ? 'dim' : ''}"><circle cx="${x}" cy="${y}" r="13" fill="${p.color || 'var(--panel-2)'}" stroke="var(--accent)"/><text x="${x}" y="${y + 4}" text-anchor="middle" class="rd-txt">${p.code}</text></g>`;
  }).join('');
  const q = (x, y, t, a) => `<text x="${x}" y="${y}" text-anchor="${a}" class="rd-q">${esc(t)}</text>`;
  return `<svg class="rd" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">
    <rect x="${M}" y="${M - 10}" width="${W - 2 * M}" height="${H - 2 * M + 10}" rx="10" fill="none" stroke="var(--line)"/>
    <line x1="${cx}" x2="${cx}" y1="${M - 10}" y2="${H - M}" stroke="var(--line)"/><line x1="${M}" x2="${W - M}" y1="${cy}" y2="${cy}" stroke="var(--line)"/>
    ${q(M + 6, M + 6, quads[0], 'start')}${q(W - M - 6, M + 6, quads[1], 'end')}${q(M + 6, H - M - 6, quads[2], 'start')}${q(W - M - 6, H - M - 6, quads[3], 'end')}
    <text x="${M}" y="${H - 8}" class="g-axis">◀ ${esc(xLabels[0])}</text><text x="${W - M}" y="${H - 8}" text-anchor="end" class="g-axis">${esc(xLabels[1])} ▶</text>
    <text x="${cx}" y="${M - 14}" text-anchor="middle" class="g-axis">▲ ${esc(yLabels[1])}</text><text x="${cx}" y="${H - 18}" text-anchor="middle" class="g-axis" dy="-2"> </text>
    ${dots}<text x="${cx}" y="${H - 20}" text-anchor="middle" class="g-axis">▼ ${esc(yLabels[0])}</text></svg>`;
}

// ---------- drivers (cross-asset readings Market Context does not carry) ----------
// From data/drivers.json (scripts/desk-drivers.mjs, daily in CI). Each panel follows one course module and reports,
// it never calls a direction.
// ---------- who is driving (correlations.json, scripts/correlations.mjs) ----------
// A link is "in control" while its 20-day correlation, read in its usual direction, is 0.5 or more; it lets go
// below 0.3. The 3-day reading (hourly bars) warns first. Measured, never a call.
const CORR_GROUPS = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD', 'Gold', 'Bitcoin'];
const RG_TONE = { 'risk-on': 'rg-on', 'risk-off': 'bear', caution: 'warn', mixed: 'warn' };
const corrSign = (typical) => (typical === 'inverse' ? -1 : 1);
const fmtR = (r) => (r == null ? '—' : (r > 0 ? '+' : '') + r.toFixed(2));

// Track from -1 to +1: normal band shaded, the "in control" zone tinted, today's reading as a dot.
function corrDial(x, typical, label) {
  const W = 150, H = 40, L = 8, R = W - 8, X = (v) => L + ((R - L) * (v + 1)) / 2, y = 22;
  if (!x) return `<div class="cd"><svg viewBox="0 0 ${W} ${H}" class="cd-svg"><rect x="${L}" y="${y - 3}" width="${R - L}" height="6" rx="3" fill="var(--panel-2)" stroke="var(--line)"/><text x="${W / 2}" y="${y - 7}" text-anchor="middle" class="g-axis">no hourly data</text></svg><div class="cd-l">${esc(label)}</div></div>`;
  const s = corrSign(typical), a = x.r == null ? null : x.r * s;
  const col = a == null ? 'var(--faint)' : a >= 0.5 ? 'var(--accent)' : a >= 0.3 ? 'var(--muted)' : 'var(--faint)';
  const zone = s > 0 ? [X(0.5), X(1)] : [X(-1), X(-0.5)];
  const band = x.normal ? `<rect x="${X(x.normal.p10)}" y="${y - 5}" width="${Math.max(2, X(x.normal.p90) - X(x.normal.p10))}" height="10" rx="3" fill="var(--flat-bg)" stroke="var(--faint)" stroke-dasharray="2 2"/>` : '';
  const dot = x.r == null ? `<text x="${W / 2}" y="${y - 7}" text-anchor="middle" class="g-axis">not enough data${x.n != null ? ` (${x.n})` : ''}</text>`
    : `<circle cx="${X(x.r)}" cy="${y}" r="5.5" fill="${col}" stroke="var(--bg)" stroke-width="1.5"/><text x="${Math.min(R - 10, Math.max(L + 10, X(x.r)))}" y="${y - 9}" text-anchor="middle" class="g-num" fill="${col}">${fmtR(x.r)}</text>`;
  const tip = `${label}: ${fmtR(x.r)}${x.normal ? `; normal ${fmtR(x.normal.p10)} to ${fmtR(x.normal.p90)}, middle ${fmtR(x.normal.p50)}` : ''}${x.n != null ? `; ${x.n} hourly moves` : ''}`;
  return `<div class="cd"><svg viewBox="0 0 ${W} ${H}" class="cd-svg" role="img" aria-label="${esc(tip)}"><title>${esc(tip)}</title>
    <rect x="${L}" y="${y - 3}" width="${R - L}" height="6" rx="3" fill="var(--panel-2)" stroke="var(--line)"/>
    <rect x="${zone[0]}" y="${y - 3}" width="${zone[1] - zone[0]}" height="6" rx="3" fill="var(--accent)" fill-opacity="0.18"/>
    ${band}<line x1="${X(0)}" x2="${X(0)}" y1="${y - 7}" y2="${y + 7}" stroke="var(--faint)"/>${dot}
    <text x="${L}" y="${H - 1}" class="g-axis">-1</text><text x="${R}" y="${H - 1}" text-anchor="end" class="g-axis">+1</text></svg>
    <div class="cd-l">${esc(label)}${x.n != null && x.r != null ? ` <span class="faint">· ${x.n} moves</span>` : ''}</div></div>`;
}

function regimeBanner(rg) {
  if (!rg?.gauges) return '';
  const arrow = (v) => (v == null ? '·' : v > 0 ? '▲' : v < 0 ? '▼' : '▶');
  const readTone = { on: 'rg-on', off: 'bear', neutral: 'flat', 'no data': 'flat' };
  const readTxt = { on: 'risk-on', off: 'risk-off', neutral: 'neutral', 'no data': 'no data' };
  const gauges = rg.gauges.map((g) => `<div class="rg-g" title="${esc(g.why)}. Reads risk-on when it ${g.risingIsOn ? 'rises' : 'falls'}.">
      <div class="small"><b>${esc(g.label)}</b></div>
      <div>${lineSvg(g.spark, { h: 30, w: 140, color: g.read === 'off' ? 'var(--bear)' : g.read === 'on' ? 'var(--accent)' : 'var(--muted)', label: g.label })}</div>
      <div class="small"><span class="num">${arrow(g.chg20)} ${g.chg20 == null ? '—' : sgn(g.chg20, g.unit === 'pt' ? 2 : 1) + (g.unit === 'pt' ? 'pt' : '%')}</span> <span class="faint">20d</span> <span class="pill ${readTone[g.read] || 'flat'}">${readTxt[g.read] || g.read}</span></div></div>`).join('');
  const agreeTxt = { yes: 'Yes: both reads agree.', partly: 'Partly: one read is mixed or cautious. Size down.', no: 'No: they disagree. Trust neither, size down.' };
  return panel('Market regime', `<div class="rg-top">
      <div><label class="rg-k">VIX rule</label><span class="pill ${RG_TONE[rg.vix.rule] || 'flat'}">${esc(rg.vix.rule || '—')}</span>
        <div class="small muted">VIX ${rg.vix.value} · S&amp;P ${rg.vix.spx} vs 200-day ${rg.vix.spx200}</div></div>
      <div><label class="rg-k">Barometer</label><span class="pill ${RG_TONE[rg.verdict] || 'flat'}">${esc(rg.verdict)}</span>
        <div class="small muted">${rg.gauges.filter((g) => g.read === 'on').length} risk-on · ${rg.gauges.filter((g) => g.read === 'off').length} risk-off</div></div>
      <div><label class="rg-k">Do they agree?</label><b>${esc(agreeTxt[rg.agree] || '—')}</b></div>
      <div><label class="rg-k">US rates</label><b>${esc(rg.rates.split || '—')}</b><div class="small muted">2Y ${sgn(rg.rates.chg63bp, 0)}bp in 3 months</div></div>
      <div><label class="rg-k">Dollar</label><b>${esc(rg.dollar.split || '—')}</b><div class="small muted">DXY ${sgn(rg.dollar.chg63pct, 1)}% in 3 months</div></div></div>
    <div class="rg-gauges">${gauges}</div>
    <p class="small faint">Your Macro Tracker method: VIX below 18 with the S&amp;P above its 200-day = risk-on, above 30 = risk-off, else caution. The barometer counts five gauges on their 20-day change and needs a lead of two. As of ${esc(fmtDate(rg.asOf))}.</p>`);
}

function linkRow(l) {
  const name = `<b>${esc(l.labelD)}</b> <span class="faint">→</span> <b>${esc(l.labelT)}</b>`;
  if (l.level) {
    const v = l.level;
    return `<div class="lk lk-level"><div class="lk-name">${name}<div class="small muted">${esc(l.story)}</div></div>
      <div class="lk-lv">${lineSvg(v.history, { h: 40, w: 300, label: 'GDT price index, last two years' })}</div>
      <div class="lk-st"><span class="num">${v.value}</span> <span class="small">${sgn(v.chg3mPct, 1)}% in 3 months</span><div class="small faint">GDT price index · auction ${esc(fmtDate(v.asOf))} · every two weeks, so no correlation windows</div></div></div>`;
  }
  if (l.status) return `<div class="lk lk-missing"><div class="lk-name">${name}<div class="small muted">${esc(l.story)}</div></div><div class="small faint">No data: ${esc(l.reason || 'source unavailable today')}.</div></div>`;
  const inCtl = l.state === 'in';
  const state = `<span class="pill ${inCtl ? 'rg-on' : 'flat'}">${inCtl ? 'in control' : 'not in control'}</span>${l.breaking ? ' <span class="pill warn" title="Still in control on 20 days, but the last 3 days fell below their normal range">breaking</span>' : ''}${l.wrongWay ? ' <span class="pill flat" title="20-day correlation runs the opposite way to normal">wrong way</span>' : ''}
    <div class="small faint">since ${esc(fmtDate(l.since))}</div>`;
  return `<div class="lk" data-link="${esc(l.id)}" role="button" tabindex="0" aria-expanded="false">
    <div class="lk-name">${name}<div class="small muted">${esc(l.story)}</div></div>
    <div class="lk-dials">${corrDial(l.r3d, l.typical, '3 days')}${corrDial(l.r20, l.typical, '20 days')}${corrDial(l.r60, l.typical, '60 days')}</div>
    <div class="lk-st">${state}</div></div><div class="lk-dive" data-dive="${esc(l.id)}" hidden></div>`;
}

const DIM_ROWS = { vix: ['risk-on', 'caution', 'risk-off'], rates: ['rising', 'flat', 'falling'], dollar: ['strengthening', 'flat', 'weakening'] };
const DIM_LABEL = { vix: 'VIX rule', rates: 'US rates', dollar: 'Dollar' };
function linkDeepDive(l, rg, card) {
  const s = corrSign(l.typical), lines = [0.5, 0.3].map((v) => ({ v: v * s, label: v === 0.5 ? 'in control' : 'lets go', dash: v === 0.5 ? '4 3' : '1 3' }));
  const n = l.r60.normal, band = n ? [{ from: n.p10, to: n.p90, fill: 'var(--flat-bg)' }] : [];
  const perUnit = l.kindD === 'yield' ? '10bp' : '1%';
  const move = (b) => (b == null ? '—' : `${sgn(l.kindD === 'yield' ? b * 10 : b, 2)}%`);
  const nowKey = { vix: rg?.vix?.rule, rates: rg?.rates?.split, dollar: rg?.dollar?.split };
  const tbl = Object.keys(DIM_ROWS).map((dim) => DIM_ROWS[dim].filter((k) => l.byRegime?.[dim]?.[k]).map((k, i) => {
    const c = l.byRegime[dim][k];
    return `<tr class="${nowKey[dim] === k ? 'rg-now' : ''}">${i === 0 ? `<td rowspan="${DIM_ROWS[dim].filter((x) => l.byRegime?.[dim]?.[x]).length}"><b>${DIM_LABEL[dim]}</b></td>` : ''}<td>${esc(k)}${nowKey[dim] === k ? ' <span class="pill rg-on">now</span>' : ''}</td><td class="num">${fmtR(c.r60)}</td><td class="num">${move(c.beta)}</td><td class="num">${Math.round(c.shareIn * 100)}%</td><td class="num faint">${c.n}</td></tr>`;
  }).join('')).join('');
  const changes = (l.history.changes || []).slice(-6).reverse().map(([d, st]) => `<li><span class="grow">${st === 'in' ? 'Took control' : 'Let go'}</span><span class="small muted">${esc(fmtDate(d))} ${d.slice(0, 4)}</span></li>`).join('');
  const ccy = CCYS.includes(l.group) ? l.group : null, row = ccy ? card?.currencies?.[ccy] : null;
  const dir = (k) => { const own = row?.[k]?.dir, auto = row?.auto?.[k]?.dir; return own ? esc(own) : auto ? `${esc(auto)} <span class="faint">(Market Context)</span>` : '—'; };
  const econ = ccy ? `<div class="small"><b>${ccy} economy now</b> (Scorecard, week of ${esc(fmtDate(card?.monday || ''))}): growth ${dir('growth')}, inflation ${dir('inflation')}. <a href="countries.html#${ccy}">${ccy} on Countries →</a></div>` : '';
  return `<div class="dive">
    <p class="small">${esc(l.story)} Usually ${l.typical === 'inverse' ? 'opposite' : 'together'}. Right now a ${perUnit} move in ${esc(l.labelD)} goes with a <b>${move(l.beta60)}</b> move in ${esc(l.labelT)} (60 days).</p>
    ${econ}
    <div class="drv-2"><div><div class="pc-h">5 years: 60-day (bold) and 20-day correlation</div>
      ${lineSvg(l.history.weekly.map(([d, r60]) => [d, r60]), { h: 120, min: -1, max: 1, bands: band, hlines: [{ v: 0 }, ...lines], extra: [{ data: l.history.weekly.map(([d, , r20]) => [d, r20]), color: 'var(--faint)', width: 1 }], label: '60-day correlation, 5 years' })}
      <div class="small faint">Shaded: its normal 60-day range (10th to 90th percentile). Dashed: in control at ${fmtR(0.5 * s)}, lets go at ${fmtR(0.3 * s)}.</div></div>
    <div><div class="pc-h">Last 6 months: 20-day correlation</div>
      ${lineSvg(l.history.daily, { h: 120, min: -1, max: 1, hlines: [{ v: 0 }, ...lines], label: '20-day correlation, 6 months' })}
      <ul class="list">${changes || '<li class="small faint">No change of state in 5 years.</li>'}</ul></div></div>
    <div class="pc-h">How it behaves by market (5 years of daily readings)</div>
    <div class="table-wrap"><table><thead><tr><th>Split</th><th>Market</th><th>Typical 60-day r</th><th>Move per ${perUnit}</th><th>Days in control</th><th>Days</th></tr></thead><tbody>${tbl}</tbody></table></div>
    <p class="small faint">${esc(l.labelT)} as of ${esc(l.asOfT)}, ${esc(l.labelD)} as of ${esc(l.asOfD)} · ${l.obs} shared daily moves${l.r3d ? ` · 3-day reading from ${l.r3d.n} hourly moves` : ''}.</p></div>`;
}

function whoIsDriving(c, card) {
  if (!c?.links) return '';
  const groups = CORR_GROUPS.map((g) => {
    const ls = c.links.filter((l) => l.group === g);
    if (!ls.length) return '';
    const on = ls.filter((l) => l.state === 'in').length;
    return `<div class="lk-group"><div class="lk-gh"><span class="ccy">${esc(g)}</span> <span class="small faint">${on} of ${ls.filter((l) => l.state).length} in control</span></div>${ls.map(linkRow).join('')}</div>`;
  }).join('');
  const warn = [...(c.missing || []), ...(c.errors || []).filter((e) => !/ 2Y: /.test(e))];
  return panel('Who is driving', `<div class="pos-legend"><span class="pos-key"><svg width="22" height="10"><rect x="1" y="2" width="20" height="6" rx="3" fill="var(--flat-bg)" stroke="var(--faint)" stroke-dasharray="2 2"/></svg>its normal range</span><span class="pos-key"><svg width="22" height="10"><rect x="1" y="2" width="20" height="6" rx="3" fill="var(--accent)" fill-opacity="0.25"/></svg>in-control zone</span><span class="pos-key">Click a link for its history and how it behaves by market.</span></div>
    ${groups}
    ${warn.length ? `<p class="small faint">Missing: ${warn.map(esc).join(' · ')}.</p>` : ''}
    <p class="small faint">${esc(c.method)} Updated ${esc(fmtDate(c.asOf))}.</p>`);
}

render.drivers = async (main) => {
  const [d, pos, corr, index] = await Promise.all([loadLive('drivers'), loadLive('positioning', true).catch(() => null), loadLive('correlations', true).catch(() => null), loadLive('scorecard-index', true).catch(() => null)]);
  const wk = index?.weeks?.[0];
  const card = wk ? await loadLive(`scorecard-${wk.monday}`, true).catch(() => null) : null;
  const tone = (good) => (good == null ? 'flat' : good ? 'bull' : 'bear');
  const chg = (v, unit = '', d = 2) => `<span class="num ${v > 0 ? 'up' : v < 0 ? 'down' : 'muted'}">${sgn(v, d)}${unit}</span>`;

  const liq = d.liquidity;
  const liqPanel = !liq ? '' : panel('Liquidity tide (US)', `<div class="drv-2"><div>
      <div class="kpis"><div><label>Net liquidity</label><span class="num big">$${(liq.netBn / 1000).toFixed(2)}tn</span></div>
        <div><label>4 weeks</label>${chg(liq.chg4wBn, 'bn', 0)}</div><div><label>13 weeks</label>${chg(liq.chg13wBn, 'bn', 0)}</div></div>
      <div class="small muted">Fed assets $${liq.parts.fedBn}bn − Treasury account $${liq.parts.tgaBn}bn − reverse repo $${liq.parts.rrpBn}bn · week of ${esc(fmtDate(liq.asOf))}</div>
      <p class="small">${liq.chg13wBn > 0 ? '<span class="pill bull">tide coming in</span> the far end of the risk curve feels it first' : '<span class="pill bear">tide going out</span> the far end of the risk curve feels it first'}</p></div>
    <div>${lineSvg(liq.history, { label: 'Net liquidity, 2 years', h: 110 })}</div></div>
    <p class="small faint">Module 06: QE and QT are the famous tap, but the Treasury account and reverse repo move the water level too.</p>`);

  const g = d.gold, mm = pos?.markets?.find((m) => m.key === 'GOLD'), mmg = mm ? posGrp(mm, 'fast') : null;
  const goldRow = (n, name, blk, unit, readFn) => !blk ? '' : `<div class="stack-row"><span class="stack-n">${n}</span><div class="stack-name"><b>${name}</b><div class="small faint">${esc(fmtDate(blk.asOf))}</div></div>
    <div class="num">${blk.value}${unit}<div class="small">${chg(blk.chg1w, unit)} 1w · ${chg(blk.chg3m, unit)} 3m</div></div>
    <div>${lineSvg(blk.history, { h: 46, w: 220, label: name })}</div><div>${pctileBar(blk.pctile1y)}<div class="small faint">1-year range</div></div><div>${readFn(blk)}</div></div>`;
  const goldPanel = !g ? '' : panel('Gold: the driver stack, in the course\'s order', `<div class="stack">
      ${goldRow(1, 'Real yields (US 10y TIPS)', g.realYield10y, '%', (b) => `<span class="pill ${tone(b.chg3m < 0)}">${b.chg3m < 0 ? 'falling: tailwind' : 'rising: headwind'}</span>`)}
      ${goldRow(2, 'Dollar (broad index)', g.dollarBroad, '', (b) => `<span class="pill ${tone(b.chg3m < 0)}">${b.chg3m < 0 ? 'weaker: tailwind' : 'stronger: headwind'}</span>`)}
      ${liq ? `<div class="stack-row"><span class="stack-n">3</span><div class="stack-name"><b>Liquidity</b><div class="small faint">net, US</div></div><div class="num">$${(liq.netBn / 1000).toFixed(2)}tn<div class="small">${chg(liq.chg13wBn, 'bn', 0)} 13w</div></div><div>${lineSvg(liq.history.slice(-52), { h: 46, w: 220 })}</div><div></div><div><span class="pill ${tone(liq.chg13wBn > 0)}">${liq.chg13wBn > 0 ? 'expanding: tailwind' : 'draining: headwind'}</span></div></div>` : ''}
      ${mmg ? `<div class="stack-row"><span class="stack-n">4</span><div class="stack-name"><b>Flows: COT managed money</b><div class="small faint">${esc(fmtDate(mm.date))}</div></div><div class="num">${mmg.index}<div class="small">of 100 in 3 years</div></div><div>${posGauge(mm, { compact: true })}</div><div></div><div>${posTagPill(mmg.tag)}</div></div>` : ''}
      ${goldRow(5, 'Stress: VIX', g.vix, '', (b) => `<span class="pill ${b.value > 20 ? 'warn' : 'flat'}">${b.value > 20 ? 'above 20: risk-off' : 'calm'}</span>`)}
      ${goldRow('5b', 'Stress: high-yield spread', g.hySpread, '%', (b) => `<span class="pill ${b.chg3m > 0 ? 'warn' : 'flat'}">${b.chg3m > 0 ? 'widening' : 'tightening'}</span>`)}
      ${goldRow('', 'Gold futures', g.goldFutures, '', () => '')}
    </div><p class="small faint">Module 23: real rates anchor the trend, flows set the tempo, stress events bend the curve. Central-bank buying can override the real-yield link (2022-24).</p>`);

  const cv = d.curve, mats = ['3M', '2Y', '5Y', '10Y', '30Y'];
  const curveShape = () => {
    const W = 300, H = 120, all = mats.flatMap((m) => [cv.yields[m].now, cv.yields[m].m3]), lo = Math.min(...all) - 0.15, hi = Math.max(...all) + 0.15;
    const X = (i) => 20 + (i * (W - 40)) / (mats.length - 1), Y = (v) => H - 18 - ((v - lo) / (hi - lo)) * (H - 30);
    const line = (k, col, dash = '') => `<polyline fill="none" stroke="${col}" stroke-width="2" ${dash ? `stroke-dasharray="${dash}"` : ''} points="${mats.map((m, i) => `${X(i)},${Y(cv.yields[m][k])}`).join(' ')}"/>`;
    return `<svg class="line-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="US yield curve now, 1 month and 3 months ago">${line('m3', 'var(--faint)', '4 3')}${line('m1', 'var(--pos-fast)', '2 2')}${line('now', 'var(--accent)')}
      ${mats.map((m, i) => `<text x="${X(i)}" y="${H - 3}" text-anchor="middle" class="g-axis">${m}</text><text x="${X(i)}" y="${Y(cv.yields[m].now) - 6}" text-anchor="middle" class="g-num" fill="var(--accent)">${cv.yields[m].now}</text>`).join('')}</svg>
      <div class="pos-legend"><span class="pos-key" style="color:var(--accent)">— now</span><span class="pos-key" style="color:var(--pos-fast)">-- 1 month ago</span><span class="pos-key">-- 3 months ago</span></div>`;
  };
  const rgTone = (t) => (/bull/.test(t) ? 'bull' : /bear/.test(t) ? 'bear' : 'flat');
  const curvePanel = !cv ? '' : panel('US yield curve: the four moves', `<div class="drv-2"><div>${curveShape()}</div>
    <div class="table-wrap"><table><thead><tr><th>Curve</th><th>Spread</th><th>1 week</th><th>1 month</th><th>Spread, 1 year</th></tr></thead><tbody>${cv.pairs.map((p) => `<tr><td><b>${p.front}-${p.back}</b></td><td class="num">${p.spreadBp}bp</td>
      <td><span class="pill ${rgTone(p.w1.tag)}">${esc(p.w1.tag)}</span></td><td><span class="pill ${rgTone(p.m1.tag)}">${esc(p.m1.tag)}</span></td><td>${lineSvg(p.history, { h: 36, w: 140, hlines: [{ v: 0 }] })}</td></tr>`).join('')}</tbody></table></div></div>
    <p class="small faint">Modules 03 and 03.1. Bull = yields fell, bear = yields rose; steepener = the long end rose relative to the short end. Different parts of the curve in different regimes at the same time is information.</p>`);

  const gr = d.growth, GROUP = { leading: 'Leading: turns first', coincident: 'Coincident: the pulse now', lagging: 'Lagging: confirms after' };
  const disagree = gr && gr.breadth.leading.weaker > gr.breadth.leading.stronger && gr.breadth.coincident.stronger >= gr.breadth.coincident.weaker;
  const growthPanel = !gr ? '' : panel('US growth: what leads, what lags', `${disagree ? '<div class="note"><b>Leaders weakening while the coincident data still looks fine.</b> The course calls that disagreement the trade: it shows what the market will have to reprice if the leaders are right.</div>' : ''}
    <div class="gr-grid">${Object.entries(GROUP).map(([k, title]) => { const b = gr.breadth[k]; return `<div><div class="pc-h">${title}</div>
      <div class="breadth"><span class="bar-up" style="flex:${b.stronger || 0.001}"></span><span class="bar-dn" style="flex:${b.weaker || 0.001}"></span></div><div class="small muted">${b.stronger} stronger · ${b.weaker} weaker of ${b.n}</div>
      <ul class="list">${gr.series.filter((s) => s.group === k).map((s) => `<li class="gr-row"><div><b class="small">${esc(s.label)}</b><div class="small faint">${s.value}${s.unit ? ' ' + s.unit : ''} · ${sgn(s.chg3m, 2)}${s.chg3mUnit} in 3 months · ${esc(fmtDate(s.asOf))}</div></div><div class="gr-right">${lineSvg(s.history, { h: 30, w: 110 })}<div><span class="pill ${s.read === 'stronger' ? 'bull' : s.read === 'weaker' ? 'bear' : 'flat'}">${s.read}</span> <span class="small faint" title="Is the 3-month change better than the 3 months before?">${s.turning}</span></div></div></li>`).join('')}</ul></div>`; }).join('')}</div>
    <p class="small faint">Module 04: trade the turn, not the level. "Accelerating / decelerating" is the second derivative: bad to less bad is where risk assets historically do best.</p>`);

  const inf = d.inflation;
  const glide = (blk) => {
    const hist = blk.history, labels = Object.keys(blk.paths), cols = ['var(--bear)', 'var(--warn)', 'var(--accent)', 'var(--bull)'];
    const extra = labels.map((k, i) => ({ data: [[hist.at(-1)[0], hist.at(-1)[1]], ...blk.paths[k].map((v, j) => [`+${j + 1}m`, v])], color: cols[i], dash: '4 3', offset: hist.length - 1 }));
    const padded = [...hist, ...Array.from({ length: 6 }, (_, j) => [`+${j + 1}m`, null])];
    return `${lineSvg(padded, { h: 130, extra, hlines: [{ v: inf.target, label: '2% target' }, { v: inf.breakeven5y.value, label: `5y breakeven ${inf.breakeven5y.value}%`, color: 'var(--pos-fast)', anchor: 'start' }], label: `${blk.label} year on year and six-month paths` })}
      <div class="pos-legend">${labels.map((k, i) => `<span class="pos-key"><svg width="14" height="6"><line x1="0" x2="14" y1="3" y2="3" stroke="${cols[i]}" stroke-width="2" stroke-dasharray="4 3"/></svg>${esc(k)}: ${blk.paths[k][5]}%</span>`).join('')}</div>`;
  };
  const infPanel = !inf ? '' : panel('US inflation: the pace, and where it leads', `<div class="drv-2">${[inf.core, inf.headline].map((b) => `<div><div class="kpis"><div><label>${esc(b.label)} y/y</label><span class="num big">${b.yoy}%</span></div><div><label>3-month pace</label><span class="num big ${b.ann3m > b.yoy ? 'warn-t' : ''}">${b.ann3m}%</span><div class="small faint">annualised</div></div><div><label>6-month pace</label><span class="num">${b.ann6m}%</span></div><div><label>Last month</label><span class="num">${sgn(b.lastMoM)}%</span></div></div>${glide(b)}</div>`).join('')}</div>
    <p class="small faint">Modules 05 and FX II. Year on year is where inflation has been; the 3-month annualised pace is where it is now. The dashed paths hold today's monthly pace, double it, halve it or stop it, and show where year on year lands over six months: pricing that no path reaches is the one to fade. As of ${esc(fmtDate(inf.core.asOf))}.</p>`);

  const bc = d.bounce;
  const bouncePanel = !bc ? '' : panel('Bounce check: positioning or durable?', `<div class="kpis"><div><label>S&P 5 days</label>${chg(bc.spy5d, '%', 1)}</div><div><label>S&P 20 days</label>${chg(bc.spy20d, '%', 1)}</div><div><label>Durable tells</label><span class="num big">${bc.durable} of ${bc.n}</span></div></div>
    <div class="dots-row">${bc.checks.map((c) => `<span class="page ${c.read === 'durable' ? 'on' : 'bad'}" title="${esc(c.why)}">${esc(c.key)}</span>`).join('')}</div>
    <ul class="list">${bc.checks.map((c) => `<li><span class="grow"><b class="small">${esc(c.label)}</b><div class="small faint">${esc(c.why)}</div></span><span class="num small">${esc(c.value)}</span><span class="pill ${c.read === 'durable' ? 'bull' : 'warn'}">${c.read}</span></li>`).join('')}</ul>
    <p class="small faint">Alfie's test and module 00.4: did a macro constraint change, or only the price of exposure? Skew and leveraged-ETF flows are part of the test but have no free source, so they are not here. As of ${esc(fmtDate(bc.asOf))}.</p>`);

  const sb = d.stockBond;
  const sbPanel = !sb ? '' : panel('Stock-bond correlation', `<div class="drv-2"><div><div class="kpis"><div><label>60-day correlation, S&P vs long Treasuries</label><span class="num big">${sb.corr60d}</span></div></div><p class="small">${esc(sb.read)}</p></div>
    <div>${lineSvg(sb.history, { h: 100, min: -1, max: 1, hlines: [{ v: 0 }], bands: [{ from: 0.2, to: 1, fill: 'var(--bear-bg)' }, { from: -1, to: -0.2, fill: 'var(--bull-bg)' }], label: 'Rolling stock-bond correlation' })}</div></div>
    <p class="small faint">Module 08: the mix of growth, inflation and liquidity sets the correlation. Positive (red zone) = bonds stop hedging stocks, as in 2022.</p>`);

  const pr = d.pairs;
  const pairMap = () => {
    const W = 520, H = 300, M = 34, ps = Object.entries(pr.pairs), xs = ps.map(([, p]) => p.vsEmaPct), ys = ps.map(([, p]) => p.volRatio);
    const xMax = Math.max(1, ...xs.map(Math.abs)) * 1.1, yLo = Math.min(0.5, ...ys) * 0.95, yHi = Math.max(1.5, ...ys) * 1.05;
    const X = (v) => W / 2 + (v / xMax) * (W / 2 - M), Y = (v) => H - M - ((v - yLo) / (yHi - yLo)) * (H - 2 * M);
    return `<svg class="line-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="28 pairs by trend and volatility">
      <line x1="${W / 2}" x2="${W / 2}" y1="${M / 2}" y2="${H - M}" stroke="var(--line)"/><line x1="${M}" x2="${W - M}" y1="${Y(1)}" y2="${Y(1)}" stroke="var(--line)"/>
      <text x="${M}" y="${M / 2 + 8}" class="rd-q">Falling, high volatility (real bear)</text><text x="${W - M}" y="${M / 2 + 8}" text-anchor="end" class="rd-q">Rising, high volatility (with whiplash)</text>
      <text x="${M}" y="${H - M - 6}" class="rd-q">Falling, low volatility (quiet)</text><text x="${W - M}" y="${H - M - 6}" text-anchor="end" class="rd-q">Rising, low volatility (calm grind)</text>
      ${ps.map(([k, p]) => `<g><circle cx="${X(p.vsEmaPct)}" cy="${Y(p.volRatio)}" r="3.5" fill="${p.trend === 'up' ? 'var(--bull)' : 'var(--bear)'}"/><text x="${X(p.vsEmaPct) + 5}" y="${Y(p.volRatio) + 3}" class="g-axis" fill="var(--muted)">${k}</text><title>${k}: ${p.vsEmaPct}% from 50-day EMA, volatility ${p.volRatio}x its 1-year median</title></g>`).join('')}
      <text x="${W / 2}" y="${H - 8}" text-anchor="middle" class="g-axis">% from 50-day EMA →</text><text x="8" y="${H / 2}" class="g-axis" transform="rotate(-90 8 ${H / 2})" text-anchor="middle">volatility vs 1-year median →</text></svg>`;
  };
  const pairsPanel = !pr ? '' : panel('The 28 pairs: trend × volatility', `${pairMap()}<p class="small faint">Module 00.9: trend state × volatility state = four regimes with different behaviour. Continuation setups tend to suit calm trends; reversals suit high volatility. ${esc(pr.method)} As of ${esc(fmtDate(pr.asOf))}.</p>`);

  main.innerHTML = head('Drivers', 'What is driving each market, and when it stops: the market regime, each currency\'s real-world drivers and correlations against their normal, then the cross-asset readings Market Context does not carry (liquidity, gold\'s drivers, the US curve, growth breadth, the inflation pace, equity bounce quality, the stock-bond link, every pair\'s trend regime). Updated daily.') +
    ((d.warns || []).length ? `<div class="note small">Data warnings: ${d.warns.map(esc).join(' · ')}</div>` : '') +
    regimeBanner(corr?.regime) + whoIsDriving(corr, card) +
    liqPanel + goldPanel + curvePanel + growthPanel + infPanel + bouncePanel + sbPanel + pairsPanel;

  const toggle = (row) => {
    const id = row.dataset.link, box = main.querySelector(`[data-dive="${CSS.escape(id)}"]`);
    const open = box.hidden;
    main.querySelectorAll('.lk-dive').forEach((b) => { b.hidden = true; b.innerHTML = ''; });
    main.querySelectorAll('.lk[aria-expanded="true"]').forEach((r) => r.setAttribute('aria-expanded', 'false'));
    if (open) { box.innerHTML = linkDeepDive(corr.links.find((l) => l.id === id), corr.regime, card); box.hidden = false; row.setAttribute('aria-expanded', 'true'); }
  };
  main.addEventListener('click', (ev) => { const row = ev.target.closest('.lk[data-link]'); if (row && !ev.target.closest('a')) toggle(row); });
  main.addEventListener('keydown', (ev) => { const row = ev.target.closest('.lk[data-link]'); if (row && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); toggle(row); } });
};

// ---------- countries (layer 1: the slow structural profile behind each currency) ----------
// Read-only reference written from the course's seven-part country profile (data/countries.json). Figures are
// approximate and structural; refreshed once a year, not daily.
const COMMOD_TONE = { long: ['long', 'bull'], short: ['short', 'bear'], flat: ['neutral', 'flat'] };
const MIX = [['C', 'Consumption', 'var(--pos-slow)'], ['I', 'Investment', 'var(--pos-fast)'], ['G', 'Government consumption', 'var(--flat)']];
function mixBar(mix, w = 300) {
  const tot = MIX.reduce((s, [k]) => s + Math.max(0, mix[k] || 0), 0) || 1;
  let x = 0;
  const segs = MIX.map(([k, label, c]) => {
    const sw = (Math.max(0, mix[k] || 0) / tot) * w, seg = `<rect x="${x}" y="0" width="${sw}" height="18" fill="${c}" fill-opacity="0.85"><title>${label} ${mix[k]}% of GDP</title></rect>${sw > 34 ? `<text x="${x + 5}" y="13" class="g-num" fill="var(--bg)">${k} ${mix[k]}%</text>` : ''}`;
    x += sw; return seg;
  }).join('');
  return `<svg class="mix-bar" viewBox="0 0 ${w} 18" role="img" aria-label="GDP mix: consumption ${mix.C}%, investment ${mix.I}%, government ${mix.G}%, net exports ${mix.NX}%">${segs}</svg>`;
}
// Small horizontal bar for one stat across the eight countries; diverging when values can be negative.
function statBars(list, key, { unit = '', diverging = false, digits = 0 } = {}) {
  const vals = list.map((c) => c.stats[key]), max = Math.max(...vals.map(Math.abs), 1), W = 160;
  return list.map((c) => {
    const v = c.stats[key], w = (Math.abs(v) / max) * (diverging ? W / 2 - 2 : W);
    const x = diverging ? (v >= 0 ? W / 2 : W / 2 - w) : 0;
    const col = diverging ? (v >= 0 ? 'var(--bull)' : 'var(--bear)') : 'var(--accent)';
    return `<div class="stat-row"><span class="ccy">${c.code}</span><svg viewBox="0 0 ${W} 12" class="stat-bar" aria-hidden="true">${diverging ? `<line x1="${W / 2}" x2="${W / 2}" y1="0" y2="12" stroke="var(--faint)"/>` : ''}<rect x="${x}" y="1" width="${Math.max(w, 1.5)}" height="10" rx="2" fill="${col}" fill-opacity="0.8"/></svg><b class="num small">${v > 0 && diverging ? '+' : ''}${Number(v).toFixed(digits)}${unit}</b></div>`;
  }).join('');
}

render.countries = async (main) => {
  const monday = scMonday();
  const [data, pos, index] = await Promise.all([load('countries'), loadLive('positioning', true).catch(() => null), loadLive('scorecard-index', true).catch(() => null)]);
  let views = await loadViews();
  const card = index?.weeks?.some((w) => w.monday === monday) ? await loadLive(`scorecard-${monday}`, true).catch(() => null) : null;
  const list = data.countries, keys = Object.entries(data.commodityKeys);
  let sel = (location.hash || '').slice(1).toUpperCase();
  if (!list.some((c) => c.code === sel)) sel = list[0].code;
  let draft = null, viewMsg = ''; // draft: text typed but not saved, for the selected country

  // My read: written here, dated, shown on the Scorecard. This week's Market Context labels sit beside it.
  const myRead = (code) => {
    const hist = views.views[code] || [], cur = hist[0], a = card?.currencies?.[code]?.auto;
    const mc = a ? [['inflation', 'Inflation'], ['growth', 'Growth'], ['labour', 'Unemployment']].filter(([k]) => a[k]).map(([k, l]) => `<li><b>${l}</b> <span class="num">${esc(a[k].value ?? '')}</span> <span class="muted small">${esc(a[k].level)} · ${esc(a[k].dir)}</span></li>`).join('') +
      (a.rates ? `<li><b>Bank</b> <span class="muted small">${esc(a.rates.stance || '')}</span></li>` : '') : '';
    return `<section class="panel my-read">
      <div class="panel-head"><h2>My read · <span class="ccy">${code}</span></h2>${cur ? `<span class="pill ${cur.date < monday ? 'warn' : 'flat'}">written ${esc(fmtDate(cur.date))} · ${viewAge(cur.date)}</span>` : '<span class="pill flat">no view yet</span>'}</div>
      ${mc ? `<ul class="list sc-evidence">${mc}</ul><p class="small faint" style="margin:4px 0 10px">${esc(a.source || 'Market Context')}, read ${new Date(a.readAt).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.</p>` : ''}
      <textarea id="view-text" rows="3" style="width:100%" placeholder="${VIEW_PLACEHOLDER}">${esc(draft ?? cur?.text ?? '')}</textarea>
      <div class="form-actions"><button class="btn primary" data-act="save-view">${localMode() ? 'Save (local test)' : ghToken.get() ? 'Save to GitHub' : 'Save (connect GitHub first)'}</button>
        <span class="small muted">Shows on the Scorecard. Saving again today replaces today's entry.</span><span id="view-msg">${viewMsg}</span></div>
      ${hist.length > (cur ? 1 : 0) ? `<div class="pc-h" style="margin-top:12px">Earlier</div><ul class="list">${hist.slice(1).map((v) => `<li><span class="small muted nowrap">${esc(fmtDate(v.date))}</span> <span class="grow">${esc(v.text)}</span></li>`).join('')}</ul>` : ''}
    </section>`;
  };

  const heat = `<div class="table-wrap"><table class="heat"><thead><tr><th></th>${keys.map(([, l]) => `<th>${esc(l)}</th>`).join('')}</tr></thead>
    <tbody>${list.map((c) => `<tr><td><a href="#${c.code}" data-ccy="${c.code}" class="ccy">${c.code}</a></td>${keys.map(([k]) => { const [t, tone] = COMMOD_TONE[c.commodities[k]] || COMMOD_TONE.flat; return `<td class="heat-cell ${tone}">${t}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>
    <p class="small faint">Long = net exporter (a price rise helps the currency's terms of trade), short = net importer. The classic pair: CAD long oil, JPY short oil, so CADJPY tends to track crude.</p>`;
  const compare = `<div class="cmp-grid">
      <div><div class="small muted cmp-h">Median age (years)</div>${statBars(list, 'medianAge')}</div>
      <div><div class="small muted cmp-h">Aged 65 and over (% of people)</div>${statBars(list, 'over65Pct', { unit: '%' })}</div>
      <div><div class="small muted cmp-h">Current account (% of GDP)</div>${statBars(list, 'currentAccountPct', { unit: '%', diverging: true, digits: 1 })}</div>
      <div><div class="small muted cmp-h">Government debt (% of GDP)</div>${statBars(list, 'govDebtPct', { unit: '%' })}</div>
      <div><div class="small muted cmp-h">Exports (% of GDP): how open</div>${statBars(list, 'exportsPct', { unit: '%' })}</div>
      <div><div class="small muted cmp-h">What GDP is spent on</div>${list.map((c) => `<div class="stat-row"><span class="ccy">${c.code}</span>${mixBar(c.stats.mix, 160)}<b class="num small ${c.stats.mix.NX >= 0 ? 'up' : 'down'}">NX ${c.stats.mix.NX > 0 ? '+' : ''}${c.stats.mix.NX}%</b></div>`).join('')}
        <div class="pos-legend">${MIX.map(([k, l, col]) => `<span class="pos-key"><svg width="10" height="10" aria-hidden="true"><rect width="10" height="10" fill="${col}"/></svg>${l}</span>`).join('')}<span class="pos-key">NX = net exports</span></div></div>
    </div>`;

  const SECTIONS = [['history', 'History & profile'], ['demographics', 'Demographics'], ['capacity', 'Output capacity'], ['geography', 'Geography'], ['resources', 'Resources & tech'], ['politics', 'Politics & geopolitics']];
  const detail = (c) => {
    const s = c.stats, p = c.profile, pc = pos?.currencies?.[c.code];
    const tile = (label, v, sub = '') => `<div><label>${label}</label><span class="num big">${v}</span>${sub ? `<div class="small faint">${sub}</div>` : ''}</div>`;
    return `<section class="panel country" id="c-${c.code}">
      <div class="panel-head"><h2><span class="ccy">${c.code}</span> ${esc(c.name)}</h2><span class="small muted">${esc(c.bank)}</span></div>
      <p class="country-char">${esc(c.character)}</p>
      <div class="kpis">${tile('GDP', `$${s.gdpUsdTn}tn`)}${tile('People', `${s.popM}m`, `median age ${s.medianAge}`)}${tile('Aged 65+', `${s.over65Pct}%`)}${tile('Current account', `${s.currentAccountPct > 0 ? '+' : ''}${s.currentAccountPct}%`, 'of GDP')}${tile('Government debt', `${s.govDebtPct}%`, 'of GDP')}</div>
      <div class="small muted" style="margin-bottom:4px">What GDP is spent on · net exports <b class="${s.mix.NX >= 0 ? 'up' : 'down'} num">${s.mix.NX > 0 ? '+' : ''}${s.mix.NX}%</b></div>${mixBar(s.mix, 900)}
      <div class="chips-row">${keys.map(([k, l]) => { const [t, tone] = COMMOD_TONE[c.commodities[k]] || COMMOD_TONE.flat; return `<span class="pill ${tone}">${esc(l)}: ${t}</span>`; }).join('')}</div>
      <div class="small muted">Main buyers: ${c.partners.map(esc).join(' · ')}</div>
      <div class="profile-grid">${SECTIONS.map(([k, l]) => `<div class="profile-card"><div class="pc-h">${l}</div><p>${esc(p[k])}</p></div>`).join('')}</div>
      <div class="small muted pos-kind">The three regimes: how decisions are made, and by whom</div>
      <div class="profile-grid three">${[['currency', 'Currency'], ['monetary', 'Monetary'], ['fiscal', 'Fiscal']].map(([k, l]) => `<div class="profile-card regime-card"><div class="pc-h">${l}</div><p>${esc(p.regimes[k])}</p></div>`).join('')}</div>
      <div class="grid sc-grid" style="margin-top:12px">
        <div><div class="pc-h">How it shows up in price</div><ul class="list">${c.priceLinks.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
        <div><div class="pc-h">What to watch</div><ul class="list">${c.watch.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
      </div>
      ${pc ? `<div class="pc-h" style="margin-top:12px">Positioning now <a class="small" href="positioning.html">all →</a></div><div class="pos-grid">${posCard(`<span class="ccy">${c.code}</span>`, pc, `COT of ${esc(fmtDate(pos.cotDate))}`)}</div>` : ''}
    </section>`;
  };

  const draw = () => {
    main.innerHTML = head('Countries', 'Layer 1: who each economy is. The slow structure behind the currency: the seven-part country profile from the course, quantified. It changes over years, so read it to understand the character. My read, at the top of each country, is my current view of the economy; it shows on the Scorecard.') +
      `<div class="filters"><span class="small muted">Country</span>${list.map((c) => `<button class="chip ${c.code === sel ? 'on' : ''}" data-ccy="${c.code}">${c.code} · ${esc(c.name)}</button>`).join('')}</div>` +
      myRead(sel) + panel('Side by side', compare) + panel('Long or short each commodity', heat) +
      detail(list.find((c) => c.code === sel)) +
      `<p class="small faint">${esc(data.note)} Updated ${esc(fmtDate(data.updated))}. Sources: ${(data.sources || []).map((x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a>`).join(" · ")}</p>`;
  };
  const unsaved = () => draft != null && draft !== (views.views[sel]?.[0]?.text ?? '');
  main.addEventListener('input', (ev) => { if (ev.target.id === 'view-text') draft = ev.target.value; });
  main.addEventListener('click', async (ev) => {
    if (ev.target.closest('[data-act="save-view"]')) {
      const text = (draft ?? $('#view-text').value).trim();
      const say = (h) => { viewMsg = h; $('#view-msg').innerHTML = h; };
      if (!text) { say('<span class="error">Write the view first.</span>'); return; }
      if (!canSave()) { say('<span class="error">Connect GitHub first (Kill Switches page), or use local test mode.</span>'); return; }
      say('Saving…');
      try {
        const res = await saveView(sel, text);
        views = { views: {}, ...res.data }; draft = null;
        viewMsg = res.commit === 'local' ? 'Saved in this browser (local test mode).' : `Saved (commit ${esc(res.commit || '')}).`;
      } catch (e) { viewMsg = `<span class="error">${esc(e.message)}</span>`; }
      draw(); return;
    }
    const b = ev.target.closest('[data-ccy]'); if (!b) return;
    ev.preventDefault();
    if (unsaved() && !confirm(`Leave ${sel} without saving my read?`)) return;
    sel = b.dataset.ccy; draft = null; viewMsg = ''; history.replaceState(null, '', `#${sel}`); draw();
    $(b.tagName === 'BUTTON' ? '.my-read' : `#c-${sel}`).scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
  window.addEventListener('beforeunload', (ev) => { if (unsaved()) { ev.preventDefault(); ev.returnValue = ''; } });
  draw();
};

// ---------- playbook (the course's framework, protocols and reference points) ----------
const PB_FUNNEL_FILL = ['#1d2733', '#2a3a4c', 'var(--accent)', '#4f8fd8', 'var(--pos-fast)'];
function pbFunnel(layers, { tones = null, compact = false, links = true } = {}) {
  const W = compact ? 200 : 520, bandH = compact ? 18 : 40, gap = compact ? 3 : 6, H = layers.length * (bandH + gap);
  const top = W * 0.96, bottom = W * 0.3;
  const bands = layers.map((l, i) => {
    const w0 = top - ((top - bottom) * i) / layers.length, w1 = top - ((top - bottom) * (i + 1)) / layers.length + (compact ? 0 : 8);
    const y = i * (bandH + gap), x0 = (W - w0) / 2, x1 = (W - w1) / 2;
    const fill = tones ? ({ bull: 'var(--bull)', bear: 'var(--bear)', warn: 'var(--warn)', flat: 'var(--panel-2)' }[tones[i]] || 'var(--panel-2)') : PB_FUNNEL_FILL[i];
    const txt = compact ? '' : `<text x="${W / 2}" y="${y + bandH / 2 + 5}" text-anchor="middle" class="fn-label">${i + 1} · ${esc(l.name.toUpperCase())}</text>`;
    const poly = `<polygon points="${x0},${y} ${x0 + w0},${y} ${x1 + w1},${y + bandH} ${x1},${y + bandH}" fill="${fill}" ${tones ? 'fill-opacity="0.8" stroke="var(--line)"' : ''}><title>${esc(l.name)}${l.speed ? `: ${esc(l.speed)}` : ''}</title></polygon>`;
    return links && l.desk ? `<a href="${l.desk}">${poly}${txt}</a>` : poly + txt;
  }).join('');
  return `<svg class="${compact ? 'fn-mini' : 'fn-big'}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Five-layer funnel">${bands}</svg>`;
}

render.playbook = async (main) => {
  const data = await load('playbook');
  let layer = 'all';
  const T = { bull: 'bull', bear: 'bear', warn: 'warn', flat: 'flat' };
  const sec = {
    funnel: (s) => `<div class="fn-wrap">${pbFunnel(s.layers)}<ol class="fn-list">${s.layers.map((l) => `<li><b>${esc(l.name)}</b> <span class="faint small">${esc(l.speed)}</span><div class="small">${esc(l.question)}</div><a class="small" href="${l.desk}">On my desk: ${esc(l.deskLabel)} →</a></li>`).join('')}</ol></div>`,
    quadrant: (s) => `<div class="quad-map"><div class="qm-y top">▲ ${esc(s.yAxis[1])}</div>
      <div class="qm-grid">${['tl', 'tr', 'bl', 'br'].map((p) => { const b = s.boxes.find((x) => x.pos === p); return `<div class="qm-box ${T[b.tone]}-q"><div class="qm-name">${esc(b.name)}</div><ul>${b.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul><div class="small faint">${esc(b.why)}</div></div>`; }).join('')}</div>
      <div class="qm-x"><span>◀ ${esc(s.xAxis[0])}</span><span>${esc(s.xAxis[1])} ▶</span></div><div class="qm-y">▼ ${esc(s.yAxis[0])}</div></div>`,
    grid: (s) => `<div class="mx" style="grid-template-columns: minmax(4.5em, 9em) repeat(${s.cols.length}, minmax(0, 1fr))"><div></div>${s.cols.map((c) => `<div class="mx-h">${esc(c)}</div>`).join('')}${s.rows.map((r, i) => `<div class="mx-h row">${esc(r)}</div>${s.cells[i].map((c, j) => `<div class="mx-c ${T[s.tones[i][j]]}">${esc(c)}</div>`).join('')}`).join('')}</div>`,
    chain: (s) => `<div class="chain-row">${s.steps.map(([a, b], i) => `${i ? '<span class="chain-arrow" aria-hidden="true">→</span>' : ''}<div class="chain-step ${i >= 3 ? 'dark' : ''}"><b>${esc(a)}</b><div class="small">${esc(b)}</div></div>`).join('')}</div>`,
    protocols: (s) => {
      const layers = ['all', ...new Set(s.items.map((p) => p.layer))];
      return `<div class="filters">${layers.map((l) => `<button class="chip ${layer === l ? 'on' : ''}" data-layer="${esc(l)}">${esc(l)}</button>`).join('')}</div>
        <div class="proto-grid">${s.items.filter((p) => layer === 'all' || p.layer === layer).map((p) => `<div class="proto"><div class="proto-h"><b>${esc(p.name)}</b><span class="pill flat">${esc(p.layer)}</span></div><ol>${p.steps.map((x) => `<li>${esc(x)}</li>`).join('')}</ol></div>`).join('')}</div>`;
    },
    facts: (s) => `<div class="fact-grid">${s.items.map(([k, v]) => `<div class="fact"><div class="fact-k">${esc(k)}</div><div>${esc(v)}</div></div>`).join('')}</div>`,
  };
  sec.matrix = sec.grid;
  const draw = () => {
    main.innerHTML = head('Playbook', `${esc(data.note)}`, `<a class="btn" href="countries.html">Countries →</a>`) +
      `<div class="filters"><span class="small muted">Jump to</span>${data.sections.map((s) => `<a class="chip" href="#pb-${s.id}">${esc(s.title)}</a>`).join('')}</div>` +
      data.sections.map((s) => `<section class="panel pb" id="pb-${s.id}"><div class="panel-head"><h2>${esc(s.title)}</h2></div>${s.intro ? `<p class="small muted">${esc(s.intro)}</p>` : ''}${(sec[s.type] || (() => ''))(s)}${s.foot ? `<p class="small faint">${esc(s.foot)}</p>` : ''}</section>`).join('');
  };
  main.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-layer]'); if (!b) return;
    layer = b.dataset.layer; const y = window.scrollY; draw(); window.scrollTo(0, y);
  });
  draw();
};

// ---------- review (were my calls right? graded from prices, not from memory) ----------
render.review = async (main) => {
  const [index] = await Promise.all([loadLive('scorecard-index', true), loadPrices()]);
  // A week with data fields filled but no call made yet has nothing to grade.
  const weeks = (index?.weeks || []).filter((w) => (w.pairs || []).length || Object.keys(w.scores || {}).length);
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

  // Release-to-reaction tally (MMH 00.7): every logged event across saved weeks, placed in the 3x3 grid.
  const cards = await Promise.all((index?.weeks || []).map((w) => loadLive(`scorecard-${w.monday}`, true).catch(() => null)));
  const logged = cards.filter(Boolean).flatMap((c) => (c.events || []).filter((e) => e.reaction?.print).map((e) => ({ e, r: reactionOf(e) }))).filter((x) => x.r && !x.r.pending);
  const cellOf = (p, q) => logged.filter((x) => x.e.reaction.print === p && x.r.price === q);
  const rxGrid = `<div class="mx" style="grid-template-columns: minmax(4.5em, 7em) repeat(3, minmax(0, 1fr))"><div></div>${Object.values(RX_PRICE).map((l) => `<div class="mx-h">Price ${l.toLowerCase()}</div>`).join('')}
    ${Object.entries(RX_PRINT).map(([p, pl]) => `<div class="mx-h row">${pl}</div>${Object.keys(RX_PRICE).map((q) => { const xs = cellOf(p, q), f3 = xs.filter((x) => x.r.follow3 != null), avg = f3.length ? f3.reduce((s, x) => s + x.r.follow3, 0) / f3.length : null;
      const tone = q === 'flat' ? (p === 'inline' ? 'flat' : 'warn') : p === 'inline' ? 'warn' : (p === 'beat') === (q === 'up') ? 'flat' : 'bear';
      return `<div class="mx-c ${tone}"><b class="num">${xs.length}</b> event${xs.length === 1 ? '' : 's'}${avg != null ? `<div class="small">next 3 days ${avg >= 0 ? 'continued' : 'reversed'} ${Math.abs(avg).toFixed(2)}% on average</div>` : ''}</div>`; }).join('')}`).join('')}</div>`;
  const rxPanel = `<section class="panel" style="margin-bottom:14px"><div class="panel-head"><h2>Release to reaction</h2><a href="playbook.html#pb-matrix">Matrix →</a></div>
    ${logged.length ? rxGrid + `<ul class="list" style="margin-top:10px">${logged.sort((a, b) => (a.e.date < b.e.date ? 1 : -1)).slice(0, 12).map(({ e, r }) => `<li><span class="small nowrap muted">${fmtDate(e.date)}</span><span class="grow"><b>${esc(e.event)}</b> <span class="ccy">${esc(e.currency)}</span> · ${RX_PRINT[e.reaction.print]} ${rxCell(r)}<div>${rxMove(r)}</div></span></li>`).join('')}</ul>`
      : '<div class="empty">Nothing logged yet. On the Scorecard, once an event has printed, pick beat / in line / miss and the desk reads the price reaction. After about 30 the grid shows which contradictions led to multi-day moves.</div>'}</section>`;
  const stat = (label, t) => `<div><label>${label}</label><span class="num big">${t.n ? `${t.right} of ${t.n}` : '—'}</span><div class="small faint">${t.n ? `${t.wrong} wrong, ${t.n - t.right - t.wrong} flat` : 'no closed week yet'}</div></div>`;

  main.innerHTML = head('Review', 'Were my calls right? Each saved week is graded from prices: pairs by their move in my direction, currency calls by the currency against the other seven.', `<span>${priceAge()}</span>`) +
    `<section class="panel" style="margin-bottom:14px"><div class="kpis">${stat('Pairs right, closed weeks', tp)}${stat('Currency calls right, closed weeks', tc)}
      <div><label>Weeks saved</label><span class="num big">${weeks.length}</span></div></div></section>` + rxPanel +
    (graded.map(({ w, g }) => `<section class="panel" style="margin-bottom:14px">
      <div class="panel-head"><h2>Week of ${fmtDate(w.monday)}</h2><span><span class="pill ${g.state === 'running' ? 'warn' : 'flat'}">${esc(g.state)}</span> <a href="scorecard.html?week=${w.monday}">Scorecard →</a></span></div>
      ${g.from ? `<p class="small faint" style="margin:0 0 8px">Measured from the close of ${fmtDate(g.from)} to ${g.state === 'running' ? 'now' : `the close of ${fmtDate(g.to)}`}.</p>` : ''}
      <div class="grid sc-grid">
        <div><div class="small muted" style="margin-bottom:4px">Pairs</div><ul class="list">${g.pairs.map((p) => `<li><b>${esc(p.pair)}</b> <span class="pill ${p.dir === 'LONG' ? 'bull' : 'bear'}">${esc(p.dir)}</span><span class="grow small muted">pair moved ${pctHtml(p.move)}</span>${hitPill(p.mine)}</li>`).join('') || `<li class="small faint">${(w.pairs || []).length ? 'Not measurable yet.' : 'No pairs confirmed that week.'}</li>`}</ul></div>
        <div><div class="small muted" style="margin-bottom:4px">Currency calls</div><ul class="list">${g.calls.map((c) => `<li><span class="ccy">${esc(c.c)}</span> ${scoreChip(c.s)}<span class="grow small muted">vs the other seven ${pctHtml(c.move)}</span>${hitPill(c.mine)}</li>`).join('') || `<li class="small faint">${Object.keys(w.scores || {}).length ? 'Not measurable yet, or all calls were "about right".' : 'No calls that week.'}</li>`}</ul></div>
      </div></section>`).join('') || '<section class="panel"><div class="empty">No scorecard saved yet. This page fills itself once a week has been saved. <a href="scorecard.html">Do the weekly build →</a></div></section>') +
    `<p class="small faint">A call counts as right when price moved more than 0.05% its way over the week. This grades direction only, not entries or exits. My own verdict per call and the monthly review come next.</p>`;
};

// Text boxes grow with their text (CSS field-sizing). Where a browser lacks it (Safari), size each one to its content
// when it appears and as it is typed in.
if (!(window.CSS && CSS.supports('field-sizing', 'content'))) {
  const fit = (t) => { t.style.height = 'auto'; t.style.height = `${t.scrollHeight + 2}px`; };
  document.addEventListener('input', (ev) => { if (ev.target.tagName === 'TEXTAREA') fit(ev.target); });
  new MutationObserver(() => document.querySelectorAll('textarea').forEach(fit)).observe(document.body, { childList: true, subtree: true });
}

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
