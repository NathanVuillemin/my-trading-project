#!/usr/bin/env node
/**
 * Macro Bias Engine — Layer 1 (Macro Permission).
 *
 * Deterministic port of Macro_Tracker_v5.xlsx (Scorecard + Bias + Risk & Gold).
 * One weekly bias per instrument: LONG / SHORT / FLAT, with a 7-day expiry.
 * A FILTER, never an entry signal. Pure logic — no network, no LLM.
 *
 * Brain spec: AI vault/Inbox/2026-11-07 Macro Bias Engine.md
 *
 * Usage:
 *   node scripts/bias-engine.mjs --selftest        # assert against the V5 snapshot
 *   node scripts/bias-engine.mjs                    # read data/bias/inputs.json -> data/bias/board.json
 *   node scripts/bias-engine.mjs <in.json> [--out <board.json>] [--today YYYY-MM-DD]
 *
 * Exports: RULES, scoreCurrency, goldBias, riskRegime, pairBias, buildBoard.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ── Thresholds (Guide sheet, rows B20–B34). One place; every rule reads here. ──
export const RULES = {
  inflationBandPp: 0.5,      // core CPI "near target" band
  unemploymentPp: 0.2,      // 3-month unemployment move
  pmiExpansion: 52,         // composite PMI >= -> +1
  pmiContraction: 48,       // composite PMI <= -> -1
  twoYearMoveBp: 15,        // 2Y yield 1-month move (bp)
  stanceCutoff: 2,          // total >= +2 HAWKISH, <= -2 DOVISH
  pairScoreDiff: 2,         // base-quote score gap for a signal
  yieldConfirmBp: 10,       // 2Y spread must move this far, same direction
  vixCalm: 18,              // below -> risk-on side
  vixStress: 30,            // above -> RISK-OFF
  goldRealYieldBp: 15,      // 10Y real yield move for gold
  goldDollarPct: 1,         // DXY move (%) for gold
  goldCutoff: 2,            // gold total >= +2 LONG, <= -2 SHORT
  validDays: 7,             // bias expiry
};

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

// ── Per-currency score (Scorecard M,N,O,P,Q,R) ──
export function scoreCurrency(c, rules = RULES) {
  const E = num(c.coreCPI), F = num(c.coreCPI3moAgo), G = num(c.inflationTarget);
  const H = num(c.unemployment), I = num(c.unemployment3moAgo);
  const P = num(c.compositePMI);
  const K = num(c.twoYearYield), L = num(c.twoYearYield1moAgo);

  // Inflation: above target and not falling = +1; falling and near/below target = -1
  let inflation = null;
  if (E !== null && F !== null && G !== null) {
    if (E > G && E >= F) inflation = 1;
    else if (E < F && E <= G + rules.inflationBandPp) inflation = -1;
    else inflation = 0;
  }
  // Labour: unemployment down >= band = +1 (tight), up >= band = -1
  let labour = null;
  if (H !== null && I !== null) {
    const d = H - I;
    labour = d <= -rules.unemploymentPp ? 1 : d >= rules.unemploymentPp ? -1 : 0;
  }
  // Growth: composite PMI bands
  let growth = null;
  if (P !== null) growth = P >= rules.pmiExpansion ? 1 : P <= rules.pmiContraction ? -1 : 0;
  // Pricing: 2Y 1-month move in bp
  let pricing = null;
  if (K !== null && L !== null) {
    const bp = (K - L) * 100;
    pricing = bp >= rules.twoYearMoveBp ? 1 : bp <= -rules.twoYearMoveBp ? -1 : 0;
  }

  const parts = [inflation, labour, growth, pricing];
  const complete = parts.every((p) => p !== null);
  const total = complete ? parts.reduce((a, b) => a + b, 0) : null;
  const stance = total === null ? "ENTER DATA"
    : total >= rules.stanceCutoff ? "HAWKISH"
    : total <= -rules.stanceCutoff ? "DOVISH" : "NEUTRAL";

  return { inflation, labour, growth, pricing, total, stance };
}

// ── Risk regime (Risk & Gold B8) ──
export function riskRegime(r, rules = RULES) {
  const v = num(r?.vix), sp = num(r?.sp500), ma = num(r?.sp500_200dma);
  if (v === null || sp === null || ma === null) return "ENTER DATA";
  if (v > rules.vixStress) return "RISK-OFF";
  if (v >= rules.vixCalm || sp < ma) return "CAUTION";
  return "RISK-ON";
}

// ── Gold (Risk & Gold E13–E17, B18) ──
export function goldBias(g, regime, rules = RULES) {
  const ry = num(g?.realYield), ry1 = num(g?.realYield1moAgo);
  const dx = num(g?.dxy), dx1 = num(g?.dxy1moAgo);
  const research = num(g?.researchScore) ?? 0;

  let realYield = null;
  if (ry !== null && ry1 !== null) {
    const bp = (ry - ry1) * 100; // up = headwind
    realYield = bp <= -rules.goldRealYieldBp ? 1 : bp >= rules.goldRealYieldBp ? -1 : 0;
  }
  let dollar = null;
  if (dx !== null && dx1 !== null) {
    const pct = (dx / dx1 - 1) * 100; // up = headwind
    dollar = pct <= -rules.goldDollarPct ? 1 : pct >= rules.goldDollarPct ? -1 : 0;
  }
  const risk = regime === "RISK-OFF" ? 1 : 0;

  const parts = [realYield, dollar, risk, research];
  const complete = realYield !== null && dollar !== null;
  const total = complete ? parts.reduce((a, b) => a + (b ?? 0), 0) : null;
  const bias = total === null ? "ENTER DATA"
    : total >= rules.goldCutoff ? "LONG"
    : total <= -rules.goldCutoff ? "SHORT" : "FLAT";

  return { realYield, dollar, risk, research, total, bias };
}

function expiry(reviewISO, today, rules) {
  if (!reviewISO) return { lastReviewed: null, validUntil: null, status: "NOT REVIEWED" };
  const rev = new Date(reviewISO + "T00:00:00Z");
  const until = new Date(rev.getTime() + rules.validDays * 86400000);
  const status = today.getTime() > until.getTime() ? "EXPIRED" : "ACTIVE";
  return { lastReviewed: reviewISO, validUntil: until.toISOString().slice(0, 10), status };
}

// ── Per-pair bias (Scorecard Bias board D–P) ──
export function pairBias(pair, scores, currencies, regime, reviewISO, today, rules = RULES) {
  const exp = expiry(reviewISO, today, rules);
  const bScore = scores[pair.base]?.total ?? null;
  const qScore = scores[pair.quote]?.total ?? null;

  if (bScore === null || qScore === null) {
    return { symbol: pair.symbol, base: pair.base, quote: pair.quote, scoreDiff: null,
      macroSignal: "ENTER DATA", yieldsConfirm: "—", riskOverride: "—",
      finalBias: "ENTER DATA", effectiveBias: "FLAT", ...exp };
  }

  const scoreDiff = bScore - qScore;
  const macroSignal = scoreDiff >= rules.pairScoreDiff ? "LONG"
    : scoreDiff <= -rules.pairScoreDiff ? "SHORT" : "FLAT";

  const bK = num(currencies[pair.base]?.twoYearYield),  qK = num(currencies[pair.quote]?.twoYearYield);
  const bL = num(currencies[pair.base]?.twoYearYield1moAgo), qL = num(currencies[pair.quote]?.twoYearYield1moAgo);
  const spreadNow = bK !== null && qK !== null ? Math.round((bK - qK) * 100 * 10) / 10 : null;
  const spread1mo = bL !== null && qL !== null ? Math.round((bL - qL) * 100 * 10) / 10 : null;
  const spreadChg = spreadNow !== null && spread1mo !== null ? Math.round((spreadNow - spread1mo) * 10) / 10 : null;

  let yieldsConfirm = "—";
  if (macroSignal === "LONG") yieldsConfirm = spreadChg !== null && spreadChg >= rules.yieldConfirmBp ? "YES" : "NO";
  else if (macroSignal === "SHORT") yieldsConfirm = spreadChg !== null && spreadChg <= -rules.yieldConfirmBp ? "YES" : "NO";

  let riskOverride = "—";
  if (regime === "RISK-OFF" &&
      ((pair.quote === "JPY" && macroSignal === "LONG") || (pair.base === "JPY" && macroSignal === "SHORT")))
    riskOverride = "YES: JPY haven";

  const finalBias = riskOverride !== "—" ? "FLAT" : yieldsConfirm === "YES" ? macroSignal : "FLAT";
  const effectiveBias = exp.status === "EXPIRED" ? "FLAT" : finalBias;

  return { symbol: pair.symbol, base: pair.base, quote: pair.quote,
    scoreDiff, spreadNow, spread1mo, spreadChg, macroSignal, yieldsConfirm, riskOverride,
    finalBias, effectiveBias, ...exp };
}

// ── Whole board ──
export function buildBoard(input, { today = new Date() } = {}) {
  const rules = RULES;
  const scores = {};
  for (const [ccy, data] of Object.entries(input.currencies ?? {})) scores[ccy] = scoreCurrency(data, rules);

  const regime = riskRegime(input.risk, rules);
  const gold = goldBias(input.gold, regime, rules);

  const pairs = (input.pairs ?? []).map((p) => {
    if (p.type === "gold") {
      const exp = expiry(input.reviews?.[p.symbol], today, rules);
      const effectiveBias = exp.status === "EXPIRED" ? "FLAT" : gold.bias;
      return { symbol: p.symbol, type: "gold", total: gold.total, finalBias: gold.bias, effectiveBias, drivers: gold, ...exp };
    }
    return pairBias(p, scores, input.currencies, regime, input.reviews?.[p.symbol], today, rules);
  });

  return {
    generatedAt: new Date().toISOString(),
    asOf: input.asOf ?? null,
    today: today.toISOString().slice(0, 10),
    regime,
    currencies: scores,
    gold,
    pairs,
  };
}

// ── Self-test: assert against the V5 snapshot (data/bias/inputs.json) ──
function selftest() {
  const here = dirname(fileURLToPath(import.meta.url));
  const input = JSON.parse(readFileSync(resolve(here, "../data/bias/fixtures/v5-2026-10-15.json"), "utf8"));
  const board = buildBoard(input, { today: new Date("2026-10-15T00:00:00Z") });

  const checks = [];
  const eq = (name, got, want) => checks.push({ name, ok: got === want, got, want });

  eq("USD stance", board.currencies.USD.stance, "HAWKISH");
  eq("USD total", board.currencies.USD.total, 2);
  eq("EUR stance", board.currencies.EUR.stance, "NEUTRAL");
  eq("EUR total", board.currencies.EUR.total, 1);
  eq("EUR pricing (-1)", board.currencies.EUR.pricing, -1);
  eq("GBP stance", board.currencies.GBP.stance, "HAWKISH");
  eq("GBP total", board.currencies.GBP.total, 2);
  eq("JPY stance", board.currencies.JPY.stance, "NEUTRAL");
  eq("JPY inflation (0)", board.currencies.JPY.inflation, 0);
  eq("JPY total", board.currencies.JPY.total, 1);

  eq("regime", board.regime, "RISK-ON");
  eq("gold total", board.gold.total, -2);
  eq("gold bias", board.gold.bias, "SHORT");

  const pb = (s) => board.pairs.find((p) => p.symbol === s);
  eq("EURUSD final", pb("EURUSD").finalBias, "FLAT");
  eq("GBPUSD final", pb("GBPUSD").finalBias, "FLAT");
  eq("USDJPY final", pb("USDJPY").finalBias, "FLAT");
  eq("USDJPY scoreDiff (+1)", pb("USDJPY").scoreDiff, 1);
  eq("XAUUSD final", pb("XAUUSD").finalBias, "SHORT");

  const failed = checks.filter((c) => !c.ok);
  for (const c of checks) console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}${c.ok ? "" : `  got=${JSON.stringify(c.got)} want=${JSON.stringify(c.want)}`}`);
  console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
  if (failed.length) process.exit(1);
}

function run(argv) {
  if (argv.includes("--selftest")) return selftest();
  const here = dirname(fileURLToPath(import.meta.url));
  const flagsWithValue = new Set(["--out", "--today"]);
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) { if (flagsWithValue.has(argv[i])) i++; continue; }
    positional.push(argv[i]);
  }
  const inPath = positional[0] ? resolve(positional[0]) : resolve(here, "../data/bias/inputs.json");
  const outIdx = argv.indexOf("--out");
  const outPath = outIdx >= 0 ? resolve(argv[outIdx + 1]) : resolve(here, "../data/bias/board.json");
  const todayIdx = argv.indexOf("--today");
  const today = todayIdx >= 0 ? new Date(argv[todayIdx + 1] + "T00:00:00Z") : new Date();

  const input = JSON.parse(readFileSync(inPath, "utf8"));
  const board = buildBoard(input, { today });
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(board, null, 2) + "\n");

  console.log(`Bias board written: ${outPath}  (asOf ${board.asOf}, regime ${board.regime})`);
  for (const p of board.pairs) console.log(`  ${p.symbol.padEnd(7)} ${String(p.effectiveBias).padEnd(5)} (${p.finalBias}${p.status === "EXPIRED" ? ", EXPIRED" : ""})`);
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) run(process.argv.slice(2));
