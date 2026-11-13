// Fill the data fields of a weekly scorecard on the Trading Desk from a readings file.
//
// Nathan reads each economy's inflation, growth, unemployment and central-bank stance from his data
// provider and types them into the scorecard. This script does that typing for him from a file of
// readings taken at one moment, and keeps the figure behind every label so he can check it. It never
// touches what is his: the sentence, the call, "strong", "crowded", pairs and events. A label he has
// changed by hand is kept, and nothing is invented: a reading that is missing or not understood is
// left blank and reported.
//
// Usage: node scripts/desk-fill.mjs --readings <file.json> [--week YYYY-MM-DD]
//   readings: { source, readAt, economies: { USD: { inflation|growth|labour: { name, value, projection, level, dir },
//               rates: { policy, y2, spreadBp, priced, stance } }, ... } }
//   --week:   Monday of the trading week (default: this week's Monday; on Saturday and Sunday, the coming one)
// Writes dashboard/desk/data/scorecard-<monday>.json and scorecard-index.json. Commit them to publish.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const CCYS = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD'];
const LEVELS = ['low', 'normal', 'high'], DIRS = ['rising', 'steady', 'falling'], STANCES = ['hawkish', 'neutral', 'dovish'];
const THEMES = ['inflation', 'growth', 'labour'];
const DATA = join('dashboard', 'desk', 'data');

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null);
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const writeJson = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2) + '\n');
const low = (v) => String(v ?? '').trim().toLowerCase();

// Same shapes and rules as the page (assets/desk.js): keep the two in step.
const blankRow = () => ({ growth: { level: '', dir: '' }, inflation: { level: '', dir: '' }, labour: { level: '', dir: '' }, sentence: '', lean: '', priced12m: null, weekChange: null, call: '', strong: false, crowded: false, rank1m: null });
const blankCard = (monday) => ({ monday, updated: null, active: ['USD', 'EUR', 'JPY', 'GBP'], currencies: Object.fromEntries(CCYS.map((c) => [c, blankRow()])), pairs: [], events: [] });
function score(row) {
  const base = { tooLittle: 1, aboutRight: 0, tooMuch: -1 }[row.call];
  if (base == null) return null;
  const mag = Math.max(0, Math.abs(base) * (row.strong ? 2 : 1) - (row.crowded ? 1 : 0));
  return mag === 0 ? 0 : Math.sign(base) * mag;
}
function mondayOf(d = new Date()) {
  const day = d.getDay(), shift = day === 0 ? 1 : day === 6 ? 2 : 1 - day;
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate() + shift);
  return `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}-${String(m.getDate()).padStart(2, '0')}`;
}

const readingsPath = arg('--readings');
if (!readingsPath) { console.error('Usage: node scripts/desk-fill.mjs --readings <file.json> [--week YYYY-MM-DD]'); process.exit(1); }
const readings = readJson(readingsPath);
if (!readings.source || !readings.readAt || !readings.economies) { console.error('Readings need source, readAt and economies.'); process.exit(1); }
const monday = arg('--week') || mondayOf();
if (!/^\d{4}-\d{2}-\d{2}$/.test(monday)) { console.error(`Bad --week: ${monday}`); process.exit(1); }

const cardPath = join(DATA, `scorecard-${monday}.json`), indexPath = join(DATA, 'scorecard-index.json');
const card = existsSync(cardPath) ? readJson(cardPath) : blankCard(monday);
card.currencies = card.currencies || {};
for (const c of CCYS) card.currencies[c] = { ...blankRow(), ...(card.currencies[c] || {}) };

const filled = [], missing = [], kept = [], lines = [];
for (const code of CCYS) {
  const e = readings.economies[code];
  if (!e) { missing.push(`${code} (not read)`); continue; }
  const row = card.currencies[code], before = row.auto || {}, auto = { source: readings.source, readAt: readings.readAt };
  let any = false;
  for (const key of THEMES) {
    const r = e[key] || {}, level = low(r.level), dir = low(r.dir);
    if (!LEVELS.includes(level) || !DIRS.includes(dir)) { missing.push(`${code} ${key}`); continue; }
    auto[key] = { name: r.name ?? '', value: r.value ?? '', projection: r.projection ?? '', level, dir };
    // His own change stands: a label that differs from what was last filled, or typed before any fill.
    const hisOwn = before[key] ? (row[key].level !== before[key].level || row[key].dir !== before[key].dir) : (row[key].level !== '' || row[key].dir !== '');
    if (hisOwn && (row[key].level !== level || row[key].dir !== dir)) kept.push(`${code} ${key} (${row[key].level || '—'} · ${row[key].dir || '—'}, read ${level} · ${dir})`);
    else row[key] = { level, dir };
    any = true;
  }
  const rt = e.rates || {}, stance = low(rt.stance);
  if (STANCES.includes(stance)) {
    auto.rates = { policy: rt.policy ?? '', y2: rt.y2 ?? '', spreadBp: rt.spreadBp ?? null, priced: rt.priced ?? '', stance };
    const hisOwn = before.rates ? row.lean !== before.rates.stance : row.lean !== '';
    if (hisOwn && row.lean !== stance) kept.push(`${code} bank lean (${row.lean || '—'}, read ${stance})`);
    else row.lean = stance;
    any = true;
  } else missing.push(`${code} bank stance`);
  if (any) { row.auto = auto; filled.push(code); }
  const t = (k) => (auto[k] ? `${String(auto[k].value).padStart(6)} ${auto[k].level}·${auto[k].dir}`.padEnd(24) : 'not filled'.padEnd(24));
  lines.push(`${code}  infl ${t('inflation')} growth ${t('growth')} unemp ${t('labour')} bank ${auto.rates ? auto.rates.stance : 'not filled'}`);
}
card.autoFill = { source: readings.source, readAt: readings.readAt, currencies: filled, missing };
writeJson(cardPath, card);

const index = existsSync(indexPath) ? readJson(indexPath) : { weeks: [] };
const entry = { monday, pairs: (card.pairs || []).map(({ pair, dir }) => ({ pair, dir })), scores: Object.fromEntries((card.active || []).map((c) => [c, score(card.currencies[c])]).filter(([, s]) => s != null)) };
index.weeks = [entry, ...(index.weeks || []).filter((w) => w.monday !== monday)].sort((a, b) => (a.monday < b.monday ? 1 : -1));
writeJson(indexPath, index);

console.log(`Scorecard week of ${monday}, from ${readings.source}, read ${readings.readAt}`);
console.log(lines.join('\n'));
if (kept.length) console.log(`Kept as Nathan set them: ${kept.join('; ')}`);
console.log(missing.length ? `NOT FILLED: ${missing.join('; ')}` : 'Every field read was filled.');
console.log(`Wrote ${cardPath} and ${indexPath}`);
