// Merge a research block into one idea on the Trading Desk ideas page.
//
// Nathan writes ideas raw on dashboard/desk/ideas.html. The idea-researcher agent reads one, checks the
// claims it rests on, and writes a research file. This script puts that file under the idea as `research`
// and leaves everything Nathan typed (date, source, text, status) untouched. A second run on the same idea
// replaces the earlier research. Commit ideas.json to publish.
//
// Usage: node scripts/idea-research.mjs --apply <research.json>   merge one file
//        node scripts/idea-research.mjs --list                     show open ideas and whether they have research
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const IDEAS = join('dashboard', 'desk', 'data', 'ideas.json');
const SUGGEST = ['keep', 'drop', 'watch'], VERDICT = ['holds', 'breaks', 'unclear'];
const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null);
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

const data = readJson(IDEAS);
data.ideas = data.ideas || [];

if (process.argv.includes('--list')) {
  for (const i of data.ideas) {
    const r = i.research;
    console.log(`${i.id}  ${i.date}  ${i.status.padEnd(7)}  ${r ? `research ${r.researchedAt} (${r.suggest})` : 'no research'}  ${i.text.slice(0, 70).replace(/\s+/g, ' ')}`);
  }
  process.exit(0);
}

const file = arg('--apply');
if (!file) { console.error('Usage: node scripts/idea-research.mjs --apply <research.json> | --list'); process.exit(1); }
const r = readJson(file);

const errors = [];
const str = (k) => { if (typeof r[k] !== 'string' || !r[k].trim()) errors.push(`${k} missing`); };
const arr = (k) => { if (!Array.isArray(r[k])) errors.push(`${k} must be a list`); };
['id', 'researchedAt', 'thesis', 'priced', 'routineFit', 'why'].forEach(str);
['instruments', 'claims', 'confirm', 'kill', 'watch', 'sources'].forEach(arr);
if (!SUGGEST.includes(r.suggest)) errors.push(`suggest must be one of ${SUGGEST.join(', ')}`);
if (!/^\d{4}-\d{2}-\d{2}$/.test(r.researchedAt || '')) errors.push('researchedAt must be YYYY-MM-DD');
for (const [n, c] of (r.claims || []).entries()) {
  if (!c.claim || !c.evidence) errors.push(`claim ${n + 1} needs claim and evidence`);
  if (!VERDICT.includes(c.verdict)) errors.push(`claim ${n + 1} verdict must be one of ${VERDICT.join(', ')}`);
}
if (errors.length) { console.error('Research file rejected:\n  ' + errors.join('\n  ')); process.exit(1); }

const idea = data.ideas.find((i) => i.id === r.id);
if (!idea) { console.error(`No idea with id ${r.id}. Open ideas:\n` + data.ideas.map((i) => `  ${i.id}  ${i.text.slice(0, 60)}`).join('\n')); process.exit(1); }

const { id, ...research } = r;
const before = idea.research?.researchedAt;
idea.research = research;
writeFileSync(IDEAS, JSON.stringify(data, null, 2) + '\n');
console.log(`${before ? 'Replaced' : 'Added'} research on ${id} (${research.suggest}, ${research.claims.length} claims). Nathan's fields untouched. Commit ${IDEAS} to publish.`);
