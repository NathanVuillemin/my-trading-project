#!/usr/bin/env node
// build-dashboard.mjs — render the snapshot data into a self-contained static dashboard.
//
// Reads:  data/whale-flow/*.json   (daily whale directional flow + outlier flags)
//         data/smart-money/*.json  (multi-venue composite + union)
// Writes: dashboard/index.html     (single file, data embedded, zero external requests)
//
// The page is fully self-contained on purpose: it opens from file://, costs nothing to
// host, and drops onto GitHub Pages unchanged. Re-run after the collectors to refresh.
//
// Usage:
//   node scripts/build-dashboard.mjs
//   npm run dashboard

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');
const FLOW_DIR = join(ROOT, 'data', 'whale-flow');
const SM_DIR = join(ROOT, 'data', 'smart-money');
const OUT_DIR = join(ROOT, 'dashboard');

const readAll = (dir) => {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .sort()
    .map(f => { try { return JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch { return null; } })
    .filter(Boolean);
};

const flows = readAll(FLOW_DIR);
const sms = readAll(SM_DIR);
const latestFlow = flows[flows.length - 1] || null;
const latestSm = sms[sms.length - 1] || null;

// History of asset-class net flow, for the trend chart.
const history = flows.map(f => ({
  date: f.date,
  rollup: f.rollup || {},
}));

const payload = {
  builtAt: new Date().toISOString(),
  latestFlow,
  latestSm,
  history,
  flowDays: flows.length,
};

const esc = (s) => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

const html = `<title>Smart Money Dashboard</title>
<style>
  .viz-root {
    color-scheme: light;
    --surface-1: #fcfcfb;
    --plane: #f9f9f7;
    --text-primary: #0b0b0b;
    --text-secondary: #52514e;
    --muted: #898781;
    --grid: #e1e0d9;
    --baseline: #c3c2b7;
    --border: rgba(11,11,11,0.10);
    --bull: #2a78d6;
    --bear: #e34948;
    --neutral: #f0efec;
    --status-critical: #d03b3b;
    --status-warning: #fab219;
    --status-good: #0ca30c;
  }
  @media (prefers-color-scheme: dark) {
    :root:where(:not([data-theme="light"])) .viz-root {
      color-scheme: dark;
      --surface-1: #1a1a19;
      --plane: #0d0d0d;
      --text-primary: #ffffff;
      --text-secondary: #c3c2b7;
      --muted: #898781;
      --grid: #2c2c2a;
      --baseline: #383835;
      --border: rgba(255,255,255,0.10);
      --bull: #3987e5;
      --bear: #e66767;
      --neutral: #383835;
    }
  }
  :root[data-theme="dark"] .viz-root {
    color-scheme: dark;
    --surface-1: #1a1a19;
    --plane: #0d0d0d;
    --text-primary: #ffffff;
    --text-secondary: #c3c2b7;
    --muted: #898781;
    --grid: #2c2c2a;
    --baseline: #383835;
    --border: rgba(255,255,255,0.10);
    --bull: #3987e5;
    --bear: #e66767;
    --neutral: #383835;
  }

  .viz-root {
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    background: var(--plane);
    color: var(--text-primary);
    padding: 24px 20px 64px;
    max-width: 1100px;
    margin: 0 auto;
    line-height: 1.5;
  }
  h1 { font-size: 1.5rem; margin: 0 0 4px; font-weight: 650; letter-spacing: -0.01em; }
  h2 { font-size: 1rem; margin: 0 0 2px; font-weight: 620; }
  .sub { color: var(--text-secondary); font-size: 0.8rem; margin: 0; }
  .card {
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 18px;
    margin-top: 18px;
  }
  .scroll { overflow-x: auto; }

  /* diverging bar row */
  .rows { margin-top: 14px; display: flex; flex-direction: column; gap: 2px; }
  .row { display: grid; grid-template-columns: 74px 1fr 116px; align-items: center; gap: 10px; min-height: 30px; }
  .row:hover .track { background: color-mix(in srgb, var(--grid) 55%, transparent); }
  .tick { font-size: 0.82rem; font-weight: 600; font-variant-numeric: tabular-nums; }
  .track { position: relative; height: 20px; border-radius: 3px; }
  .axis { position: absolute; left: 50%; top: -2px; bottom: -2px; width: 1px; background: var(--baseline); }
  .fill { position: absolute; top: 3px; height: 14px; }
  .fill.pos { left: 50%; border-radius: 0 4px 4px 0; background: var(--bull); }
  .fill.neg { right: 50%; border-radius: 4px 0 0 4px; background: var(--bear); }
  .val { font-size: 0.8rem; font-variant-numeric: tabular-nums; color: var(--text-secondary); text-align: right; }
  .val b { color: var(--text-primary); }
  .tag { font-size: 0.68rem; padding: 1px 6px; border-radius: 999px; border: 1px solid var(--border); color: var(--text-secondary); }

  table { border-collapse: collapse; width: 100%; font-size: 0.82rem; margin-top: 10px; min-width: 520px; }
  th, td { text-align: left; padding: 6px 10px 6px 0; border-bottom: 1px solid var(--grid); white-space: nowrap; }
  th { color: var(--muted); font-weight: 600; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.04em; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  .bull { color: var(--bull); font-weight: 620; }
  .bear { color: var(--bear); font-weight: 620; }
  .flat { color: var(--muted); }

  details { margin-top: 10px; }
  summary { cursor: pointer; font-size: 0.82rem; color: var(--text-secondary); padding: 4px 0; }
  summary:hover { color: var(--text-primary); }

  .flag { display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--border); margin-top: 8px; background: var(--plane); }
  .flag .name { font-weight: 650; }
  .flag .drivers { flex-basis: 100%; font-size: 0.75rem; color: var(--text-secondary); font-variant-numeric: tabular-nums; }
  .empty { color: var(--text-secondary); font-size: 0.85rem; padding: 12px 0; }
  .legend { display: flex; gap: 14px; align-items: center; font-size: 0.75rem; color: var(--text-secondary); margin-top: 10px; }
  .swatch { display: inline-block; width: 10px; height: 10px; border-radius: 2px; vertical-align: -1px; margin-right: 5px; }
  .note { font-size: 0.75rem; color: var(--muted); margin-top: 12px; }
  .warns { font-size: 0.75rem; color: var(--text-secondary); margin-top: 10px; }
  .warns code { font-family: ui-monospace, monospace; }
</style>

<div class="viz-root">
  <h1>Smart Money Dashboard</h1>
  <p class="sub" id="built"></p>

  <div class="card">
    <h2>Cross-venue composite</h2>
    <p class="sub">Weighted score per asset. Blue = bullish, red = bearish. Labels carry direction, not colour alone.</p>
    <div class="legend">
      <span><span class="swatch" style="background:var(--bull)"></span>bullish</span>
      <span><span class="swatch" style="background:var(--bear)"></span>bearish</span>
      <span>scale −1 … +1</span>
    </div>
    <div class="rows" id="composite"></div>
    <details>
      <summary>Table view — every source, tagged</summary>
      <div class="scroll"><table id="union"></table></div>
    </details>
    <div class="warns" id="warns"></div>
  </div>

  <div class="card">
    <h2>Whale flow by asset class</h2>
    <p class="sub">Net 24h directional flow of top Hyperliquid wallets. Buy pressure minus sell pressure.</p>
    <div class="rows" id="rollup"></div>
  </div>

  <div class="card">
    <h2>Flagged outliers</h2>
    <p class="sub">Days where flow broke its own baseline <em>and</em> cleared the size floor.</p>
    <div id="flags"></div>
  </div>

  <div class="card">
    <h2>History</h2>
    <p class="sub" id="histsub"></p>
    <div class="scroll"><table id="hist"></table></div>
  </div>

  <p class="note">Static build — regenerate with <code>npm run dashboard</code> after the collectors run. No external requests; works offline.</p>
</div>

<script type="application/json" id="data">${JSON.stringify(payload).replace(/</g, '\\u003c')}</script>
<script>
(function () {
  var D = JSON.parse(document.getElementById('data').textContent);
  var $ = function (id) { return document.getElementById(id); };
  var fmtM = function (n) { return (n >= 0 ? '+$' : '-$') + (Math.abs(n) / 1e6).toFixed(2) + 'M'; };
  var cls = function (v) { return v > 0.001 ? 'bull' : v < -0.001 ? 'bear' : 'flat'; };
  var dirWord = function (v, hi, lo) { return v > 0.001 ? (hi || 'bullish') : v < -0.001 ? (lo || 'bearish') : 'flat'; };

  $('built').textContent = 'Built ' + new Date(D.builtAt).toLocaleString()
    + (D.latestFlow ? ' · flow ' + D.latestFlow.date + ' (' + D.latestFlow.wallets_with_fills + ' wallets)' : '')
    + ' · ' + D.flowDays + ' day' + (D.flowDays === 1 ? '' : 's') + ' of history';

  // ---- diverging bar rows ----
  function bars(el, items, max, fmt) {
    if (!items.length) { el.innerHTML = '<p class="empty">No data yet.</p>'; return; }
    var scale = max || Math.max.apply(null, items.map(function (i) { return Math.abs(i.value); }).concat([1]));
    el.innerHTML = items.map(function (i) {
      var pct = Math.min(50, Math.abs(i.value) / scale * 50);
      var side = i.value >= 0 ? 'pos' : 'neg';
      var title = i.label + ': ' + fmt(i.value) + ' — ' + dirWord(i.value) + (i.meta ? ' · ' + i.meta : '');
      return '<div class="row" title="' + title.replace(/"/g, '&quot;') + '">'
        + '<span class="tick">' + i.label + '</span>'
        + '<span class="track"><span class="axis"></span>'
        + '<span class="fill ' + side + '" style="width:' + pct + '%"></span></span>'
        + '<span class="val"><b class="' + cls(i.value) + '">' + fmt(i.value) + '</b>'
        + (i.meta ? ' <span class="tag">' + i.meta + '</span>' : '') + '</span>'
        + '</div>';
    }).join('');
  }

  // ---- composite ----
  var comp = (D.latestSm && D.latestSm.composite) || [];
  bars($('composite'), comp.map(function (c) {
    return {
      label: c.asset, value: c.score,
      meta: c.agreement ? 'all ' + c.sources + ' agree' : c.bulls + 'L/' + c.bears + 'S'
    };
  }), 1, function (v) { return (v >= 0 ? '+' : '') + v.toFixed(2); });

  // ---- union table ----
  var rows = [];
  comp.forEach(function (c) {
    (c.union || []).forEach(function (u, idx) {
      rows.push('<tr>'
        + '<td>' + (idx === 0 ? '<b>' + c.asset + '</b>' : '') + '</td>'
        + '<td>' + u.source + '</td>'
        + '<td>' + (u.kind === 'smart' ? 'smart' : 'crowd') + '</td>'
        + '<td>' + u.tier + '</td>'
        + '<td class="num ' + cls(u.score) + '">' + (u.score >= 0 ? '+' : '') + u.score.toFixed(2) + '</td>'
        + '<td>' + u.detail + '</td>'
        + '</tr>');
    });
  });
  $('union').innerHTML = '<thead><tr><th>Asset</th><th>Source</th><th>Kind</th><th>Tier</th><th>Score</th><th>Detail</th></tr></thead>'
    + '<tbody>' + (rows.join('') || '<tr><td colspan="6">No data.</td></tr>') + '</tbody>';

  var warns = (D.latestSm && D.latestSm.warns) || [];
  $('warns').innerHTML = warns.length ? 'Source notes: ' + warns.map(function (w) { return '<code>' + w + '</code>'; }).join(' · ') : '';

  // ---- asset-class rollup ----
  var ru = (D.latestFlow && D.latestFlow.rollup) || {};
  bars($('rollup'), Object.keys(ru).map(function (k) {
    return { label: k, value: ru[k].net, meta: ru[k].coins + ' mkts' };
  }).sort(function (a, b) { return Math.abs(b.value) - Math.abs(a.value); }), 0, fmtM);

  // ---- flags ----
  var fl = (D.latestFlow && D.latestFlow.flags) || { coinFlags: [], classFlags: [] };
  var all = (fl.classFlags || []).map(function (f) { return { name: f.cls + ' (class)', net: f.net, z: f.z, dir: f.dir, drivers: null, consensus: false }; })
    .concat((fl.coinFlags || []).map(function (f) {
      return { name: f.coin, net: f.net, z: f.z, dir: f.dir, consensus: f.consensus, drivers: f.drivers };
    }));
  $('flags').innerHTML = all.length ? all.map(function (f) {
    return '<div class="flag">'
      + '<span class="name">' + f.name + '</span>'
      + '<span class="' + (f.net >= 0 ? 'bull' : 'bear') + '">' + f.dir + '</span>'
      + '<span class="val">' + fmtM(f.net) + '</span>'
      + '<span class="tag">' + (f.z == null ? 'cold start' : 'z=' + f.z) + '</span>'
      + (f.consensus ? '<span class="tag">consensus</span>' : '')
      + (f.drivers && f.drivers.length ? '<span class="drivers">drivers: ' + f.drivers.map(function (d) { return d.w + ' ' + fmtM(d.usd); }).join(' · ') + '</span>' : '')
      + '</div>';
  }).join('') : '<p class="empty">No outliers flagged. Baseline needs ~2 weeks of daily runs before z-scores engage.</p>';

  // ---- history ----
  var H = D.history || [];
  var classes = ['CRYPTO', 'STOCK', 'INDEX', 'COMMOD', 'FX'];
  $('histsub').textContent = H.length < 2
    ? 'Daily net flow per asset class. Only ' + H.length + ' day recorded — the trend fills in as the collector runs.'
    : 'Daily net flow per asset class, ' + H.length + ' days.';
  $('hist').innerHTML = '<thead><tr><th>Date</th>' + classes.map(function (c) { return '<th class="num">' + c + '</th>'; }).join('') + '</tr></thead>'
    + '<tbody>' + H.slice().reverse().map(function (h) {
      return '<tr><td>' + h.date + '</td>' + classes.map(function (c) {
        var v = h.rollup[c] ? h.rollup[c].net : 0;
        return '<td class="num ' + cls(v) + '">' + fmtM(v) + '</td>';
      }).join('') + '</tr>';
    }).join('') + '</tbody>';
})();
</script>`;

mkdirSync(OUT_DIR, { recursive: true });
const out = join(OUT_DIR, 'index.html');
writeFileSync(out, html);
console.log(`Dashboard built: ${out}`);
console.log(`  whale-flow snapshots: ${flows.length}${latestFlow ? ` (latest ${latestFlow.date})` : ''}`);
console.log(`  smart-money snapshots: ${sms.length}`);
if (!flows.length && !sms.length) console.log('  ! No data yet — run: npm run whale:flow && npm run smart:money');
