// Unit tests for the drivers page maths. Run: npm run test:corr
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pearson, dailyMoves, rolling, normalBand, beta, hourlyMoves, threeDayWindow, r3dSeries,
  linkState, vixRule, gaugeRead, verdict, agree, split3, regimeTable, buildLink, buildRegime,
} from './corr-math.mjs';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('pearson: perfect, inverse, degenerate', () => {
  close(pearson([1, 2, 3, 4], [2, 4, 6, 8]), 1);
  close(pearson([1, 2, 3, 4], [4, 3, 2, 1]), -1);
  assert.equal(pearson([1, 1], [1, 2]), null);
  assert.equal(pearson([1, 1, 1], [1, 2, 3]), null);
});

test('dailyMoves: yield diff vs log return, shared dates only', () => {
  const y = new Map([['2026-01-01', 4.0], ['2026-01-02', 4.1], ['2026-01-05', 4.3]]);
  const p = new Map([['2026-01-01', 100], ['2026-01-02', 110], ['2026-01-03', 120]]);
  const m = dailyMoves(y, p, 'yield', 'price');
  assert.deepEqual(m.dates, ['2026-01-02']);
  close(m.a[0], 0.1);
  close(m.b[0], Math.log(1.1));
});

test('rolling: window values and nulls before warm-up', () => {
  const m = { a: [1, 2, 3, 4], b: [2, 4, 6, 8] };
  const r = rolling(m, 3);
  assert.equal(r[0], null);
  assert.equal(r[1], null);
  close(r[2], 1);
  close(r[3], 1);
});

test('normalBand: p10/p50/p90', () => {
  const v = Array.from({ length: 11 }, (_, i) => i / 10); // 0..1
  const b = normalBand(v);
  close(b.p10, 0.1); close(b.p50, 0.5); close(b.p90, 0.9);
  assert.equal(normalBand([]), null);
});

test('beta: slope of y on x', () => {
  close(beta([1, 2, 3], [2, 4, 6]), 2);
  close(beta([1, 2, 3], [-1, -2, -3]), -1);
});

const H = (iso) => Date.parse(iso) / 1000;
test('hourlyMoves: shared hour stamps only', () => {
  const a = new Map([[H('2026-01-05T10:00Z'), 100], [H('2026-01-05T11:00Z'), 101], [H('2026-01-05T12:00Z'), 102]]);
  const b = new Map([[H('2026-01-05T10:00Z'), 50], [H('2026-01-05T12:00Z'), 51]]);
  const m = hourlyMoves(a, b, 'price', 'price');
  assert.equal(m.t.length, 1);
  close(m.a[0], Math.log(102 / 100));
});

test('threeDayWindow: Monday run skips the weekend, keeps Thu/Fri/Mon', () => {
  const days = ['2026-01-07', '2026-01-08', '2026-01-09', '2026-01-12']; // Wed Thu Fri Mon
  const t = [], a = [], b = [];
  days.forEach((d, i) => { for (let h = 0; h < 10; h++) { t.push(H(`${d}T${String(h).padStart(2, '0')}:00Z`)); a.push(i + h); b.push(i - h); } });
  const w = threeDayWindow({ t, a, b });
  assert.equal(w.n, 30);
  assert.ok(!w.a.includes(0)); // Wed's first value (i=0,h=0) dropped
});

test('threeDayWindow / r3d: fewer than 18 moves gives null r with n', () => {
  const t = [], a = [], b = [];
  for (let h = 0; h < 10; h++) { t.push(H(`2026-01-12T${String(h).padStart(2, '0')}:00Z`)); a.push(h); b.push(h * 2); }
  const s = r3dSeries({ t, a, b });
  assert.equal(s.at(-1).r, null);
  assert.equal(s.at(-1).n, 10);
});

const D = (n) => Array.from({ length: n }, (_, i) => `2026-02-${String(i + 1).padStart(2, '0')}`);
test('linkState: hysteresis, since = last real change', () => {
  let s = linkState([0.6, 0.45, 0.35, 0.45, 0.2, 0.4], D(6), 'positive');
  assert.equal(s.state, 'out'); assert.equal(s.since, D(6)[4]); assert.equal(s.wrongWay, false);
  s = linkState([0.2, 0.55, 0.4, 0.31], D(4), 'positive');
  assert.equal(s.state, 'in'); assert.equal(s.since, D(4)[1]);
  s = linkState([-0.6], D(1), 'inverse');
  assert.equal(s.state, 'in');
  s = linkState([0.6, -0.4], D(2), 'positive');
  assert.equal(s.state, 'out'); assert.equal(s.wrongWay, true);
  s = linkState([null, null, 0.7], D(3), 'positive');
  assert.equal(s.state, 'in'); assert.equal(s.since, D(3)[2]);
});

test('vixRule: Layer 3 rule', () => {
  assert.equal(vixRule(17, 5000, 4800), 'risk-on');
  assert.equal(vixRule(17, 4700, 4800), 'caution');
  assert.equal(vixRule(31, 5000, 4800), 'risk-off');
  assert.equal(vixRule(20, 5000, 4800), 'caution');
});

test('gaugeRead: neutral band of 0.25 sd', () => {
  assert.equal(gaugeRead(0.1, 1, true), 'neutral');
  assert.equal(gaugeRead(0.5, 1, true), 'on');
  assert.equal(gaugeRead(0.5, 1, false), 'off');
  assert.equal(gaugeRead(-0.5, 1, false), 'on');
});

test('verdict: lead of 2 needed', () => {
  assert.equal(verdict(['on', 'on', 'off', 'neutral', 'on']), 'risk-on');
  assert.equal(verdict(['on', 'off', 'neutral']), 'mixed');
  assert.equal(verdict(['off', 'off', 'neutral']), 'risk-off');
});

test('agree: Excel rule', () => {
  assert.equal(agree('risk-on', 'risk-on'), 'yes');
  assert.equal(agree('caution', 'risk-on'), 'partly');
  assert.equal(agree('risk-on', 'mixed'), 'partly');
  assert.equal(agree('risk-off', 'risk-on'), 'no');
});

test('split3: thresholds', () => {
  const L = ['rising', 'flat', 'falling'];
  assert.equal(split3(30, 25, -25, L), 'rising');
  assert.equal(split3(-30, 25, -25, L), 'falling');
  assert.equal(split3(10, 25, -25, L), 'flat');
  assert.equal(split3(null, 25, -25, L), null);
});

test('regimeTable: medians and share in control per bucket', () => {
  const rows = [
    { r60: 0.6, beta: 1, inCtrl: true, vix: 'risk-on', rates: 'rising', dollar: 'flat' },
    { r60: 0.2, beta: 0, inCtrl: false, vix: 'risk-on', rates: 'rising', dollar: 'flat' },
    { r60: 0.8, beta: 2, inCtrl: true, vix: 'risk-off', rates: 'falling', dollar: 'flat' },
  ];
  const t = regimeTable(rows);
  close(t.vix['risk-on'].r60, 0.4); close(t.vix['risk-on'].shareIn, 0.5); assert.equal(t.vix['risk-on'].n, 2);
  close(t.dollar.flat.beta, 1); assert.equal(t.dollar.flat.n, 3);
});

test('buildLink: missing series gives no data', () => {
  const l = buildLink({ id: 'x', target: 'A', driver: 'B', typical: 'positive' }, {}, {}, new Map());
  assert.equal(l.status, 'no data');
});

test('buildRegime: calm rising market reads risk-on, rising 2Y reads rates rising', () => {
  const dates = Array.from({ length: 320 }, (_, i) => new Date(Date.UTC(2025, 0, 1) + i * 864e5).toISOString().slice(0, 10));
  const mk = (f) => new Map(dates.map((d, i) => [d, f(i)]));
  const s = {
    vix: mk(() => 15), spx: mk((i) => 4000 + i * 5), us2y: mk((i) => 3 + i * 0.01), dxy: mk(() => 100),
    audjpy: mk((i) => 90 + i * 0.05), copper: mk((i) => 4 + i * 0.002), gold: mk(() => 2000), hy: mk(() => 3),
    xly: mk((i) => 200 + i * 0.2), xlp: mk(() => 80), usdjpy: mk(() => 150), usdchf: mk(() => 0.9), tlt: mk(() => 90),
  };
  const r = buildRegime(s);
  assert.equal(r.now.vix.rule, 'risk-on');
  assert.equal(r.now.rates.split, 'rising');
  assert.equal(r.now.dollar.split, 'flat');
  assert.equal(r.byDate.get(dates.at(-1)).vix, 'risk-on');
  assert.equal(r.now.verdict, 'risk-on');
});

test('buildRegime: small-valued gauge sparklines keep their shape (copper/gold ~0.0002)', () => {
  const dates = Array.from({ length: 300 }, (_, i) => new Date(Date.UTC(2025, 0, 1) + i * 864e5).toISOString().slice(0, 10));
  const mk = (f) => new Map(dates.map((d, i) => [d, f(i)]));
  const flat = mk(() => 1);
  const r = buildRegime({ vix: mk(() => 15), spx: mk((i) => 4000 + i), us2y: flat, dxy: flat, audjpy: flat, copper: mk((i) => 4 + i * 0.01), gold: mk(() => 20000), hy: flat, xly: flat, xlp: flat, usdjpy: flat, usdchf: flat, tlt: flat });
  const sp = r.now.gauges.find((g) => g.key === 'copperGold').spark;
  assert.notEqual(sp[0][1], sp.at(-1)[1]);
});
