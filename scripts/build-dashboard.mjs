#!/usr/bin/env node
// build-dashboard.mjs — render every data feed into one self-contained static page.
//
// AUTO-DISCOVERY: this scans data/*/ and renders whatever it finds, newest file per
// directory. Adding a new collector requires no change here — drop JSON into
// data/<name>/<date>.json and a panel appears. Directories with a purpose-built renderer
// below get a tailored view; anything else falls back to a generic table/stat renderer.
// That keeps collectors and presentation decoupled (and lets two people work in parallel
// without fighting over this file).
//
// Output: dashboard/index.html — no external requests, opens from file://, deploys to Pages.
//
// Usage: node scripts/build-dashboard.mjs   |   npm run dashboard

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');
const DATA = join(ROOT, 'data');
const OUT_DIR = join(ROOT, 'dashboard');

// ---------------------------------------------------------------- load
function newestIn(dir) {
  const files = readdirSync(dir).filter(f => f.endsWith('.json')).sort();
  if (!files.length) return null;
  const f = files[files.length - 1];
  try {
    return { name: f, date: f.replace(/\.json$/, ''), count: files.length, data: JSON.parse(readFileSync(join(dir, f), 'utf8')) };
  } catch { return null; }
}

const feeds = {};
if (existsSync(DATA)) {
  for (const d of readdirSync(DATA)) {
    const p = join(DATA, d);
    try { if (!statSync(p).isDirectory()) continue; } catch { continue; }
    const got = newestIn(p);
    if (got) feeds[d] = got;
  }
}

// History of whale-flow rollups for the trend table.
let flowHistory = [];
const flowDir = join(DATA, 'whale-flow');
if (existsSync(flowDir)) {
  flowHistory = readdirSync(flowDir).filter(f => f.endsWith('.json')).sort().map(f => {
    try { const j = JSON.parse(readFileSync(join(flowDir, f), 'utf8')); return { date: j.date, rollup: j.rollup || {} }; }
    catch { return null; }
  }).filter(Boolean);
}

// ---------------------------------------------------------------- journal
// Markdown files in journal/, newest first. Frontmatter is parsed with a deliberately
// small hand-rolled reader (flat `key: value` between --- fences) so the build keeps its
// zero-dependency property — pulling in a YAML parser would add an npm install to CI.
function readJournal() {
  const dir = join(ROOT, 'journal');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith('.md') && !f.startsWith('_') && f.toLowerCase() !== 'readme.md')
    .sort().reverse()
    .slice(0, 30)
    .map(f => {
      let raw;
      try { raw = readFileSync(join(dir, f), 'utf8'); } catch { return null; }
      const meta = {};
      let body = raw;
      const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
      if (fm) {
        for (const line of fm[1].split(/\r?\n/)) {
          const kv = line.match(/^\s*([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
          if (kv) meta[kv[1].toLowerCase()] = kv[2].trim();
        }
        body = fm[2];
      }
      const title = (body.match(/^#{1,3}\s+(.+)$/m) || [])[1] || null;
      return {
        file: f,
        date: meta.date || f.replace(/\.md$/, '').slice(0, 10),
        tags: (meta.tags || '').split(',').map(s => s.trim()).filter(Boolean),
        result: (meta.result || '').toLowerCase() || null,
        mood: meta.mood || null,
        title,
        // Plain-text excerpt; the dashboard renders no markdown, so strip the syntax.
        excerpt: body.replace(/^#{1,6}\s+/gm, '').replace(/[*_`>]/g, '')
          .split(/\r?\n/).map(s => s.trim()).filter(Boolean).join(' ').slice(0, 400),
        words: body.split(/\s+/).filter(Boolean).length,
      };
    })
    .filter(Boolean);
}

const payload = {
  builtAt: new Date().toISOString(),
  feeds: Object.fromEntries(Object.entries(feeds).map(([k, v]) => [k, { date: v.date, count: v.count, data: v.data }])),
  flowHistory,
  journal: readJournal(),
};

// ---------------------------------------------------------------- page
const html = `<title>Trading Cockpit</title>
<style>
  .viz-root {
    color-scheme: light;
    --surface-1:#fcfcfb; --plane:#f9f9f7; --text-primary:#0b0b0b; --text-secondary:#52514e;
    --muted:#898781; --grid:#e1e0d9; --baseline:#c3c2b7; --border:rgba(11,11,11,0.10);
    --bull:#2a78d6; --bear:#e34948; --neutral:#f0efec;
    --critical:#d03b3b; --warning:#fab219; --good:#0ca30c;
  }
  @media (prefers-color-scheme: dark) {
    :root:where(:not([data-theme="light"])) .viz-root {
      color-scheme: dark;
      --surface-1:#1a1a19; --plane:#0d0d0d; --text-primary:#fff; --text-secondary:#c3c2b7;
      --muted:#898781; --grid:#2c2c2a; --baseline:#383835; --border:rgba(255,255,255,0.10);
      --bull:#3987e5; --bear:#e66767; --neutral:#383835;
    }
  }
  :root[data-theme="dark"] .viz-root {
    color-scheme: dark;
    --surface-1:#1a1a19; --plane:#0d0d0d; --text-primary:#fff; --text-secondary:#c3c2b7;
    --muted:#898781; --grid:#2c2c2a; --baseline:#383835; --border:rgba(255,255,255,0.10);
    --bull:#3987e5; --bear:#e66767; --neutral:#383835;
  }
  .viz-root{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--plane);
    color:var(--text-primary);padding:22px 18px 60px;max-width:1140px;margin:0 auto;line-height:1.5}
  h1{font-size:1.5rem;margin:0 0 4px;font-weight:650;letter-spacing:-.01em}
  h2{font-size:1rem;margin:0;font-weight:620}
  .sub{color:var(--text-secondary);font-size:.8rem;margin:2px 0 0}
  .card{background:var(--surface-1);border:1px solid var(--border);border-radius:10px;padding:16px 18px;margin-top:16px;
    color:var(--text-primary)}
  .scroll{overflow-x:auto}
  .rows{margin-top:12px;display:flex;flex-direction:column;gap:2px}
  .row{display:grid;grid-template-columns:86px 1fr 132px;align-items:center;gap:10px;min-height:28px}
  .row:hover .track{background:color-mix(in srgb,var(--grid) 55%,transparent)}
  .tick{font-size:.8rem;font-weight:600}
  .track{position:relative;height:18px;border-radius:3px}
  .axis{position:absolute;left:50%;top:-2px;bottom:-2px;width:1px;background:var(--baseline)}
  .fill{position:absolute;top:3px;height:12px}
  .fill.pos{left:50%;border-radius:0 4px 4px 0;background:var(--bull)}
  .fill.neg{right:50%;border-radius:4px 0 0 4px;background:var(--bear)}
  .val{font-size:.78rem;font-variant-numeric:tabular-nums;color:var(--text-secondary);text-align:right}
  .val b{color:var(--text-primary)}
  .tag{font-size:.66rem;padding:1px 6px;border-radius:999px;border:1px solid var(--border);color:var(--text-secondary);white-space:nowrap}
  /* Colour is set explicitly on every text element rather than inherited. A host page or
     UA stylesheet that resets colour on tables would otherwise leave cells at default
     black on the dark surface — measured at ~1.1:1, effectively invisible. */
  table{border-collapse:collapse;width:100%;font-size:.8rem;margin-top:8px;min-width:460px;
    color:var(--text-primary);background:transparent}
  th,td{text-align:left;padding:5px 10px 5px 0;border-bottom:1px solid var(--grid);white-space:nowrap;
    color:var(--text-primary)}
  th{color:var(--muted);font-weight:600;font-size:.7rem;text-transform:uppercase;letter-spacing:.04em}
  td.num{text-align:right;font-variant-numeric:tabular-nums}
  .bull{color:var(--bull);font-weight:620}.bear{color:var(--bear);font-weight:620}.flat{color:var(--muted)}
  details{margin-top:8px}
  summary{cursor:pointer;font-size:.8rem;color:var(--text-secondary);padding:3px 0}
  summary:hover{color:var(--text-primary)}
  .tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(132px,1fr));gap:10px;margin-top:12px}
  .tile{border:1px solid var(--border);border-radius:8px;padding:9px 11px;background:var(--plane)}
  .tile .k{font-size:.68rem;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
  .tile .v{font-size:1.05rem;font-weight:640;font-variant-numeric:tabular-nums;margin-top:2px}
  .alert{display:flex;gap:8px;align-items:baseline;padding:7px 11px;border-radius:7px;border:1px solid var(--border);margin-top:6px;background:var(--plane);font-size:.82rem}
  .alert .lvl{font-weight:650;font-size:.7rem;text-transform:uppercase}
  .lvl.critical{color:var(--critical)}.lvl.warning{color:var(--warning)}.lvl.good{color:var(--good)}
  .empty{color:var(--text-secondary);font-size:.84rem;padding:8px 0}
  .hdr{display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap}
  .note{font-size:.74rem;color:var(--muted);margin-top:14px}
  .warn{font-size:.74rem;color:var(--text-secondary);margin-top:8px}
  .warn code{font-family:ui-monospace,monospace}
  .nav{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
  .nav a{font-size:.74rem;padding:3px 9px;border:1px solid var(--border);border-radius:999px;color:var(--text-secondary);text-decoration:none}
  .nav a:hover{color:var(--text-primary);border-color:var(--baseline)}
</style>

<div class="viz-root">
  <h1>Trading Cockpit</h1>
  <p class="sub" id="built"></p>
  <div class="nav" id="nav"></div>
  <div id="panels"></div>
  <p class="note">Static build — <code>npm run dashboard</code> regenerates. Panels are discovered from <code>data/*/</code>; new collectors appear automatically. No external requests.</p>
</div>

<script type="application/json" id="data">${JSON.stringify(payload).replace(/</g, '\\u003c')}</script>
<script>
(function(){
var D=JSON.parse(document.getElementById('data').textContent);
var F=D.feeds||{};
var el=function(id){return document.getElementById(id)};
var esc=function(s){return String(s==null?'':s).replace(/[&<>]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c]})};
var m=function(n){var a=Math.abs(n);var s=n<0?'-':'';
  if(a>=1e9)return s+'$'+(a/1e9).toFixed(2)+'B'; if(a>=1e6)return s+'$'+(a/1e6).toFixed(2)+'M';
  if(a>=1e3)return s+'$'+(a/1e3).toFixed(1)+'K'; return s+'$'+a.toFixed(0)};
var sgn=function(n){return (n>=0?'+':'')+n};
var cls=function(v){return v>0.0001?'bull':v<-0.0001?'bear':'flat'};
var num=function(v){return typeof v==='number'&&isFinite(v)};

el('built').textContent='Built '+new Date(D.builtAt).toLocaleString()+' · '+Object.keys(F).length+' feeds';

function bars(items,scaleMax,fmt){
  if(!items.length)return '<p class="empty">No data.</p>';
  var sc=scaleMax||Math.max.apply(null,items.map(function(i){return Math.abs(i.value)}).concat([1]));
  return '<div class="rows">'+items.map(function(i){
    var pct=Math.min(50,Math.abs(i.value)/sc*50);
    return '<div class="row" title="'+esc(i.label+': '+fmt(i.value))+'">'
      +'<span class="tick">'+esc(i.label)+'</span>'
      +'<span class="track"><span class="axis"></span><span class="fill '+(i.value>=0?'pos':'neg')+'" style="width:'+pct+'%"></span></span>'
      +'<span class="val"><b class="'+cls(i.value)+'">'+fmt(i.value)+'</b>'+(i.meta?' <span class="tag">'+esc(i.meta)+'</span>':'')+'</span></div>';
  }).join('')+'</div>';
}
function tiles(pairs){
  return '<div class="tiles">'+pairs.map(function(p){
    return '<div class="tile"><div class="k">'+esc(p[0])+'</div><div class="v '+(p[2]||'')+'">'+esc(p[1])+'</div></div>';
  }).join('')+'</div>';
}
function table(cols,rows){
  return '<div class="scroll"><table><thead><tr>'+cols.map(function(c){return '<th'+(c.num?' class="num"':'')+'>'+esc(c.label)+'</th>'}).join('')
    +'</tr></thead><tbody>'+(rows.join('')||'<tr><td colspan="'+cols.length+'">No rows.</td></tr>')+'</tbody></table></div>';
}
function card(id,title,sub,body){
  return '<div class="card" id="p-'+id+'"><div class="hdr"><h2>'+esc(title)+'</h2>'
    +(sub?'<span class="sub">'+esc(sub)+'</span>':'')+'</div>'+body+'</div>';
}

// ---------------- specific renderers ----------------
var R={};

R['whale-flow']=function(d){
  var ru=d.rollup||{}; var order=['CRYPTO','STOCK','INDEX','COMMOD','FX'];
  var items=order.filter(function(k){return ru[k]}).map(function(k){
    return {label:k,value:ru[k].opened!=null?ru[k].opened:ru[k].net,meta:ru[k].coins+' mkts'};
  });
  var body='<p class="sub">Net NEW RISK (opening fills). Headline flow includes closes and can point the other way.</p>'+bars(items,0,m);
  var fl=(d.flags&&d.flags.coinFlags)||[];
  if(fl.length){
    body+='<div style="margin-top:14px"><b style="font-size:.85rem">Flagged outliers</b></div>';
    body+=fl.slice(0,8).map(function(f){
      var v=f.opened!=null?f.opened:f.net;
      return '<div class="alert"><span class="lvl '+(v>=0?'good':'critical')+'">'+esc(f.dir)+'</span>'
        +'<b>'+esc(f.coin)+'</b><span>'+m(v)+'</span>'
        +'<span class="tag">'+(f.z==null?'cold start':'z='+f.z)+'</span>'
        +(f.consensus?'<span class="tag">consensus</span>':'')
        +(f.divergent?'<span class="tag">⇄ headline '+m(f.net)+'</span>':'')+'</div>';
    }).join('');
  }
  var h=D.flowHistory||[];
  if(h.length>1){
    var rows=h.slice().reverse().slice(0,14).map(function(x){
      return '<tr><td>'+esc(x.date)+'</td>'+order.map(function(c){
        var v=x.rollup[c]?(x.rollup[c].opened!=null?x.rollup[c].opened:x.rollup[c].net):0;
        return '<td class="num '+cls(v)+'">'+m(v)+'</td>';
      }).join('')+'</tr>';
    });
    body+='<details><summary>History — '+h.length+' days</summary>'
      +table([{label:'Date'}].concat(order.map(function(c){return {label:c,num:true}})),rows)+'</details>';
  }
  return body;
};

R['smart-money']=function(d){
  var c=d.composite||[]; var cov=d.coverage;
  var body='';
  if(cov){
    var degraded=cov.smartPct<60;
    body+='<div class="alert"><span class="lvl '+(degraded?'warning':'good')+'">'+(degraded?'degraded':'coverage')+'</span>'
      +'<span>'+cov.smartPct+'% of smart-tier weight present ('+cov.smartPresent+'/'+cov.smartExpected+')</span>'
      +(cov.missing&&cov.missing.length?'<span class="tag">missing: '+esc(cov.missing.join(', '))+'</span>':'')+'</div>';
  }
  body+=bars(c.map(function(a){return {label:a.asset,value:a.score,meta:a.agreement?'all '+a.sources+' agree':a.bulls+'L/'+a.bears+'S'}}),1,
    function(v){return sgn(v.toFixed(2))});
  var rows=[];
  c.forEach(function(a){(a.union||[]).forEach(function(u,i){
    rows.push('<tr><td>'+(i===0?'<b>'+esc(a.asset)+'</b>':'')+'</td><td>'+esc(u.source)+'</td><td>'+esc(u.kind)+'</td>'
      +'<td class="num '+cls(u.score)+'">'+sgn(u.score.toFixed(2))+'</td><td>'+esc(u.detail)+'</td></tr>');
  })});
  body+='<details><summary>Every source, tagged</summary>'+table(
    [{label:'Asset'},{label:'Source'},{label:'Kind'},{label:'Score',num:true},{label:'Detail'}],rows)+'</details>';
  if((d.warns||[]).length)body+='<div class="warn">'+d.warns.map(function(w){return '<code>'+esc(w)+'</code>'}).join(' · ')+'</div>';
  return body;
};

R['portfolio']=function(d){
  var a=d.account||{},r=d.risk||{},t=d.trades||{};
  var body='';
  if(d.usingPlaceholder)body+='<div class="alert"><span class="lvl warning">placeholder</span><span>Showing a sample address — edit <code>config/portfolio.json</code> with your own.</span></div>';
  body+=tiles([
    ['Equity',m(a.equity||0)],['Net worth',m(a.netWorth||0)],
    ['Gross exposure',m(r.gross||0)],['Net exposure',m(r.net||0),cls(r.net||0)],
    ['Acct leverage',(a.accountLeverage||0).toFixed(2)+'x'],
    ['Funding 30d',m((d.funding&&d.funding.last30d)||0),cls((d.funding&&d.funding.last30d)||0)]
  ]);
  (r.alerts||[]).forEach(function(al){
    body+='<div class="alert"><span class="lvl '+esc(al.level)+'">'+esc(al.level)+'</span><span>'+esc(al.msg)+'</span></div>';
  });
  var liq=(r.closestToLiq||[]).map(function(p){
    return '<tr><td><b>'+esc(p.coin)+'</b></td><td>'+esc(p.side)+'</td>'
      +'<td class="num '+(p.distPct<10?'bear':'')+'">'+p.distPct.toFixed(1)+'%</td>'
      +'<td class="num">'+(p.mark||0).toFixed(2)+'</td><td class="num">'+(p.liqPx||0).toFixed(2)+'</td></tr>';
  });
  if(liq.length)body+='<div style="margin-top:12px"><b style="font-size:.85rem">Closest to liquidation</b></div>'
    +table([{label:'Market'},{label:'Side'},{label:'Distance',num:true},{label:'Mark',num:true},{label:'Liq',num:true}],liq);
  // Manual positions and cash were being collected from config but never shown, so
  // anything held off-venue was invisible in the exposure picture.
  var man=d.manual||[];
  if(man.length){
    var mrows=man.map(function(x){
      return '<tr><td><b>'+esc(x.asset)+'</b></td><td>'+esc(x.side||'')+'</td>'
        +'<td class="num">'+m(x.sizeUsd||0)+'</td><td>'+esc(x.venue||'')+'</td>'
        +'<td>'+esc(x.opened||'')+'</td><td>'+esc(x.note||'')+'</td></tr>';
    });
    body+='<div style="margin-top:12px"><b style="font-size:.85rem">Manual positions</b> '
      +'<span class="sub">held off-venue, from config/portfolio.json</span></div>'
      +table([{label:'Asset'},{label:'Side'},{label:'Size',num:true},{label:'Venue'},{label:'Opened'},{label:'Note'}],mrows);
  }
  var csh=d.cash||[];
  if(csh.length){
    body+='<div style="margin-top:10px"><b style="font-size:.85rem">Cash</b></div>'
      +table([{label:'Label'},{label:'USD',num:true}],csh.map(function(c){
        return '<tr><td>'+esc(c.label)+'</td><td class="num">'+m(c.usd||0)+'</td></tr>';
      }));
  }

  var pos=(d.positions||[]).slice(0,12).map(function(p){
    return '<tr><td><b>'+esc(p.coin)+'</b></td><td>'+esc(p.side)+'</td><td class="num">'+m(p.notional)+'</td>'
      +'<td class="num '+cls(p.uPnl)+'">'+m(p.uPnl)+'</td><td class="num '+cls(p.roe)+'">'+p.roe.toFixed(1)+'%</td>'
      +'<td class="num '+cls(p.fundingSinceOpen)+'">'+m(p.fundingSinceOpen)+'</td></tr>';
  });
  body+='<details><summary>Positions ('+(d.positions||[]).length+')</summary>'+table(
    [{label:'Market'},{label:'Side'},{label:'Notional',num:true},{label:'uPnL',num:true},{label:'ROE',num:true},{label:'Funding',num:true}],pos)+'</details>';
  if(t.tradeCount!=null)body+='<details><summary>Realised — '+t.tradeCount+' round trips</summary>'+tiles([
    ['Win rate',(t.winRate||0).toFixed(1)+'%'],['Net realised',m(t.netRealised||0),cls(t.netRealised||0)],
    ['Expectancy',m(t.expectancy||0)+'/trade',cls(t.expectancy||0)],
    ['Profit factor',t.profitFactor==null?'n/a':t.profitFactor.toFixed(2)],
    ['Fees paid',m(-(t.totalFees||0)),'bear']])+'</details>';
  return body;
};

R['trust']=function(d){
  var w=d.wallets||[];
  var body='<p class="sub">Ranked on evidence, not PnL. Style is inferred from behaviour and shown with its raw numbers — a weight, never a hidden filter.</p>';
  body+=tiles(Object.entries(d.styleCounts||{}).map(function(e){return [e[0],e[1]]}));
  var rows=w.slice(0,20).map(function(x){
    return '<tr><td class="num"><b>'+x.trustScore+'</b></td><td class="num">'+x.confidence+'</td>'
      +'<td>'+esc(x.short)+'</td><td>'+esc(x.style)+'</td>'
      +'<td class="num">'+m(x.accountValue)+'</td><td class="num '+cls(x.pnl.month)+'">'+m(x.pnl.month)+'</td>'
      +'<td class="num">'+x.monthRoiPct+'%</td><td class="num">'+x.positiveWindows+'/4</td>'
      +'<td class="num">'+(x.maxDrawdownPct==null?'—':x.maxDrawdownPct+'%')+'</td>'
      +'<td>'+esc((x.flags||[]).join('; '))+'</td></tr>';
  });
  body+=table([{label:'Score',num:true},{label:'Conf',num:true},{label:'Wallet'},{label:'Style'},
    {label:'Account',num:true},{label:'Month PnL',num:true},{label:'ROI',num:true},{label:'Windows',num:true},
    {label:'MaxDD',num:true},{label:'Flags'}],rows);
  return body;
};

R['insiders']=function(d){
  var body='<p class="sub">Only transaction code P (open-market purchase) counts as a buy. Grants, option exercises and tax withholding are excluded.</p>';
  body+=tiles([['Buys',(d.counts&&d.counts.buys)||0],['Buy value',m((d.totals&&d.totals.buyUsd)||0),'bull'],
    ['Sells',(d.counts&&d.counts.sells)||0],['Sell value',m((d.totals&&d.totals.sellUsd)||0),'bear'],
    ['Filings',d.filingsParsed||0]]);
  var cl=(d.clusters||[]).slice(0,10).map(function(c){
    return '<tr><td><b>'+esc(c.ticker||'—')+'</b></td><td>'+esc((c.issuer||'').slice(0,34))+'</td>'
      +'<td class="num bull">'+m(c.usd)+'</td><td class="num">'+c.buyerCount+'</td>'
      +'<td>'+esc((c.roles||[]).slice(0,2).join(', '))+'</td></tr>';
  });
  body+='<div style="margin-top:12px"><b style="font-size:.85rem">Cluster buys — 2+ insiders, same company</b></div>'
    +table([{label:'Ticker'},{label:'Issuer'},{label:'Value',num:true},{label:'Insiders',num:true},{label:'Roles'}],cl);
  var tb=(d.topBuys||[]).slice(0,10).map(function(b){
    return '<tr><td><b>'+esc(b.ticker||'—')+'</b></td><td class="num bull">'+m(b.usd)+'</td>'
      +'<td>'+esc((b.role||'').slice(0,26))+'</td><td>'+esc(b.owner)+'</td>'
      +'<td>'+(b.planned?'<span class="tag">10b5-1</span>':'')+'</td></tr>';
  });
  body+='<details><summary>Largest individual buys</summary>'+table(
    [{label:'Ticker'},{label:'Value',num:true},{label:'Role'},{label:'Insider'},{label:''}],tb)+'</details>';
  if(d.codeCensus)body+='<details><summary>Transaction code census — the noise ratio</summary>'+table(
    [{label:'Code'},{label:'Count',num:true}],Object.entries(d.codeCensus).sort(function(a,b){return b[1]-a[1]})
      .map(function(e){return '<tr><td>'+esc(e[0])+(e[0]==='P'?' <span class="tag">real buy</span>':'')+'</td><td class="num">'+e[1]+'</td></tr>'}))+'</details>';
  return body;
};

R['macro-flows']=function(d){
  var body='<p class="sub">COT index is each group\\'s net position percentile over '
    +(d.cotLookbackYears||3)+'y — raw net positions are not comparable across markets. '
    +'Commercials/dealers hedge (informed); large specs and leveraged funds chase (crowded).</p>';

  // Conviction extremes: informed money at a percentile extreme. "opposed" means the fast
  // money is positioned against them, which is the configuration that historically matters.
  var ce=d.convictionExtremes||[];
  if(ce.length){
    var rows=ce.slice(0,12).map(function(c){
      return '<tr><td><b>'+esc(c.label)+'</b></td><td>'+esc(c.cls)+'</td><td>'+esc(c.group)+'</td>'
        +'<td class="'+(c.dir==='LONG'?'bull':'bear')+'">'+esc(c.dir)+'</td>'
        +'<td class="num">'+c.index+'</td>'
        +'<td class="num">'+(c.fastIndex==null?'—':c.fastIndex)+'</td>'
        +'<td>'+(c.opposed?'<span class="tag">opposed</span>':'')+'</td></tr>';
    });
    body+='<div style="margin-top:12px"><b style="font-size:.85rem">Conviction extremes</b></div>'
      +table([{label:'Market'},{label:'Class'},{label:'Informed group'},{label:'Direction'},
        {label:'COT idx',num:true},{label:'Fast idx',num:true},{label:''}],rows);
  }

  // Crypto exchange flows — the one whale metric that needs no wallet labelling.
  var fl=d.flows||[];
  if(fl.length){
    var frows=fl.map(function(f){
      var acc=/ACCUM/i.test(f.read||'');
      return '<tr><td><b>'+esc(f.asset)+'</b></td>'
        +'<td class="'+(acc?'bull':'bear')+'">'+esc(f.read||'')+'</td>'
        +'<td class="num '+cls(f.net1d)+'">'+m(f.net1d||0)+'</td>'
        +'<td class="num '+cls(f.net7d)+'">'+m(f.net7d||0)+'</td>'
        +'<td class="num '+cls(f.net30d)+'">'+m(f.net30d||0)+'</td>'
        +'<td class="num">'+(f.mvrv==null?'—':f.mvrv.toFixed(2))+'</td>'
        +'<td class="num '+cls(-(f.supplyChange30dPct||0))+'">'+(f.supplyChange30dPct==null?'—':f.supplyChange30dPct.toFixed(2)+'%')+'</td>'
        +(f.flash?'<td><span class="tag">flash</span></td>':'<td></td>')+'</tr>';
    });
    body+='<div style="margin-top:14px"><b style="font-size:.85rem">Exchange flows</b> '
      +'<span class="sub">negative net = leaving exchanges = accumulation</span></div>'
      +table([{label:'Asset'},{label:'Read'},{label:'1d',num:true},{label:'7d',num:true},
        {label:'30d',num:true},{label:'MVRV',num:true},{label:'Supply 30d',num:true},{label:''}],frows);
  }

  var hz=d.hedgingZones||[];
  if(hz.length){
    var hrows=hz.slice(0,12).map(function(h){
      return '<tr><td><b>'+esc(h.label)+'</b></td><td>'+esc(h.cls)+'</td><td>'+esc(h.group)+'</td>'
        +'<td class="num">'+h.index+'</td>'
        +'<td class="num">'+(h.shareOfOi==null?'—':h.shareOfOi.toFixed(0)+'%')+'</td>'
        +'<td>'+(h.building?'<span class="tag">building</span>':'')+'</td></tr>';
    });
    body+='<details><summary>Hedging zones ('+hz.length+')</summary>'+table(
      [{label:'Market'},{label:'Class'},{label:'Group'},{label:'COT idx',num:true},
       {label:'Share of OI',num:true},{label:''}],hrows)+'</details>';
  }

  var cot=d.cot||[];
  if(cot.length){
    var crows=[];
    cot.slice(0,20).forEach(function(mkt){
      (mkt.groups||[]).forEach(function(g,i){
        crows.push('<tr><td>'+(i===0?'<b>'+esc(mkt.label)+'</b>':'')+'</td>'
          +'<td>'+esc(g.name)+'</td><td>'+esc(g.role||'')+'</td>'
          +'<td class="num '+cls(g.net)+'">'+(g.net||0).toLocaleString()+'</td>'
          +'<td class="num '+cls(g.change)+'">'+sgn((g.change||0).toLocaleString())+'</td>'
          +'<td class="num">'+g.index+'</td></tr>');
      });
    });
    body+='<details><summary>Full COT breakdown ('+cot.length+' markets)</summary>'+table(
      [{label:'Market'},{label:'Group'},{label:'Role'},{label:'Net',num:true},
       {label:'Δ week',num:true},{label:'COT idx',num:true}],crows)+'</details>';
  }
  if((d.warns||[]).length)body+='<div class="warn">'+d.warns.map(function(w){return '<code>'+esc(w)+'</code>'}).join(' · ')+'</div>';
  return body;
};

R['macro-pulse']=function(d){
  var body='<p class="sub">Fast macro backdrop: where capital sits and how it is positioned. All free, no keys.</p>';
  var s=d.stablecoins, sent=d.sentiment;
  var t=[];
  if(s)t.push(['Stablecoin supply',m(s.totalUsd)],['Dry powder /wk',m(s.weekChangeUsd),cls(s.weekChangeUsd)]);
  if(sent){
    t.push(['Fear & Greed',sent.fngValue+' '+(sent.fngClass||'')]);
    t.push(['BTC dominance',sent.btcDominance+'%']);
    t.push(['Total mcap',m(sent.totalMcapUsd)+' ('+(sent.mcapChange24hPct>=0?'+':'')+sent.mcapChange24hPct+'%)',cls(sent.mcapChange24hPct)]);
  }
  if(t.length)body+=tiles(t);
  if(s){
    body+='<div class="alert"><span class="lvl '+(s.weekChangeUsd>=0?'good':'critical')+'">stablecoins</span><span>'+esc(s.read)+'</span></div>';
  }
  if((d.options||[]).length){
    var orows=d.options.map(function(o){
      return '<tr><td><b>'+esc(o.currency)+'</b></td>'
        +'<td class="num '+(o.putCallOi>1?'bear':'bull')+'">'+o.putCallOi+'</td>'
        +'<td class="num">'+m(o.totalOiUsd)+'</td>'
        +'<td class="num">'+m(o.dayVolumeUsd)+'</td>'
        +'<td>'+esc(o.read)+'</td></tr>';
    });
    body+='<div style="margin-top:12px"><b style="font-size:.85rem">Options positioning</b> '
      +'<span class="sub">put/call OI &gt;1 = defensive/hedged, &lt;1 = risk-seeking</span></div>'
      +table([{label:'Coin'},{label:'Put/Call OI',num:true},{label:'Open interest',num:true},{label:'Day volume',num:true},{label:'Read'}],orows);
  }
  if(s&&(s.top||[]).length){
    body+='<details><summary>Stablecoins by size</summary>'+table(
      [{label:'Coin'},{label:'Supply',num:true},{label:'Δ week',num:true}],
      s.top.map(function(x){return '<tr><td><b>'+esc(x.sym)+'</b></td><td class="num">'+m(x.usd)+'</td>'
        +'<td class="num '+cls(x.weekChange)+'">'+m(x.weekChange)+'</td></tr>'}))+'</details>';
  }
  if((d.warns||[]).length)body+='<div class="warn">'+d.warns.map(function(w){return '<code>'+esc(w)+'</code>'}).join(' · ')+'</div>';
  return body;
};

// Journal is not a data feed — it comes from journal/*.md rather than data/*/ — so it is
// rendered from its own slot on the payload rather than through the feed registry.
function journalPanel(entries){
  if(!entries.length){
    return '<p class="empty">No entries yet. Copy <code>journal/_TEMPLATE.md</code> to '
      +'<code>journal/'+new Date().toISOString().slice(0,10)+'.md</code> and write. '
      +'Git versions every edit; the GitHub mobile app works for writing on the move.</p>';
  }
  var res={win:'good',loss:'critical',open:'warning',scratch:''};
  var counts=entries.reduce(function(a,e){ if(e.result)a[e.result]=(a[e.result]||0)+1; return a },{});
  var body='';
  if(Object.keys(counts).length)body+=tiles(Object.entries(counts).map(function(e){return [e[0],e[1]]}));
  body+=entries.slice(0,8).map(function(e){
    return '<div class="alert" style="flex-wrap:wrap">'
      +'<span class="lvl '+(res[e.result]||'')+'">'+esc(e.result||'note')+'</span>'
      +'<b>'+esc(e.date)+'</b>'
      +(e.title?'<span>'+esc(e.title)+'</span>':'')
      +e.tags.map(function(t){return '<span class="tag">'+esc(t)+'</span>'}).join('')
      +(e.mood?'<span class="tag">mood: '+esc(e.mood)+'</span>':'')
      +'<span class="drivers" style="flex-basis:100%;font-size:.76rem;color:var(--text-secondary);margin-top:3px">'
      +esc(e.excerpt)+(e.words>60?'…':'')+'</span></div>';
  }).join('');
  if(entries.length>8)body+='<p class="sub" style="margin-top:8px">'+(entries.length-8)+' older entries in <code>journal/</code></p>';
  return body;
}

// ---------------- generic fallback ----------------
// Renders any feed that has no bespoke renderer, so new collectors show up immediately.
function generic(d){
  var body='';
  var scalars=[],arrays=[];
  Object.keys(d||{}).forEach(function(k){
    if(/^(date|generatedAt)$/.test(k))return;
    var v=d[k];
    if(num(v)||typeof v==='string'&&v.length<24)scalars.push([k,num(v)&&Math.abs(v)>999?m(v):v]);
    else if(Array.isArray(v)&&v.length)arrays.push([k,v]);
    else if(v&&typeof v==='object'){
      Object.keys(v).forEach(function(k2){
        var v2=v[k2];
        if(num(v2))scalars.push([k+'.'+k2,Math.abs(v2)>999?m(v2):v2]);
        else if(Array.isArray(v2)&&v2.length)arrays.push([k+'.'+k2,v2]);
      });
    }
  });
  if(scalars.length)body+=tiles(scalars.slice(0,10));
  arrays.slice(0,4).forEach(function(pair){
    var name=pair[0],arr=pair[1];
    if(typeof arr[0]!=='object'||arr[0]===null)return;
    var cols=Object.keys(arr[0]).filter(function(c){return typeof arr[0][c]!=='object'}).slice(0,7);
    var rows=arr.slice(0,12).map(function(r){
      return '<tr>'+cols.map(function(c){
        var v=r[c];
        var isN=num(v);
        return '<td'+(isN?' class="num '+cls(v)+'"':'')+'>'+esc(isN&&Math.abs(v)>999?m(v):v)+'</td>';
      }).join('')+'</tr>';
    });
    body+='<details open><summary>'+esc(name)+' ('+arr.length+')</summary>'
      +table(cols.map(function(c){return {label:c,num:num(arr[0][c])}}),rows)+'</details>';
  });
  if((d.warns||[]).length)body+='<div class="warn">'+d.warns.map(function(w){return '<code>'+esc(w)+'</code>'}).join(' · ')+'</div>';
  return body||'<p class="empty">Feed present but nothing renderable.</p>';
}

// ---------------- assemble ----------------
var TITLES={'whale-flow':'Whale flow','smart-money':'Cross-venue composite','portfolio':'My book',
  'trust':'Trader trust','insiders':'Insider buying (Form 4)','macro-flows':'Macro & COT','macro-pulse':'Macro pulse','briefs':'Briefs',
  'events':'Events','research':'Research'};
var ORDER=['portfolio','trust','whale-flow','smart-money','macro-pulse','insiders','macro-flows'];
var names=Object.keys(F).sort(function(a,b){
  var ia=ORDER.indexOf(a),ib=ORDER.indexOf(b);
  return (ia<0?99:ia)-(ib<0?99:ib)||a.localeCompare(b);
});

var out='',nav='';
names.forEach(function(n){
  var f=F[n]; if(!f||!f.data)return;
  var title=TITLES[n]||n.replace(/-/g,' ');
  var sub=f.date+(f.count>1?' · '+f.count+' snapshots':'');
  var body;
  try{ body=(R[n]||generic)(f.data); }
  catch(e){ body='<p class="empty">Renderer error: '+esc(e.message)+'</p>'; }
  out+=card(n,title,sub,body);
  nav+='<a href="#p-'+n+'">'+esc(title)+'</a>';
  // Journal sits directly after the book, where the day's trades are freshest in mind.
  if(n==='portfolio'){
    var J=D.journal||[];
    out+=card('journal','Journal',J.length?J.length+' entries':'empty',journalPanel(J));
    nav+='<a href="#p-journal">Journal</a>';
  }
});
el('panels').innerHTML=out||'<div class="card"><p class="empty">No data yet. Run the collectors.</p></div>';
el('nav').innerHTML=nav;
})();
</script>`;

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'index.html'), html);
console.log(`Dashboard built: ${join(OUT_DIR, 'index.html')}`);
const known = ['whale-flow', 'smart-money', 'portfolio', 'trust', 'insiders', 'macro-flows', 'macro-pulse'];
for (const [k, v] of Object.entries(feeds)) {
  console.log(`  ${k.padEnd(14)} ${v.date}  (${v.count} file${v.count === 1 ? '' : 's'})  ${known.includes(k) ? 'tailored panel' : 'generic panel'}`);
}
if (!Object.keys(feeds).length) console.log('  ! no data — run the collectors first');
