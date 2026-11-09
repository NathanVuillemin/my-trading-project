// Trading Desk: shared shell + page renderers.
// Every page is a thin HTML file with <body data-page="...">; this script draws the
// nav bar and the page from JSON in ./data/. Mock files carry "mock": true and the
// shell shows a banner. Live pipelines later overwrite the same files, same shape.

const PAGES = [
  { id: 'hub', href: 'index.html', label: 'Hub' },
  { id: 'recap', href: 'weekly-recap.html', label: 'Weekly Recap' },
  { id: 'bias', href: 'bias.html', label: 'Bias' },
  { id: 'events', href: 'events.html', label: 'Events' },
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
const IMPACT_TONE = { high: 'bear', medium: 'warn', low: 'flat' };
const impactPill = (i) => `<span class="pill ${IMPACT_TONE[i] || 'flat'}">${esc(i)}</span>`;
const fmtDate = (iso) => new Date(iso + (iso.length === 10 ? 'T12:00:00Z' : '')).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const fmtTime = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
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
      <nav class="nav">${nav}<a class="ext" href="../bias.html" title="Old V5 model board">Model ↗</a></nav>
      <span class="asof">${asOf ? 'as of ' + esc(asOf) : ''}</span>
    </div></header>
    ${mock ? '<div class="mockbar">MOCK DATA: architecture preview. Nothing here is live or real.</div>' : ''}`);
}
function head(title, blurb, right = '') {
  return `<div class="page-head"><div><h1>${esc(title)}</h1>${blurb ? `<p>${blurb}</p>` : ''}</div>${right}</div>`;
}
function panel(title, body, link) {
  return `<section class="panel"><div class="panel-head"><h2>${esc(title)}</h2>${link ? `<a href="${link.href}">${esc(link.label)} →</a>` : ''}</div>${body}</section>`;
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
  const [brief, bias, events, killswitches, drivers, levels, history, recapIndex] = await Promise.all(
    ['brief', 'bias', 'events', 'killswitches', 'drivers', 'levels', 'history', 'recaps/index'].map(load));
  const latest = recapIndex.recaps[0];
  const recap = latest ? await load(`recaps/${latest.file.replace(/\.json$/, '')}`) : null;
  const now = new Date(brief.date + 'T00:00:00Z');
  const upcoming = events.events.filter((e) => new Date(e.time) >= now).sort((a, b) => a.time.localeCompare(b.time)).slice(0, 6);
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
      ${panel('Next events', `<ul class="list">${upcoming.map((e) => `<li><span class="ccy">${e.currency}</span><span class="grow">${esc(e.name)}<div class="small faint">${fmtDate(e.time)} · ${fmtTime(e.time)}</div></span>${impactPill(e.impact)}</li>`).join('')}</ul>`, { href: 'events.html', label: 'Events' })}
      ${panel('Kill switches fired / near', `<ul class="list">${hotKills.map((t) => `<li><span class="ccy">${t.currency}</span><span class="grow">${esc(t.condition)}<div class="small faint">${esc(t.now)}</div></span>${trigPill(t.status)}</li>`).join('') || '<div class="empty">None</div>'}</ul>`, { href: 'kill-switches.html', label: 'Kill switches' })}
      ${panel('Driver conflicts', `<ul class="list">${conflicts.map((d) => `<li><span class="ccy">${d.currency}</span><span class="grow">${esc(d.driver)} <span class="num muted">${esc(d.move1m)}</span><div class="small faint">60d corr <span class="num">${d.corr60.toFixed(2)}</span></div></span>${effectPill(d.effect)}</li>`).join('') || '<div class="empty">None</div>'}</ul>`, { href: 'drivers.html', label: 'Drivers' })}
      ${panel('Key levels', `<ul class="list">${levels.levels.slice(0, 4).map((l) => `<li><span class="ccy">${esc(l.instrument)}</span><span class="grow"><span class="num">${esc(l.level)}</span> · ${esc(l.type)}<div class="small faint">price <span class="num">${esc(l.price)}</span></div></span><span class="pill flat">${esc(l.status)}</span></li>`).join('')}</ul>`, { href: 'levels.html', label: 'Levels' })}
      ${panel('Recent bias changes', `<ul class="list">${history.changes.slice(0, 4).map((h) => `<li><span class="ccy">${h.currency}</span><span class="grow">${esc(h.reason)}<div class="small faint">${fmtDate(h.date)} · ${esc(h.layer)}</div></span><span class="num small">${esc(String(h.from))} → ${esc(String(h.to))}</span></li>`).join('')}</ul>`, { href: 'review.html', label: 'Review' })}
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

render.events = async (main) => {
  const data = await load('events');
  const brief = await load('brief');
  const now = new Date(brief.date + 'T00:00:00Z');
  const state = { ccys: new Set(), type: '', impact: '', when: 'upcoming' };
  const params = new URLSearchParams(location.search);
  if (params.get('ccy')) state.ccys.add(params.get('ccy'));

  main.innerHTML = head('Events', 'Each release: what it is, which currencies it moves and how, and a link to the official page where it was (or will be) published.') +
    `<div class="filters" id="f">
      ${CCYS.map((c) => `<button class="chip" data-ccy="${c}">${c}</button>`).join('')}
      <button class="chip" disabled title="Commodities come later">Commodities (soon)</button>
      <span class="sep"></span>
      <select id="ftype"><option value="">All types</option>${data.types.map((t) => `<option>${t}</option>`).join('')}</select>
      <select id="fimp"><option value="">All impact</option><option>high</option><option>medium</option><option>low</option></select>
      <span class="sep"></span>
      ${['upcoming', 'past', 'all'].map((w) => `<button class="chip" data-when="${w}">${w}</button>`).join('')}
    </div>
    <section class="panel"><div class="table-wrap"><table>
      <thead><tr><th>Date</th><th>Ccy</th><th>Type</th><th>Event</th><th>Impact</th><th class="nowrap">Prev</th><th class="nowrap">Fcst</th><th class="nowrap">Actual</th><th>Source</th></tr></thead>
      <tbody id="rows"></tbody></table></div></section>`;

  const draw = () => {
    $('#f').querySelectorAll('[data-ccy]').forEach((b) => b.classList.toggle('on', state.ccys.has(b.dataset.ccy)));
    $('#f').querySelectorAll('[data-when]').forEach((b) => b.classList.toggle('on', state.when === b.dataset.when));
    const rows = data.events
      .filter((e) => !state.ccys.size || state.ccys.has(e.currency) || Object.keys(e.affects).some((k) => state.ccys.has(k)))
      .filter((e) => !state.type || e.type === state.type)
      .filter((e) => !state.impact || e.impact === state.impact)
      .filter((e) => state.when === 'all' || (state.when === 'past') === (new Date(e.time) < now))
      .sort((a, b) => (state.when === 'past' ? b.time.localeCompare(a.time) : a.time.localeCompare(b.time)));
    $('#rows').innerHTML = rows.map((e) => {
      const past = new Date(e.time) < now;
      const surpriseTone = { beat: 'bull', miss: 'bear', inline: 'flat' }[e.surprise];
      return `<tr class="${past ? 'past' : ''}">
        <td class="nowrap">${fmtDate(e.time)}<div class="small faint">${fmtTime(e.time)}</div></td>
        <td><span class="ccy">${e.currency}</span></td>
        <td class="small">${esc(e.type)}</td>
        <td>${esc(e.name)}${e.killSwitch ? ` <a class="pill warn" href="kill-switches.html" title="Linked to a kill switch">kill switch</a>` : ''}
          <div class="affects">${Object.entries(e.affects).map(([k, v]) => `<span><b>${k}</b> ${esc(v)}</span>`).join('')}</div></td>
        <td>${impactPill(e.impact)}</td>
        <td class="num nowrap">${esc(e.previous ?? '—')}</td>
        <td class="num nowrap">${esc(e.forecast ?? '—')}</td>
        <td class="num nowrap">${e.actual ? `${esc(e.actual)} ${surpriseTone ? `<span class="pill ${surpriseTone}">${esc(e.surprise)}</span>` : ''}` : '<span class="faint">—</span>'}</td>
        <td class="small">${e.source ? `<a href="${esc(e.source.url)}" target="_blank" rel="noopener">${past ? 'Release' : 'Where it publishes'} ↗</a><div class="faint">${esc(e.source.name)}</div>` : '—'}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="9" class="empty">No events match.</td></tr>';
  };
  $('#f').addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.ccy) state.ccys.has(b.dataset.ccy) ? state.ccys.delete(b.dataset.ccy) : state.ccys.add(b.dataset.ccy);
    if (b.dataset.when) state.when = b.dataset.when;
    draw();
  });
  $('#ftype').addEventListener('change', (ev) => { state.type = ev.target.value; draw(); });
  $('#fimp').addEventListener('change', (ev) => { state.impact = ev.target.value; draw(); });
  draw();
};

render.levels = async (main) => {
  const data = await load('levels');
  main.innerHTML = head('Key Levels', 'Where big players have shown their hand. <span class="pill warn">draft layout</span>') +
    `<div class="note">${esc(data.note)}</div>
    <section class="panel"><div class="table-wrap"><table>
      <thead><tr><th>Instrument</th><th>Level</th><th>Price now</th><th>Type</th><th>Who</th><th>Side</th><th>Evidence</th><th>Status</th><th>Last touch</th><th>Source</th></tr></thead>
      <tbody>${data.levels.map((l) => `<tr>
        <td><span class="ccy">${esc(l.instrument)}</span></td>
        <td class="num">${esc(l.level)}</td><td class="num muted">${esc(l.price)}</td>
        <td><span class="pill flat" title="${esc(data.types[l.type] || '')}">${esc(l.type)}</span></td>
        <td class="small">${esc(l.who)}</td><td class="small">${esc(l.side)}</td>
        <td class="small muted">${esc(l.evidence)}</td>
        <td><span class="pill ${l.status === 'defended' ? 'bull' : l.status === 'broken' ? 'bear' : 'flat'}">${esc(l.status)}</span></td>
        <td class="small nowrap">${l.lastTouch === '—' ? '—' : fmtDate(l.lastTouch)}</td>
        <td class="small">${l.source ? `<a href="${esc(l.source.url)}" target="_blank" rel="noopener">${esc(l.source.name)} ↗</a>` : '<span class="faint">—</span>'}</td>
      </tr>`).join('')}</tbody></table></div></section>
    <div style="margin-top:14px">${panel('Level types', `<ul class="list">${Object.entries(data.types).map(([k, v]) => `<li><span class="pill flat">${esc(k)}</span><span class="grow small muted">${esc(v)}</span></li>`).join('')}</ul>`)}</div>`;
};

render.killswitches = async (main) => {
  const data = await load('killswitches');
  const want = new URLSearchParams(location.search).get('ccy');
  const order = { fired: 0, near: 1, armed: 2 };
  const list = data.killSwitches.filter((t) => !want || t.currency === want).sort((a, b) => order[a.status] - order[b.status]);
  main.innerHTML = head('Kill Switches', 'What kills or changes my bias. Each kill switch = condition + effect on the bias.' + (want ? ` Showing <b>${esc(want)}</b> · <a href="kill-switches.html">show all</a>` : '')) +
    `<section class="panel"><div class="table-wrap"><table>
      <thead><tr><th>Status</th><th>Ccy</th><th>Kind</th><th>Condition</th><th>Now</th><th>Effect</th><th>Fired</th></tr></thead>
      <tbody>${list.map((t) => `<tr>
        <td>${trigPill(t.status)}</td><td><span class="ccy">${t.currency}</span></td>
        <td class="small" title="${esc(data.kinds[t.kind])}">${esc(t.kind)}</td>
        <td>${esc(t.condition)}${t.event ? ` <a class="small" href="events.html?ccy=${t.currency}">event</a>` : ''}</td>
        <td class="small num muted">${esc(t.now)}</td>
        <td><span class="pill flat" title="${esc(data.effects[t.effect])}">${esc(t.effect)}</span></td>
        <td class="small nowrap">${t.firedOn ? fmtDate(t.firedOn) : '—'}</td>
      </tr>`).join('')}</tbody></table></div></section>
    <div class="grid hub-grid" style="margin-top:14px">
      ${panel('Kill switch kinds', `<ul class="list">${Object.entries(data.kinds).map(([k, v]) => `<li><b class="small">${esc(k)}</b><span class="grow small muted">${esc(v)}</span></li>`).join('')}</ul>`)}
      ${panel('Effects', `<ul class="list">${Object.entries(data.effects).map(([k, v]) => `<li><span class="pill flat">${esc(k)}</span><span class="grow small muted">${esc(v)}</span></li>`).join('')}</ul>`)}
    </div>`;
};

render.drivers = async (main) => {
  const data = await load('drivers');
  const corr = (r) => `<span class="num ${Math.abs(r) >= 0.5 ? '' : 'muted'}">${r.toFixed(2)}</span>`;
  main.innerHTML = head('Drivers', 'Each currency\'s main outside driver, how tightly price follows it right now, and whether it backs or fights my bias.') +
    `<div class="note">${esc(data.rule)}</div>
    <section class="panel"><div class="table-wrap"><table>
      <thead><tr><th>Ccy</th><th>Driver</th><th>Measured as</th><th>1m move</th><th>Corr 20d</th><th>Corr 60d</th><th>vs my bias</th><th>Second-order effect</th></tr></thead>
      <tbody>${data.drivers.map((d) => `<tr>
        <td><span class="ccy">${d.currency}</span></td><td>${esc(d.driver)}<div class="small faint">${esc(d.symbol)}</div></td>
        <td class="small muted">${esc(d.measure)}</td><td class="num">${esc(d.move1m)}</td>
        <td>${corr(d.corr20)}</td><td>${corr(d.corr60)}</td><td>${effectPill(d.effect)}</td>
        <td class="small muted">${esc(d.secondOrder)}</td></tr>`).join('')}</tbody></table></div></section>
    <p class="small faint">Commodities: ${esc(data.commodities.note)}</p>`;
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
function indicatorTable(title, rows) {
  if (!rows?.length) return '';
  const fmt = (v, u) => (v == null ? '—' : `${v}${u || ''}`);
  return `<section class="panel"><div class="panel-head"><h2>${esc(title)}</h2></div><div class="table-wrap"><table>
    <thead><tr><th>Indicator</th><th>Latest</th><th>Prior</th><th>Expected</th><th>vs exp.</th><th>6-period trend</th><th>Source</th></tr></thead>
    <tbody>${rows.map((r) => {
      const d = r.expected == null ? null : +(r.latest - r.expected).toFixed(2);
      return `<tr><td>${esc(r.name)}</td><td class="num">${esc(fmt(r.latest, r.unit))}</td><td class="num muted">${esc(fmt(r.prior, r.unit))}</td>
        <td class="num muted">${esc(fmt(r.expected, r.unit))}</td>
        <td class="num">${d == null ? '—' : d === 0 ? '<span class="faint">inline</span>' : `${d > 0 ? '+' : ''}${d}`}</td>
        <td class="nowrap">${sparkline(r.trend)} <span class="small muted">${trendWord(r.trend)}</span></td>
        <td class="small">${r.source ? `<a href="${esc(r.source.url)}" target="_blank" rel="noopener">${esc(r.source.name)} ↗</a>` : '—'}</td></tr>`;
    }).join('')}</tbody></table></div></section>`;
}

render.recap = async (main) => {
  const index = await load('recaps/index');
  if (!index.recaps.length) { main.innerHTML = head('Weekly Recap', '') + '<p class="empty">No recaps yet.</p>'; return; }
  const params = new URLSearchParams(location.search);
  const chosen = index.recaps.find((r) => r.sunday === params.get('week')) || index.recaps[0];
  const [recap, ks] = await Promise.all([load(`recaps/${chosen.file.replace(/\.json$/, '')}`), load('killswitches')]);
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
      ${panel('Next week · watch', `<ul class="list">${o.nextWeekTop.map((x) => `<li class="small">${esc(x)}</li>`).join('')}</ul>`, { href: 'events.html', label: 'Events' })}
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
      <section class="panel"><div class="panel-head"><h2>Central bank</h2><span class="pill ${e.centralBank.stance === 'hawkish' ? 'bull' : e.centralBank.stance === 'dovish' ? 'bear' : 'flat'}">${esc(cbp.stance)}</span></div>
        <div class="kv" style="grid-template-columns:repeat(2,1fr)">
          <div><label>Priced Mon</label><span>${bp(cbp.pricedStartBp)}</span></div>
          <div><label>Priced Fri</label><span>${bp(cbp.pricedEndBp)}</span></div>
          <div><label>Repricing</label><span class="${tone(moved)}" style="background:none">${bp(moved)} ${gapWord(moved)}</span></div>
          <div><label>My path</label><span>${bp(cbp.myPathBp)}</span></div>
        </div><p class="small muted" style="margin:10px 0 0">Gap after the week: <span class="num ${tone(gap)}" style="background:none">${bp(gap)} ${gapWord(gap)}</span></p></section>
      ${panel('This week', `<ul class="bullets" style="margin:0;padding-left:18px">${e.week.takeaways.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`)}
      ${panel('Next week', `<ul class="list">${e.nextWeek.map((x) => `<li class="small">${esc(x)}</li>`).join('')}</ul>`, { href: `events.html?ccy=${e.code}`, label: 'Events' })}
      <div class="span-3 grid">
        ${indicatorTable('Growth', e.indicators.growth)}
        ${indicatorTable('Inflation', e.indicators.inflation)}
        ${indicatorTable('Labour', e.indicators.labour)}
      </div>
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
