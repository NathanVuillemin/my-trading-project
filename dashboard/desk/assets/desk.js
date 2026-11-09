// Trading Desk: shared shell + page renderers.
// Every page is a thin HTML file with <body data-page="...">; this script draws the
// nav bar and the page from JSON in ./data/. Mock files carry "mock": true and the
// shell shows a banner. Live pipelines later overwrite the same files, same shape.

const PAGES = [
  { id: 'hub', href: 'index.html', label: 'Hub' },
  { id: 'recap', href: 'weekly-recap.html', label: 'Weekly Recap' },
  { id: 'bias', href: 'bias.html', label: 'Bias' },
  { id: 'levels', href: 'levels.html', label: 'Key Levels' },
  { id: 'killswitches', href: 'kill-switches.html', label: 'Kill Switches' },
  { id: 'drivers', href: 'drivers.html', label: 'Drivers' },
  { id: 'review', href: 'review.html', label: 'Review' },
];
const CCYS = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD'];
// Market-convention order: the higher-priority currency is the base of the pair.
const PAIR_ORDER = ['EUR', 'GBP', 'AUD', 'NZD', 'USD', 'CAD', 'CHF', 'JPY'];

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cache = {};
async function load(name) {
  if (!cache[name]) {
    cache[name] = fetch(`data/${name}.json`, { cache: 'no-store' }).then((r) => {
      if (!r.ok) throw new Error(`data/${name}.json: HTTP ${r.status}`);
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
  const r = await fetch(`${ghUrl(name)}?ref=${GH.branch}&t=${Date.now()}`, { headers: ghHeaders(), cache: 'no-store' });
  if (!r.ok) throw new Error(`GitHub read ${name}: HTTP ${r.status}`);
  const j = await r.json();
  return { data: JSON.parse(b64decode(j.content)), sha: j.sha };
}
// Re-reads the latest file, applies one change and commits it, so a data snapshot the daily
// job committed in between is never overwritten. Retries once if the file moved under us.
async function ghUpdate(name, change, message) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, sha } = await ghRead(name);
    const next = change(structuredClone(data));
    const r = await fetch(ghUrl(name), {
      method: 'PUT', headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, content: b64encode(JSON.stringify(next, null, 2) + '\n'), sha, branch: GH.branch }),
    });
    if (r.ok) { const j = await r.json(); cache[`live:${name}`] = Promise.resolve(next); return { data: next, commit: j.commit?.sha?.slice(0, 7) }; }
    if (r.status !== 409 && r.status !== 422) throw new Error(`GitHub save: HTTP ${r.status}${r.status === 401 || r.status === 403 ? ' (token missing or lacks Contents write on this repo)' : ''}`);
  }
  throw new Error('GitHub save: file kept changing, try again');
}
// Freshest copy: GitHub API with a token, else raw.githubusercontent (up to ~5 min CDN cache),
// else the copy deployed with the site.
async function loadLive(name) {
  if (!cache[`live:${name}`]) {
    cache[`live:${name}`] = (async () => {
      try { if (ghToken.get()) return (await ghRead(name)).data; } catch { /* fall through */ }
      try {
        const r = await fetch(`https://raw.githubusercontent.com/${GH.owner}/${GH.repo}/${GH.branch}/${GH.dir}/${name}.json?t=${Date.now()}`, { cache: 'no-store' });
        if (r.ok) return await r.json();
      } catch { /* fall through */ }
      return load(name);
    })();
  }
  return cache[`live:${name}`];
}

// ---------- formatting ----------
const sign = (n) => (n > 0 ? `+${n}` : `${n}`);
const tone = (n) => (n > 0 ? 'bull' : n < 0 ? 'bear' : 'flat');
const scoreChip = (n, big = false) => `<span class="score ${tone(n)}${big ? ' big' : ''}">${sign(n)}</span>`;
const dirWord = (n) => (n > 0 ? 'LONG' : n < 0 ? 'SHORT' : 'FLAT');
const STATUS_TONE = { ACTIVE: 'bull', FROZEN: 'warn', EXPIRED: 'bear', FLAT: 'flat' };
const statusPill = (s) => `<span class="pill ${STATUS_TONE[s] || 'flat'}">${esc(s)}</span>`;
const EFFECT_TONE = { supports: 'bull', conflict: 'bear', neutral: 'flat' };
const effectPill = (e) => `<span class="pill ${EFFECT_TONE[e] || 'flat'}">${esc(e)}</span>`;
const TRIG_TONE = { fired: 'bear', near: 'warn', armed: 'flat' };
const trigPill = (s) => `<span class="pill ${TRIG_TONE[s] || 'flat'}">${esc(s)}</span>`;
const fmtDate = (iso) => new Date(iso + (iso.length === 10 ? 'T12:00:00Z' : '')).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const bp = (n) => `${n > 0 ? '+' : ''}${n}bp`;
const gapOf = (c) => c.cbPath.expectedBp - c.cbPath.pricedBp;
const gapWord = (g) => (g > 0 ? 'hawkish' : g < 0 ? 'dovish' : 'none');

function allPairs(currencies) {
  const byCode = Object.fromEntries(currencies.map((c) => [c.code, c]));
  const out = [];
  for (let i = 0; i < PAIR_ORDER.length; i++) {
    for (let j = i + 1; j < PAIR_ORDER.length; j++) {
      const base = byCode[PAIR_ORDER[i]], quote = byCode[PAIR_ORDER[j]];
      if (!base || !quote) continue;
      const diff = base.net - quote.net;
      const flags = [];
      for (const c of [base, quote]) {
        if (c.driver.status === 'conflict') flags.push(`${c.code} driver conflict`);
        if (c.status === 'FROZEN') flags.push(`${c.code} frozen`);
        if (c.status === 'EXPIRED') flags.push(`${c.code} expired`);
      }
      out.push({ pair: base.code + quote.code, base, quote, diff, flags });
    }
  }
  return out;
}

// ---------- shell ----------
function shell(page, asOf, mock) {
  const nav = PAGES.map((p) => `<a href="${p.href}" class="${p.id === page ? 'active' : ''}">${p.label}</a>`).join('');
  document.body.insertAdjacentHTML('afterbegin', `
    <header class="topbar"><div class="topbar-inner">
      <a class="brand" href="index.html">Trading <span>Desk</span></a>
      <nav class="nav">${nav}</nav>
      <span class="asof">${asOf ? 'as of ' + esc(asOf) : ''}</span>
    </div></header>
    ${mock ? '<div class="mockbar">MOCK DATA: architecture preview. Nothing here is live or real.</div>' : ''}`);
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

render.hub = async (main) => {
  const [brief, bias, killswitches, drivers, levels, history, recapIndex] = await Promise.all(
    ['brief', 'bias', 'killswitches', 'drivers', 'levels', 'history', 'recaps/index'].map((n) => (n === 'killswitches' ? loadLive(n) : load(n))));
  const latest = recapIndex.recaps[0];
  const recap = latest ? await load(`recaps/${latest.file.replace(/\.json$/, '')}`) : null;
  const hotKills = killswitches.killSwitches.filter((t) => t.status !== 'armed');
  const conflicts = drivers.drivers.filter((d) => d.effect === 'conflict');
  const regimeTone = { 'RISK-ON': 'bull', 'RISK-OFF': 'bear', CAUTION: 'warn' }[brief.regime] || 'flat';

  main.innerHTML = `
    <div class="grid hub-grid">
      <section class="panel brief span-2">
        <div class="panel-head"><h2>Morning brief · ${fmtDate(brief.date)}</h2><span class="pill ${regimeTone}">${esc(brief.regime)}</span></div>
        <h2 class="headline">${esc(brief.headline)}</h2>
        <ul class="bullets">${brief.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>
        <div class="panel-head"><h2>Focus</h2></div>
        <div class="focus">${brief.focus.map((f) => `<div class="item"><b>${esc(f.pair)}</b> <span class="pill ${f.direction === 'LONG' ? 'bull' : 'bear'}">${esc(f.direction)}</span><div class="small muted">${esc(f.why)}</div></div>`).join('')}
          ${brief.avoid.map((f) => `<div class="item"><b>${esc(f.pair)}</b> <span class="pill warn">avoid</span><div class="small muted">${esc(f.why)}</div></div>`).join('')}</div>
      </section>
      ${panel('Currency strength', strengthBars(bias.currencies), { href: 'bias.html', label: 'Bias' })}
      ${recap ? panel(`Weekly recap · ${fmtDate(recap.sunday)}`, `<p style="margin:0 0 10px">${esc(recap.overview.headline)}</p>
        <ul class="list">${['inflation', 'growth', 'both', 'neither'].map((s) => [s, recap.economies.filter((e) => e.scare === s)]).filter(([, l]) => l.length)
          .map(([s, l]) => `<li>${scarePill(s)}<span class="grow ccy small">${l.map((e) => e.code).join(' · ')}</span></li>`).join('')}</ul>`, { href: 'weekly-recap.html', label: 'Read' }) : ''}
      ${panel('Kill switches fired / near', `<ul class="list">${hotKills.map((t) => `<li><span class="ccy">${t.currency}</span><span class="grow">${esc(t.condition)}<div class="small faint">${esc(t.now)}</div></span>${trigPill(t.status)}</li>`).join('') || '<div class="empty">None</div>'}</ul>`, { href: 'kill-switches.html', label: 'Kill switches' })}
      ${panel('Driver conflicts', `<ul class="list">${conflicts.map((d) => `<li><span class="ccy">${d.currency}</span><span class="grow">${esc(d.driver)} <span class="num muted">${esc(d.move1m)}</span><div class="small faint">60d corr <span class="num">${d.corr60.toFixed(2)}</span></div></span>${effectPill(d.effect)}</li>`).join('') || '<div class="empty">None</div>'}</ul>`, { href: 'drivers.html', label: 'Drivers' })}
      ${panel('Key levels', `<ul class="list">${levels.levels.slice(0, 4).map((l) => `<li><span class="ccy">${esc(l.instrument)}</span><span class="grow"><span class="num">${esc(l.level)}</span> · ${esc(l.type)}<div class="small faint">price <span class="num">${esc(l.price)}</span></div></span><span class="pill flat">${esc(l.status)}</span></li>`).join('')}</ul>`, { href: 'levels.html', label: 'Levels' })}
      ${panel('Recent bias changes', `<ul class="list">${history.changes.slice(0, 4).map((h) => `<li><span class="ccy">${h.currency}</span><span class="grow">${esc(h.reason)}<div class="small faint">${fmtDate(h.date)} · ${esc(h.layer)}</div></span><span class="num small">${esc(String(h.from))} → ${esc(String(h.to))}</span></li>`).join('')}</ul>`, { href: 'review.html', label: 'Review' }, 'span-2')}
    </div>`;
};

render.bias = async (main) => {
  const bias = await load('bias');
  const pairs = allPairs(bias.currencies);
  const picks = pairs.filter((p) => Math.abs(p.diff) >= 2).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

  const card = (c) => {
    const g = gapOf(c);
    return `<article class="panel ccard">
      <div class="ccard-top">${scoreChip(c.net, true)}
        <div class="title"><span class="ccy">${c.code}</span> <span class="muted">${esc(c.name)}</span><div class="small faint">${esc(c.cb)} · next ${fmtDate(c.nextMeeting)}</div></div>
        ${statusPill(c.status)}</div>
      <div class="kv">
        <div><label>Structural</label><span class="${tone(c.structural)}" style="background:none">${sign(c.structural)}</span></div>
        <div><label>Driver</label><span style="font-family:inherit">${effectPill(c.driver.status)}</span></div>
        <div><label>Conviction</label><span>${c.conviction}/5</span></div>
        <div><label>My path</label><span>${bp(c.cbPath.expectedBp)}</span></div>
        <div><label>Priced</label><span>${bp(c.cbPath.pricedBp)}</span></div>
        <div><label>Gap</label><span class="${tone(g)}" style="background:none">${bp(g)} ${gapWord(g)}</span></div>
      </div>
      <p class="thesis">${esc(c.thesis)}</p>
      <details><summary>Full read</summary><dl>
        <dt>Growth</dt><dd>${esc(c.growth.dir)} · ${esc(c.growth.note)}</dd>
        <dt>Inflation</dt><dd>${esc(c.inflation.dir)}, ${esc(c.inflation.vsTarget)} target · ${esc(c.inflation.note)}</dd>
        <dt>Driver</dt><dd>${esc(c.driver.name)} (<a href="drivers.html">drivers</a>)</dd>
        <dt>Positioning</dt><dd>${esc(c.positioning)}</dd>
        <dt>Invalidation</dt><dd>${esc(c.invalidation)}</dd>
        <dt>Kill switches</dt><dd>${c.killSwitches.length ? `<a href="kill-switches.html?ccy=${c.code}">${c.killSwitches.length} linked</a>` : '<span class="faint">none</span>'}</dd>
        <dt>Reviewed</dt><dd>${fmtDate(c.reviewed)} · expires ${fmtDate(c.expires)}</dd>
      </dl></details>
    </article>`;
  };

  const byCode = Object.fromEntries(bias.currencies.map((c) => [c.code, c]));
  const order = [...bias.currencies].sort((a, b) => b.net - a.net).map((c) => c.code);
  const cell = (r, c) => {
    if (r === c) return '<td class="self"></td>';
    const d = byCode[r].net - byCode[c].net;
    const a = Math.min(Math.abs(d) / 4, 1) * 0.55 + (d ? 0.08 : 0);
    const bg = d > 0 ? `rgba(52,195,122,${a})` : d < 0 ? `rgba(240,96,106,${a})` : 'var(--panel-2)';
    return `<td style="background:${bg}" title="${r} vs ${c}">${d ? sign(d) : '0'}</td>`;
  };
  const matrix = `<div class="table-wrap"><table class="matrix"><thead><tr><th></th>${order.map((c) => `<th>${c}</th>`).join('')}</tr></thead>
    <tbody>${order.map((r) => `<tr><th>${r}</th>${order.map((c) => cell(r, c)).join('')}</tr>`).join('')}</tbody></table></div>
    <p class="small faint">Row currency vs column currency: row net minus column net.</p>`;

  const pickList = `<ul class="list">${picks.map((p) => `<li><span class="ccy" style="min-width:64px">${p.pair}</span>
    <span class="pill ${p.diff > 0 ? 'bull' : 'bear'}">${dirWord(p.diff)}</span>
    <span class="grow small ${p.flags.length ? '' : 'muted'}">${p.flags.length ? `<span class="warn" style="background:none">⚠ ${esc(p.flags.join(', '))}</span>` : 'clean: no conflicts'}</span>
    ${scoreChip(p.diff)}</li>`).join('')}</ul>`;

  const gold = bias.gold;
  const goldCard = `<article class="panel ccard">
    <div class="ccard-top">${scoreChip(gold.net, true)}<div class="title"><span class="ccy">XAU</span> <span class="muted">Gold</span></div>${statusPill(gold.status)}</div>
    <p class="thesis">${esc(gold.thesis)}</p>
    <ul class="list">${gold.drivers.map((d) => `<li><span class="grow">${esc(d.name)}</span>${effectPill(d.status)}</li>`).join('')}</ul>
    <div class="small muted">Invalidation: ${esc(gold.invalidation)}</div></article>`;

  main.innerHTML = head('Bias', 'One bias per currency, set by the central-bank gap (my path minus priced), adjusted by the driver layer. Pair bias = strongest vs weakest.') +
    `<div class="note">${esc(bias.scale)}</div>
    <div class="grid hub-grid" style="margin-bottom:14px">
      ${panel('Strength ranking', strengthBars(bias.currencies))}
      <section class="panel span-2"><div class="panel-head"><h2>Top pairs (score gap 2+)</h2></div>${pickList}</section>
    </div>
    <div class="grid cards">${bias.currencies.map(card).join('')}${goldCard}</div>
    <div style="margin-top:14px">${panel('Pair matrix', matrix)}</div>`;
};

render.levels = async (main) => {
  const data = await load('levels');
  const fams = data.families || {};
  const typeOf = (k) => data.types[k] || {};
  const stTone = { defended: 'bull', broken: 'bear', untested: 'flat', reference: 'flat', historical: 'flat' };
  main.innerHTML = head('Key Levels', 'Where big players act: where they showed their hand, their cost basis, the reference points they hedge against, and macro levels that force a central bank\'s hand. <span class="pill warn">draft layout</span>') +
    `<div class="note">${esc(data.note)}</div>
    <div class="filters tabs" id="lv-fams">${[['all', 'All'], ...Object.entries(fams)].map(([k, v]) => `<a class="chip" data-fam="${k}" href="#${k === 'all' ? '' : k}">${esc(v)}</a>`).join('')}</div>
    <section class="panel"><div class="table-wrap"><table>
      <thead><tr><th>Instrument</th><th>Level</th><th>Price now</th><th>Type</th><th>Who</th><th>Side</th><th>Evidence</th><th>Status</th><th>Last touch</th><th>Source</th></tr></thead>
      <tbody id="lv-rows"></tbody></table></div></section>
    <div class="grid hub-grid" style="margin-top:14px">
      ${Object.entries(fams).map(([f, label]) => panel(label, `<ul class="list">${Object.entries(data.types).filter(([, t]) => t.family === f).map(([k, t]) => `<li><span class="pill flat">${esc(k)}</span><span class="grow small muted">${esc(t.desc)}</span></li>`).join('')}</ul>`)).join('')}
      ${data.statuses ? panel('Status', `<ul class="list">${Object.entries(data.statuses).map(([k, v]) => `<li><span class="pill ${stTone[k] || 'flat'}">${esc(k)}</span><span class="grow small muted">${esc(v)}</span></li>`).join('')}</ul>`) : ''}
    </div>`;
  const draw = () => {
    const f = location.hash.slice(1);
    const want = fams[f] ? f : 'all';
    main.querySelectorAll('[data-fam]').forEach((a) => a.classList.toggle('on', a.dataset.fam === want));
    const rows = data.levels.filter((l) => want === 'all' || typeOf(l.type).family === want);
    $('#lv-rows').innerHTML = rows.map((l) => `<tr>
        <td><span class="ccy">${esc(l.instrument)}</span></td>
        <td class="num">${esc(l.level)}</td><td class="num muted">${esc(l.price)}</td>
        <td><span class="pill flat" title="${esc(typeOf(l.type).desc || '')}">${esc(l.type)}</span></td>
        <td class="small">${esc(l.who)}</td><td class="small">${esc(l.side)}</td>
        <td class="small muted">${esc(l.evidence)}</td>
        <td><span class="pill ${stTone[l.status] || 'flat'}">${esc(l.status)}</span></td>
        <td class="small nowrap">${l.lastTouch === '—' ? '—' : fmtDate(l.lastTouch)}</td>
        <td class="small">${l.source ? `<a href="${esc(l.source.url)}" target="_blank" rel="noopener">${esc(l.source.name)} ↗</a>` : '<span class="faint">—</span>'}</td>
      </tr>`).join('') || '<tr><td colspan="10" class="empty">No levels of this kind yet.</td></tr>';
  };
  window.addEventListener('hashchange', draw);
  draw();
};

render.killswitches = async (main) => {
  let data = await loadLive('killswitches');
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
      <button class="btn primary" data-act="save">${ghToken.get() ? 'Save to GitHub' : 'Save (connect GitHub first)'}</button>
      <button class="btn" data-act="cancel">Cancel</button>
      ${k.id ? '<button class="btn danger" data-act="delete">Delete</button>' : ''}
    </div></section>`;

  const connect = () => (ghToken.get()
    ? `<div class="note">Connected to GitHub: changes are committed to <code>${GH.dir}/killswitches.json</code> in ${esc(GH.repo)}. <button class="link-btn" data-act="forget">Forget token on this device</button></div>`
    : `<section class="panel" style="margin-bottom:14px"><div class="panel-head"><h2>Connect GitHub to edit</h2></div>
        <p class="small muted" style="margin:0 0 8px">Read-only until connected. Create a <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">fine-grained token ↗</a>: repository access <b>only ${esc(GH.repo)}</b>, permission <b>Contents: Read and write</b>, short expiry. Paste it here once per device; it stays in this browser and is only sent to api.github.com.</p>
        <div class="form-actions"><input type="password" id="gh-token" placeholder="github_pat_…" autocomplete="off" style="flex:1;min-width:200px"><button class="btn primary" data-act="token">Connect</button></div></section>`);

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
    if (!ghToken.get()) { msg = '<span class="error">Connect GitHub first.</span>'; draw(); return; }
    msg = 'Saving…'; draw();
    try {
      const res = await ghUpdate('killswitches', change, `Kill switch: ${label} (desk)`);
      data = res.data; editing = null;
      msg = `Saved to GitHub (commit ${esc(res.commit || '')}). Shows here right away; the Pages copy catches up on the next deploy.`;
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

// Correlation (-1..1) as a small chart: zero line, ±0.5 guides, 60d line (accent) + 20d (faint).
function corrSpark(history, w = 140, h = 34) {
  const y = (v) => h / 2 - v * (h / 2 - 3);
  const pts = (key) => { const arr = history.filter((p) => p[key] != null); return arr.map((p, i) => [(i / Math.max(arr.length - 1, 1)) * (w - 4) + 2, y(p[key])]); };
  const line = (p) => p.map((q) => q.map((n) => n.toFixed(1)).join(',')).join(' ');
  const p60 = pts('r60'), p20 = pts('r20');
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">
    <line x1="0" x2="${w}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}" stroke="var(--line)"/>
    <line x1="0" x2="${w}" y1="${y(0.5).toFixed(1)}" y2="${y(0.5).toFixed(1)}" stroke="var(--line)" stroke-dasharray="2 3"/>
    <line x1="0" x2="${w}" y1="${y(-0.5).toFixed(1)}" y2="${y(-0.5).toFixed(1)}" stroke="var(--line)" stroke-dasharray="2 3"/>
    ${p20.length > 1 ? `<polyline points="${line(p20)}" fill="none" stroke="var(--faint)" stroke-width="1"/>` : ''}
    ${p60.length > 1 ? `<polyline points="${line(p60)}" fill="none" stroke="var(--accent)" stroke-width="1.6"/><circle cx="${p60.at(-1)[0].toFixed(1)}" cy="${p60.at(-1)[1].toFixed(1)}" r="2.5" fill="var(--accent)"/>` : ''}
  </svg>`;
}
const CORR_TONE = { strong: 'bull', moderate: 'flat', weak: 'warn', flipped: 'bear', 'no data': 'flat' };
const rNum = (r) => (r == null ? '<span class="faint">—</span>' : `<span class="num ${Math.abs(r) >= 0.5 ? '' : 'muted'}">${r > 0 ? '+' : ''}${r.toFixed(2)}</span>`);

render.drivers = async (main) => {
  const [data, cor] = await Promise.all([load('drivers'), load('correlations').catch(() => null)]);
  const pairs = cor?.pairs || [];
  const byId = Object.fromEntries(pairs.map((p) => [p.id, p]));
  const pairName = (p) => `${p.labelA} / ${p.labelB}`;
  const related = (ccy) => pairs.filter((p) => p.drivers.includes(ccy));
  const driverRows = data.drivers.map((d) => {
    const live = d.corrId && byId[d.corrId]?.r60 != null ? byId[d.corrId] : null;
    return `<tr id="drv-${d.currency}">
      <td><span class="ccy">${d.currency}</span></td><td>${esc(d.driver)}<div class="small faint">${esc(d.symbol)}</div></td>
      <td class="small muted">${esc(live ? pairName(live) : d.measure)}</td><td class="num">${esc(d.move1m)}</td>
      <td>${live ? rNum(live.r20) : rNum(d.corr20)}</td><td>${live ? rNum(live.r60) : rNum(d.corr60)}</td>
      <td class="small nowrap">${live ? `<span class="pill bull">live</span> <span class="faint">${live.change1m == null ? '' : `1m ${live.change1m > 0 ? '+' : ''}${live.change1m.toFixed(2)}`}</span>` : '<span class="pill flat">manual</span>'}</td>
      <td>${effectPill(d.effect)}</td>
      <td class="small">${related(d.currency).map((p) => `<a class="chip-link" href="#corr-${p.id}" title="${esc(pairName(p))}">${esc(p.a)}·${esc(p.b)}</a>`).join(' ') || '<span class="faint">—</span>'}</td>
      <td class="small muted">${esc(d.secondOrder)}</td></tr>`;
  }).join('');

  const corrSection = () => {
    if (!cor) return '<section class="panel"><div class="empty">Correlation data not built yet (npm run correlations).</div></section>';
    const filters = ['All', ...CCYS, 'XAU'].filter((c) => c === 'All' || related(c).length);
    return `<div class="page-head" style="margin-top:22px"><div><h1 style="font-size:20px">Correlation pairs</h1><p>Pairs that normally move together or against each other, how strongly right now, and how that changed over 6 months. Watch for weakening or flipped links before trusting a driver.</p></div>
        <span class="small faint">as of ${fmtDate(cor.asOf)}</span></div>
      <div class="note">${esc(cor.method)}${cor.missing?.length ? ` No free daily feed yet: ${esc(cor.missing.join(', '))}.` : ''}</div>
      <div class="filters" id="corr-filter">${filters.map((c) => `<button class="chip" data-ccy="${c}">${c}</button>`).join('')}</div>
      <section class="panel"><div class="table-wrap"><table>
        <thead><tr><th>Pair</th><th>Usually</th><th>r 20d</th><th>r 60d</th><th>60d a month ago</th><th>6-month history</th><th>Strength</th><th>Shift</th><th>Drivers</th></tr></thead>
        <tbody id="corr-rows"></tbody></table></div>
        <p class="small faint" style="margin:8px 0 0">Chart: blue = 60-day, grey = 20-day; middle line = 0, dashed = ±0.5.</p></section>`;
  };
  const drawCorr = (ccy) => {
    const rows = pairs.filter((p) => ccy === 'All' || p.drivers.includes(ccy));
    $('#corr-rows').innerHTML = rows.map((p) => `<tr id="corr-${p.id}">
      <td><b>${esc(pairName(p))}</b><div class="small faint">${esc(p.why)}</div></td>
      <td class="small nowrap">${p.typical === 'inverse' ? '↕ opposite' : '⇈ together'}</td>
      <td>${rNum(p.r20)}</td><td>${rNum(p.r60)}</td>
      <td class="nowrap">${rNum(p.r60MonthAgo)} ${p.change1m == null ? '' : `<span class="small ${Math.abs(p.change1m) >= 0.2 ? '' : 'faint'}">(${p.change1m > 0 ? '+' : ''}${p.change1m.toFixed(2)})</span>`}</td>
      <td>${p.history?.length ? corrSpark(p.history) : '—'}</td>
      <td><span class="pill ${CORR_TONE[p.status] || 'flat'}">${esc(p.status)}</span></td>
      <td class="small">${esc(p.shift || '—')}</td>
      <td class="small">${p.drivers.map((c) => (data.drivers.some((d) => d.currency === c) ? `<a class="chip-link" href="#drv-${c}">${c}</a>` : `<span class="ccy">${c}</span>`)).join(' ')}${p.driverOf ? ' <span class="faint">(driver)</span>' : ''}</td>
    </tr>`).join('');
    main.querySelectorAll('#corr-filter .chip').forEach((b) => b.classList.toggle('on', b.dataset.ccy === ccy));
  };

  main.innerHTML = head('Drivers', 'Each currency\'s main outside driver, how tightly price follows it right now, and whether it backs or fights my bias.') +
    `<div class="note">${esc(data.rule)} Rows marked <b>live</b> use the daily correlation feed; <b>manual</b> rows have no free daily data yet.</div>
    <section class="panel"><div class="table-wrap"><table>
      <thead><tr><th>Ccy</th><th>Driver</th><th>Measured as</th><th>1m move</th><th>Corr 20d</th><th>Corr 60d</th><th>Feed</th><th>vs my bias</th><th>Related pairs</th><th>Second-order effect</th></tr></thead>
      <tbody>${driverRows}</tbody></table></div></section>
    <p class="small faint">Commodities: ${esc(data.commodities.note)}</p>` + corrSection();
  if (cor) {
    drawCorr('All');
    $('#corr-filter').addEventListener('click', (ev) => { const b = ev.target.closest('[data-ccy]'); if (b) drawCorr(b.dataset.ccy); });
    main.addEventListener('click', (ev) => { // a related-pair link whose row is filtered out: show all first
      const a = ev.target.closest('a[href^="#corr-"]'); if (a && !document.getElementById(a.getAttribute('href').slice(1))) drawCorr('All');
    });
  }
};

render.review = async (main) => {
  const data = await load('history');
  const stats = {};
  for (const h of data.changes) {
    const s = (stats[h.currency] ||= { n: 0, hit1: 0, g1: 0, hit4: 0, g4: 0 });
    s.n++;
    if (h.grade1w) { s.g1++; if (h.grade1w === 'hit') s.hit1++; }
    if (h.grade4w) { s.g4++; if (h.grade4w === 'hit') s.hit4++; }
  }
  const rate = (hit, n) => (n ? `${Math.round((hit / n) * 100)}% <span class="faint">(${n})</span>` : '<span class="faint">—</span>');
  const grade = (g) => (g ? `<span class="pill ${g === 'hit' ? 'bull' : 'bear'}">${g}</span>` : '<span class="faint">pending</span>');
  main.innerHTML = head('Review', 'Every bias change, why it changed, and whether it was right afterwards.') +
    `<div class="note">${esc(data.method)}</div>
    <div class="grid hub-grid">
      <section class="panel span-2"><div class="panel-head"><h2>Bias change log</h2></div><div class="table-wrap"><table>
        <thead><tr><th>Date</th><th>Ccy</th><th>Layer</th><th>Change</th><th>Kind</th><th>Reason</th><th>1w</th><th>4w</th></tr></thead>
        <tbody>${data.changes.map((h) => `<tr>
          <td class="nowrap small">${fmtDate(h.date)}</td><td><span class="ccy">${h.currency}</span></td>
          <td class="small">${esc(h.layer)}</td><td class="num nowrap">${esc(String(h.from))} → ${esc(String(h.to))}</td>
          <td class="small">${esc(h.kind)}</td><td class="small">${esc(h.reason)}</td>
          <td>${grade(h.grade1w)}</td><td>${grade(h.grade4w)}</td></tr>`).join('')}</tbody></table></div></section>
      <section class="panel"><div class="panel-head"><h2>Hit rate by currency</h2></div><table>
        <thead><tr><th>Ccy</th><th>Changes</th><th>1w</th><th>4w</th></tr></thead>
        <tbody>${CCYS.filter((c) => stats[c]).map((c) => `<tr><td><span class="ccy">${c}</span></td><td class="num">${stats[c].n}</td><td class="num">${rate(stats[c].hit1, stats[c].g1)}</td><td class="num">${rate(stats[c].hit4, stats[c].g4)}</td></tr>`).join('')}</tbody></table></section>
    </div>`;
};

// ---------- weekly recap ----------
const SCARE_TONE = { inflation: 'bear', growth: 'warn', both: 'bear', neither: 'bull', mixed: 'flat' };
const scarePill = (s) => `<span class="pill ${SCARE_TONE[s] || 'flat'}">${esc(s === 'neither' ? 'no scare' : s === 'both' ? 'both scares' : s === 'mixed' ? 'mixed' : s + ' scare')}</span>`;
// Regime quadrant from direction of growth and inflation ("flat" counts as not up / not down).
const QUADS = {
  overheating: { label: 'Overheating', scare: 'inflation', row: 0, col: 1 },
  stagflation: { label: 'Stagflation', scare: 'both', row: 0, col: 0 },
  slowdown: { label: 'Slowdown', scare: 'growth', row: 1, col: 0 },
  goldilocks: { label: 'Goldilocks', scare: 'neither', row: 1, col: 1 },
};
function quadrantOf(regime) {
  const infUp = regime.inflation === 'up' || regime.inflation === 'sticky';
  const growthDown = regime.growth === 'down';
  return infUp ? (growthDown ? 'stagflation' : 'overheating') : (growthDown ? 'slowdown' : 'goldilocks');
}
function regimeMap(economies, highlight) {
  const cells = Object.entries(QUADS).sort((a, b) => a[1].row - b[1].row || a[1].col - b[1].col).map(([id, q]) => {
    const here = economies.filter((e) => quadrantOf(e.regime) === id);
    return `<div class="quad ${SCARE_TONE[q.scare]}-q">
      <div class="quad-label">${q.label}<span>${q.scare === 'neither' ? 'no scare' : q.scare === 'both' ? 'both scares' : q.scare + ' scare'}</span></div>
      <div class="quad-ccys">${here.map((e) => `<a href="#${e.code}" class="ccy ${highlight && highlight !== e.code ? 'dim' : ''}">${e.code}</a>`).join('')}</div></div>`;
  }).join('');
  return `<div class="regime"><div class="axis-y">Inflation ↑</div><div class="quads">${cells}</div><div class="axis-x">Growth weak ← → Growth firm</div></div>`;
}
function sparkline(values, w = 92, h = 26) {
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * (w - 4) + 2, h - 3 - ((v - min) / span) * (h - 6)]);
  const [lx, ly] = pts.at(-1);
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">
    <polyline points="${pts.map((p) => p.map((n) => n.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="var(--accent)" stroke-width="1.5"/>
    <circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="2.5" fill="var(--accent)"/></svg>`;
}
function trendWord(values) {
  const n = values.length, recent = values.slice(-3).reduce((a, b) => a + b, 0) / 3, earlier = values.slice(0, 3).reduce((a, b) => a + b, 0) / 3;
  const d = recent - earlier, scale = Math.max(Math.abs(earlier), 1) * 0.02;
  return n < 4 ? '—' : d > scale ? '↑ rising' : d < -scale ? '↓ falling' : '→ flat';
}
// Economy Read Chain: Releases (days) -> Themes (weeks) -> Rates & Yields (months) -> Performance.
// Colour = impact on the currency, not the economy: impact "up" means a rise supports the currency,
// "down" means a fall does (unemployment, claims). Green = supportive / hawkish, red = negative / dovish.
const BUCKETS = [['inflation', 'Inflation'], ['growth', 'Growth'], ['labour', 'Labour']];
function impactOf(r) {
  const d = r.latest - r.prior;
  if (r.prior == null || d === 0) return { cls: 'flat', arrow: '–' };
  const good = r.impact === 'down' ? d < 0 : d > 0;
  return { cls: good ? 'bull' : 'bear', arrow: d > 0 ? '▲' : '▼' };
}
function chainTable(title, horizon, layer) {
  const fmt = (v, u) => (v == null ? '—' : `${v}${u || ''}`);
  const groups = BUCKETS.filter(([k]) => layer?.[k]?.length);
  if (!groups.length) return '';
  const body = groups.map(([k, label]) => `<tr class="group"><th colspan="7">${label}</th></tr>` + layer[k].map((r) => {
    const d = r.expected == null ? null : +(r.latest - r.expected).toFixed(2);
    const im = impactOf(r);
    return `<tr><td>${esc(r.name)}</td><td class="num"><span class="pill ${im.cls}">${esc(fmt(r.latest, r.unit))} ${im.arrow}</span></td>
      <td class="num muted">${esc(fmt(r.prior, r.unit))}</td><td class="num muted">${esc(fmt(r.expected, r.unit))}</td>
      <td class="num">${d == null ? '—' : d === 0 ? '<span class="faint">inline</span>' : `${d > 0 ? '+' : ''}${d}`}</td>
      <td class="nowrap">${sparkline(r.trend)} <span class="small muted">${trendWord(r.trend)}</span></td>
      <td class="small">${r.source ? `<a href="${esc(r.source.url)}" target="_blank" rel="noopener">${esc(r.source.name)} ↗</a>` : '—'}</td></tr>`;
  }).join('')).join('');
  return `<section class="panel span-3"><div class="panel-head"><h2>${esc(title)} <span class="faint small">· ${esc(horizon)}</span></h2></div><div class="table-wrap"><table class="chain">
    <thead><tr><th>Indicator</th><th>Latest</th><th>Prior</th><th>Expected</th><th>vs exp.</th><th>6-period trend</th><th>Source</th></tr></thead>
    <tbody>${body}</tbody></table></div></section>`;
}
function ratesPanel(e) {
  const r = e.rates; if (!r) return '';
  const mv = r.statement.nextMove, mvCls = mv === 'Hike' ? 'bull' : mv === 'Cut' ? 'bear' : 'flat';
  const chg = (n) => `<span class="small ${tone(n)}" style="background:none">${bp(n)}</span>`;
  return `<section class="panel"><div class="panel-head"><h2>Rates &amp; Yields <span class="faint small">· months</span></h2></div>
    <div class="kv" style="grid-template-columns:repeat(3,1fr)">
      <div><label>2Y yield</label><span>${r.y2.level.toFixed(2)}% ${chg(r.y2.chgBp)}</span></div>
      <div><label>10Y yield</label><span>${r.y10.level.toFixed(2)}% ${chg(r.y10.chgBp)}</span></div>
      <div><label>Policy rate</label><span>${r.policy.toFixed(2)}%</span></div>
    </div>
    <p class="small" style="margin:10px 0 0">Policy statement: est. next move <span class="pill ${mvCls}">${esc(mv)}</span> · ${esc(r.statement.conviction)} conviction
      ${r.statement.url ? ` · <a href="${esc(r.statement.url)}" target="_blank" rel="noopener">${esc(e.cb)} ↗</a>` : ''}</p></section>`;
}
function performancePanel(e) {
  const p = e.performance; if (!p) return '';
  const s = p.spread2yPolicyBp;
  return `<section class="panel"><div class="panel-head"><h2>Performance</h2></div>
    <div class="kv" style="grid-template-columns:repeat(3,1fr)">
      <div><label>Strength rank</label><span>${p.rank} of ${p.of}</span></div>
      <div><label>Currency (week)</label><span class="${tone(e.week.currencyPct)}" style="background:none">${e.week.currencyPct > 0 ? '+' : ''}${e.week.currencyPct.toFixed(1)}%</span></div>
      <div><label>2Y vs policy</label><span class="${tone(s)}" style="background:none">${bp(s)}</span></div>
    </div>
    <p class="small muted" style="margin:10px 0 0">2Y above policy = market prices higher rates than today; below = cuts priced. Has price caught up with the read?</p></section>`;
}

render.recap = async (main) => {
  const index = await load('recaps/index');
  if (!index.recaps.length) { main.innerHTML = head('Weekly Recap', '') + '<p class="empty">No recaps yet.</p>'; return; }
  const params = new URLSearchParams(location.search);
  const chosen = index.recaps.find((r) => r.sunday === params.get('week')) || index.recaps[0];
  const [recap, ks] = await Promise.all([load(`recaps/${chosen.file.replace(/\.json$/, '')}`), loadLive('killswitches')]);
  const kills = Object.fromEntries(ks.killSwitches.map((k) => [k.id, k]));
  const weekPicker = `<select id="week">${index.recaps.map((r) => `<option value="${r.sunday}" ${r === chosen ? 'selected' : ''}>${esc(r.week)} · Sun ${fmtDate(r.sunday)}</option>`).join('')}</select>`;

  const overview = () => {
    const o = recap.overview;
    const perf = [...recap.economies].sort((a, b) => b.week.currencyPct - a.week.currencyPct);
    const maxAbs = Math.max(...perf.map((e) => Math.abs(e.week.currencyPct)), 0.1);
    const perfBars = `<div class="bars">${perf.map((e) => {
      const v = e.week.currencyPct, pct = (Math.abs(v) / maxAbs) * 50;
      return `<div class="bar-row"><a class="ccy" href="#${e.code}">${e.code}</a><div class="bar-track"><div class="bar-fill" style="left:${v >= 0 ? 50 : 50 - pct}%;width:${Math.max(pct, 1)}%;background:${v >= 0 ? 'var(--bull)' : 'var(--bear)'}"></div></div><span class="num small">${v > 0 ? '+' : ''}${v.toFixed(1)}%</span></div>`;
    }).join('')}</div><p class="small faint">Currency vs basket of the other majors, Mon open to Fri close.</p>`;
    const steps = `<div class="note">${esc(recap.process.note)}</div><ol class="steps">${recap.process.steps.map((s) => `<li>${esc(s.label)}</li>`).join('')}</ol>`;
    return `<div class="grid hub-grid">
      <section class="panel brief span-2"><div class="panel-head"><h2>The week · ${fmtDate(recap.period.start)} – ${fmtDate(recap.period.end)}</h2>${scarePill(o.globalScare)}</div>
        <h2 class="headline">${esc(o.headline)}</h2><ul class="bullets">${o.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul></section>
      ${panel('Currency performance', perfBars)}
      <section class="panel span-2"><div class="panel-head"><h2>Regime map · where each economy sits</h2></div>${regimeMap(recap.economies)}</section>
      ${panel('Economies', `<ul class="list">${recap.economies.map((e) => `<li><a class="ccy" href="#${e.code}">${e.code}</a><span class="grow small muted">${QUADS[quadrantOf(e.regime)].label}</span>${scarePill(e.scare)}</li>`).join('')}</ul>`)}
      ${panel('Kill switches fired', `<ul class="list">${o.killSwitchesFired.map((id) => { const k = kills[id]; return k ? `<li><span class="ccy">${k.currency}</span><span class="grow small">${esc(k.condition)}</span><span class="pill flat">${esc(k.effect)}</span></li>` : `<li class="small">${esc(id)}</li>`; }).join('') || '<div class="empty">None</div>'}</ul>`, { href: 'kill-switches.html', label: 'Kill switches' })}
      ${panel('Next week · watch', `<ul class="list">${o.nextWeekTop.map((x) => `<li class="small">${esc(x)}</li>`).join('')}</ul>`)}
      ${panel(`Method · ${recap.process.status}`, steps)}
    </div>`;
  };

  const economy = (e) => {
    const cbp = e.centralBank, moved = cbp.pricedEndBp - cbp.pricedStartBp, gap = cbp.myPathBp - cbp.pricedEndBp;
    const q = QUADS[quadrantOf(e.regime)];
    const bc = e.week.biasChange;
    return `<div class="grid hub-grid">
      <section class="panel brief span-2"><div class="panel-head"><h2>${esc(e.name)} · ${esc(e.cb)}</h2>${scarePill(e.scare)}</div>
        <h2 class="headline">${esc(e.verdict)}</h2>
        <div class="kv">
          <div><label>Growth</label><span>${esc(e.regime.growth)}</span></div>
          <div><label>Inflation</label><span>${esc(e.regime.inflation)}</span></div>
          <div><label>Regime</label><span>${q.label}</span></div>
          <div><label>Currency (week)</label><span class="${e.week.currencyPct >= 0 ? 'bull' : 'bear'}" style="background:none">${e.week.currencyPct > 0 ? '+' : ''}${e.week.currencyPct.toFixed(1)}%</span></div>
          <div><label>Bias change</label><span>${bc ? `${sign(bc.from)} → ${sign(bc.to)}` : 'none'}</span></div>
          <div><label>Next ${esc(e.cb)}</label><span>${fmtDate(cbp.nextMeeting)}</span></div>
        </div>
        ${bc ? `<p class="small muted" style="margin:10px 0 0">Bias: ${esc(bc.why)}</p>` : ''}</section>
      <section class="panel"><div class="panel-head"><h2>Regime</h2></div>${regimeMap(recap.economies, e.code)}</section>
      <div class="span-3 chain-flow small faint">Read in order: Releases (days) → Themes (weeks) → Rates &amp; Yields (months) → Performance. Green / red = impact on the currency.</div>
      ${chainTable('Releases', 'days', e.releases)}
      ${chainTable('Themes', 'weeks', e.themes)}
      ${ratesPanel(e)}
      ${performancePanel(e)}
      <section class="panel"><div class="panel-head"><h2>Central bank · my path vs priced</h2><span class="pill ${e.centralBank.stance === 'hawkish' ? 'bull' : e.centralBank.stance === 'dovish' ? 'bear' : 'flat'}">${esc(cbp.stance)}</span></div>
        <div class="kv" style="grid-template-columns:repeat(2,1fr)">
          <div><label>Priced Mon</label><span>${bp(cbp.pricedStartBp)}</span></div>
          <div><label>Priced Fri</label><span>${bp(cbp.pricedEndBp)}</span></div>
          <div><label>Repricing</label><span class="${tone(moved)}" style="background:none">${bp(moved)} ${gapWord(moved)}</span></div>
          <div><label>My path</label><span>${bp(cbp.myPathBp)}</span></div>
        </div><p class="small muted" style="margin:10px 0 0">Gap after the week: <span class="num ${tone(gap)}" style="background:none">${bp(gap)} ${gapWord(gap)}</span></p></section>
      ${panel('This week', `<ul class="bullets" style="margin:0;padding-left:18px">${e.week.takeaways.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`)}
      ${panel('Next week', `<ul class="list">${e.nextWeek.map((x) => `<li class="small">${esc(x)}</li>`).join('')}</ul>`)}
      <section class="panel span-3"><div class="panel-head"><h2>Method · ${esc(recap.process.status)}</h2></div>
        <ol class="steps">${recap.process.steps.map((s) => `<li>${esc(s.label)}<div class="small faint">${esc(e.process?.[s.id] || 'Read goes here once the method is set.')}</div></li>`).join('')}</ol></section>
    </div>`;
  };

  const tabs = () => `<div class="filters tabs">${['Overview', ...recap.economies.map((e) => e.code)].map((t) => `<a class="chip" data-tab="${t}" href="#${t === 'Overview' ? '' : t}">${t}</a>`).join('')}</div><div id="recap-body"></div>`;
  main.innerHTML = head(`Weekly Recap · ${recap.week}`, `Sunday read: ${fmtDate(recap.period.start)} – ${fmtDate(recap.period.end)}. Overview first, then one tab per economy.`, weekPicker) + tabs();

  const draw = () => {
    const code = location.hash.slice(1);
    const e = recap.economies.find((x) => x.code === code);
    main.querySelectorAll('[data-tab]').forEach((a) => a.classList.toggle('on', a.dataset.tab === (e ? e.code : 'Overview')));
    $('#recap-body').innerHTML = e ? economy(e) : overview();
  };
  window.addEventListener('hashchange', () => { draw(); window.scrollTo(0, 0); });
  $('#week').addEventListener('change', (ev) => { location.search = `?week=${ev.target.value}`; });
  draw();
};

// ---------- boot ----------
(async () => {
  const page = document.body.dataset.page;
  const main = document.createElement('main');
  document.body.appendChild(main);
  let mock = true, asOf = '';
  try {
    const b = await load('brief');
    mock = !!b.mock; asOf = b.date;
  } catch { /* shell still renders */ }
  shell(page, asOf, mock);
  try {
    await render[page](main);
  } catch (err) {
    const hint = location.protocol === 'file:' ? ' Open through a web server (e.g. npm run desk), not as a file.' : '';
    main.innerHTML = `<p class="error">Could not load this page: ${esc(err.message)}.${hint}</p>`;
  }
})();
