#!/usr/bin/env node
// build-bias-dashboard.mjs — render the macro bias board into one self-contained page.
//
// Reads data/bias/board.json (+ inputs.json for freshness/gaps) and writes
// dashboard/bias.html — no external requests, opens from file://, deploys to Pages.
// Your User bias + review date are kept per-device in localStorage, with an Export
// button that prints data/bias/user.json for committing.
//
// Usage: node scripts/build-bias-dashboard.mjs   |   npm run bias:dash

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, "..");
const BIAS = join(ROOT, "data", "bias");
const OUT_DIR = join(ROOT, "dashboard");

const board = JSON.parse(readFileSync(join(BIAS, "board.json"), "utf8"));
let inputs = {};
try { inputs = JSON.parse(readFileSync(join(BIAS, "inputs.json"), "utf8")); } catch {}

// newest source observation date = how fresh the data really is
let freshest = null;
for (const s of Object.values(inputs._sources ?? {})) {
  if (s.obsDate && (!freshest || s.obsDate > freshest)) freshest = s.obsDate;
}

const payload = { board, gaps: inputs._gaps ?? [], sources: inputs._sources ?? {}, freshest, asOf: inputs.asOf ?? board.asOf };

const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Macro Bias Board</title>
<style>
  :root{--bg:#0d1117;--card:#161b22;--line:#273040;--ink:#e6edf3;--mut:#8b949e;
    --long:#2ea043;--short:#f85149;--flat:#6e7681;--warn:#d29922;--accent:#58a6ff}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;padding:16px}
  h1{font-size:18px;margin:0 0 2px} .sub{color:var(--mut);font-size:12px;margin-bottom:16px}
  .wrap{max-width:960px;margin:0 auto}
  .row{display:flex;flex-wrap:wrap;gap:12px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px}
  .pair{flex:1 1 210px}
  .badge{display:inline-block;padding:2px 9px;border-radius:999px;font-weight:700;font-size:12px;letter-spacing:.3px}
  .LONG,.HAWKISH{background:rgba(46,160,67,.18);color:var(--long)}
  .SHORT,.DOVISH{background:rgba(248,81,73,.18);color:var(--short)}
  .FLAT,.NEUTRAL{background:rgba(110,118,129,.2);color:var(--flat)}
  .EXPIRED{background:rgba(210,153,34,.18);color:var(--warn)}
  .ACTIVE{background:rgba(46,160,67,.14);color:var(--long)}
  .sym{font-size:16px;font-weight:700} .mut{color:var(--mut)}
  .kv{display:flex;justify-content:space-between;margin:5px 0;font-size:13px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th,td{text-align:right;padding:6px 8px;border-bottom:1px solid var(--line)} th:first-child,td:first-child{text-align:left}
  th{color:var(--mut);font-weight:600}
  .sc{font-weight:700} .p1{color:var(--long)} .n1{color:var(--short)} .z{color:var(--flat)}
  select,input{background:#0d1117;color:var(--ink);border:1px solid var(--line);border-radius:6px;padding:4px 7px;font:inherit}
  button{background:var(--accent);color:#06101f;border:0;border-radius:6px;padding:6px 12px;font-weight:700;cursor:pointer}
  h2{font-size:13px;text-transform:uppercase;letter-spacing:.5px;color:var(--mut);margin:22px 0 8px}
  .gap{color:var(--warn);font-size:12px;margin:3px 0}
  details{margin-top:6px} summary{cursor:pointer;color:var(--accent);font-size:12px}
  textarea{width:100%;height:120px;background:#0d1117;color:var(--ink);border:1px solid var(--line);border-radius:6px;font:12px monospace;margin-top:8px}
</style></head><body><div class="wrap">
<h1>Macro Bias Board <span class="mut" style="font-size:12px">· Layer 1 permission</span></h1>
<div class="sub" id="sub"></div>
<div class="row" id="pairs"></div>
<h2>Currency scorecard</h2>
<div class="card"><table id="scorecard"></table></div>
<h2>Gold drivers</h2>
<div class="card"><table id="gold"></table></div>
<h2>Data gaps &amp; freshness</h2>
<div class="card" id="gaps"></div>
<h2>Your biases (saved on this device)</h2>
<div class="card">
  <p class="mut" style="font-size:12px;margin-top:0">Set your read and today's review per pair. Review clears EXPIRED for 7 days. Export writes <code>data/bias/user.json</code> to commit.</p>
  <table id="user"></table>
  <div style="margin-top:10px"><button onclick="exportUser()">Export user.json</button> <button onclick="reviewAll()" style="background:#21262d;color:var(--ink)">Mark all reviewed today</button></div>
  <details><summary>user.json</summary><textarea id="out" readonly></textarea></details>
</div>
<p class="sub" style="margin-top:18px">Static build — <code>npm run bias:dash</code> regenerates after <code>npm run bias</code>. No external requests.</p>
</div>
<script type="application/json" id="data">${JSON.stringify(payload).replace(/</g, "\\u003c")}</script>
<script>
const P = JSON.parse(document.getElementById('data').textContent);
const b = P.board, VALID_DAYS = 7, PAIRS = b.pairs.map(p=>p.symbol);
const LS = 'biasUser';
const store = JSON.parse(localStorage.getItem(LS) || '{}');
const sc = v => v===1?'<span class="sc p1">+1</span>':v===-1?'<span class="sc n1">-1</span>':v===0?'<span class="sc z">0</span>':'<span class="mut">—</span>';
const bd = t => '<span class="badge '+t+'">'+t+'</span>';
const daysBetween = (a,b)=>Math.floor((b-a)/864e5);

function liveStatus(sym){ // recompute status from the user's review date
  const r = store[sym]?.review;
  if(!r) return 'NOT REVIEWED';
  const until = new Date(r+'T00:00:00Z').getTime()+VALID_DAYS*864e5;
  return Date.now()>until ? 'EXPIRED':'ACTIVE';
}
function effective(p){
  const st = store[p.symbol]?.review ? liveStatus(p.symbol) : p.status;
  return st==='EXPIRED' ? 'FLAT' : p.finalBias;
}

document.getElementById('sub').innerHTML =
  'Regime '+bd(b.regime)+' · data as of <b>'+(P.freshest||P.asOf||'?')+'</b> · generated '+new Date(b.generatedAt).toLocaleString();

// pair cards
document.getElementById('pairs').innerHTML = b.pairs.map(p=>{
  const st = store[p.symbol]?.review ? liveStatus(p.symbol) : p.status;
  const eff = st==='EXPIRED'?'FLAT':p.finalBias;
  const user = store[p.symbol]?.bias || '—';
  const conf = p.yieldsConfirm ? (p.yieldsConfirm==='YES'?'yields confirm':p.yieldsConfirm==='NO'?'yields do not confirm':'—') : '';
  return '<div class="card pair"><div class="kv"><span class="sym">'+p.symbol+'</span>'+bd(eff)+'</div>'+
    '<div class="kv"><span class="mut">model signal</span><span>'+bd(p.macroSignal||p.finalBias)+'</span></div>'+
    (p.scoreDiff!=null?'<div class="kv"><span class="mut">score diff</span><span>'+p.scoreDiff+'</span></div>':'')+
    (p.spreadNow!=null?'<div class="kv"><span class="mut">2Y spread Δ</span><span>'+(p.spreadChg>0?'+':'')+p.spreadChg+' bp</span></div>':'')+
    (p.total!=null&&p.type==='gold'?'<div class="kv"><span class="mut">gold total</span><span>'+p.total+'</span></div>':'')+
    (conf?'<div class="kv"><span class="mut">'+conf+'</span><span></span></div>':'')+
    '<div class="kv"><span class="mut">your bias</span><span>'+bd(user==='—'?'FLAT':user).replace('>'+ (user==='—'?'FLAT':user),'>'+user)+'</span></div>'+
    '<div class="kv"><span class="mut">status</span>'+bd(st)+'</div></div>';
}).join('');

// scorecard
const C = b.currencies;
let sch = '<tr><th>CCY</th><th>Infl</th><th>Labour</th><th>Growth</th><th>Pricing</th><th>Total</th><th>Stance</th></tr>';
for(const [k,v] of Object.entries(C)) sch += '<tr><td><b>'+k+'</b></td><td>'+sc(v.inflation)+'</td><td>'+sc(v.labour)+'</td><td>'+sc(v.growth)+'</td><td>'+sc(v.pricing)+'</td><td class="sc">'+(v.total??'—')+'</td><td>'+bd(v.stance)+'</td></tr>';
document.getElementById('scorecard').innerHTML = sch;

// gold
const g = b.gold;
document.getElementById('gold').innerHTML =
  '<tr><th>Driver</th><th>Score</th></tr>'+
  '<tr><td>Real yield (10Y)</td><td>'+sc(g.realYield)+'</td></tr>'+
  '<tr><td>Dollar (DXY)</td><td>'+sc(g.dollar)+'</td></tr>'+
  '<tr><td>Risk regime</td><td>'+sc(g.risk)+'</td></tr>'+
  '<tr><td>Research</td><td>'+sc(g.research)+'</td></tr>'+
  '<tr><td><b>Total → bias</b></td><td class="sc">'+(g.total??'—')+' '+bd(g.bias)+'</td></tr>';

// gaps
let gh = '<div class="kv"><span class="mut">freshest observation</span><span>'+(P.freshest||'?')+'</span></div>';
gh += (P.gaps||[]).map(x=>'<div class="gap">⚠ '+x+'</div>').join('') || '<div class="mut">none</div>';
document.getElementById('gaps').innerHTML = gh;

// user editor
const BIASES = ['—','LONG','SHORT','FLAT'];
function userRows(){
  document.getElementById('user').innerHTML =
    '<tr><th>Pair</th><th>Your bias</th><th>Reviewed</th><th>Status</th></tr>'+
    PAIRS.map(s=>{
      const u=store[s]||{};
      const opts=BIASES.map(x=>'<option'+(u.bias===x?' selected':'')+'>'+x+'</option>').join('');
      return '<tr><td><b>'+s+'</b></td>'+
        '<td><select onchange="setBias(\\''+s+'\\',this.value)">'+opts+'</select></td>'+
        '<td><input type="date" value="'+(u.review||'')+'" onchange="setReview(\\''+s+'\\',this.value)"></td>'+
        '<td>'+bd(u.review?liveStatus(s):'NOT REVIEWED')+'</td></tr>';
    }).join('');
}
function save(){localStorage.setItem(LS,JSON.stringify(store));userRows();}
function setBias(s,v){store[s]=store[s]||{};if(v==='—')delete store[s].bias;else store[s].bias=v;save();}
function setReview(s,v){store[s]=store[s]||{};if(!v)delete store[s].review;else store[s].review=v;save();}
function reviewAll(){const t=new Date().toISOString().slice(0,10);PAIRS.forEach(s=>{store[s]=store[s]||{};store[s].review=t;});save();}
function exportUser(){
  const out={updatedAt:new Date().toISOString(),reviews:{},userBias:{}};
  PAIRS.forEach(s=>{if(store[s]?.review)out.reviews[s]=store[s].review;if(store[s]?.bias)out.userBias[s]=store[s].bias;});
  document.getElementById('out').value=JSON.stringify(out,null,2);
  document.querySelector('details').open=true;
}
userRows();
</script></body></html>`;

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "bias.html"), html);
console.log(`Wrote ${join(OUT_DIR, "bias.html")}  (regime ${board.regime}, ${board.pairs.length} pairs, data ${freshest || board.asOf})`);
