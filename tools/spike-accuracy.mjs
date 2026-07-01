// =====================================================================
// Title→SOC Resolver Accuracy Spike — spike-accuracy.mjs
// =====================================================================
// Loads the built artifacts and resolves a REAL-WORLD test set: titles the
// owner actually encountered (per PROJECT_PROGRESS 13.7), his résumé's own
// roles, his search queries, and messy job-board formatting. Reports hit rate,
// resolved occupation + Job Zone, and confidence so quality can be eyeballed.
// Run: node tools/spike-accuracy.mjs   (after build-onet.mjs)
// =====================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveTitle, hydrateIndex, normalizeTitle } from './onet-resolver.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(__dirname, '..', 'pb_public', 'js', 'data');
const titles = JSON.parse(fs.readFileSync(path.join(DATA, 'onet-titles.json'), 'utf8'));
const zones = JSON.parse(fs.readFileSync(path.join(DATA, 'onet-zones.json'), 'utf8'));
const index = hydrateIndex(titles);

// Real test set. `okIf` = regex the resolved O*NET occupation title must match to
// count as CORRECT (my honest ballpark judgment). This converts "resolvability"
// into TRUE accuracy — the number that actually matters for the pivot.
const TESTS = [
  // — Titles the owner actually saw (13.7 problem/good cases) —
  ['Offensive Security Engineer', /security|information security/i],
  ['Quality Engineer', /quality|test/i],
  ['Senior C++ Software Engineer', /software|developer|programmer/i],
  ['DB2 Programmer', /programmer|developer|database/i],
  ['ML Test Engineer', /software|test|quality|data/i],
  ['Data Scientist', /data scientist/i],
  ['Parts Sales Manager', /sales/i],
  ['Water Infrastructure Specialist', /civil|environmental|water|utilit/i],
  ['Product Manager', /product|project management/i],
  ['Head of Sales', /sales/i],
  ['Revenue Operations Manager', /operations manager|general and operations|sales manager/i],
  ['Senior Account Executive', /sales/i],
  ['Sales Development Representative', /sales/i],
  ['Accounts Payable Clerk', /account|bookkeep|clerk|financial clerk/i],
  // — Résumé roles —
  ['Director of Business Development', /sales|business|marketing|general and operations/i],
  ['Sales Consultant', /sales/i],
  ['Advanced AI Logic Evaluator', /never/],   // no true O*NET occ — SHOULD abstain
  ['Director of Acquisitions & Research Operations', /operations|management|general/i],
  ['Senior Supervisor, Tier III Escalations & Logistics', /supervisor|logistic|customer|manager/i],
  ['General Manager', /general and operations|general manager/i],
  ['Principal Consultant', /management analyst|consultant|business/i],
  // — Search queries —
  ['Business Development', /sales|business|marketing/i],
  ['Operations Manager', /operations manager|general and operations/i],
  ['Process Improvement', /industrial|quality|process|operations/i],
  ['AI Evaluator', /never/],   // no true O*NET occ — SHOULD abstain
  ['Systems Architecture', /computer|software|network|systems/i],
  ['Data Operations', /data|database|computer|operations/i],
  // — Messy real-world job-board formatting (normalizer stress) —
  ['Sr. Account Exec - SaaS (Remote)', /sales/i],
  ['Revenue Operations Manager | B2B SaaS', /operations manager|general and operations|sales manager/i],
  ['Customer Success Manager (Hybrid)', /customer|success|account manager|sales/i],
  ['Registered Nurse - ICU', /registered nurse|nurse/i],
];

// Abstain rule: a fuzzy match is only TRUSTED if it rests on ≥2 matched tokens
// AND clears a confidence floor AND isn't a near-tie. Otherwise → abstain ('none').
function resolveGated(raw) {
  const r = resolveTitle(raw, index);
  if (r.matchType !== 'fuzzy') return r;
  const nTok = countMatchedTokens(raw);
  const trusted = nTok >= 2 && r.confidence >= 0.5 && (r.runnerUp || 0) <= 0.85;
  return trusted ? r : { soc: null, matchType: 'none', confidence: r.confidence, gatedFrom: r.soc };
}
function countMatchedTokens(raw) {
  const { tokens } = normalizeTitle(raw);
  let n = 0; for (const t of new Set(tokens)) if (index.tokenIndex[t]) n++; return n;
}

for (const mode of ['raw', 'gated']) {
  console.log(`\n\n========== MODE: ${mode.toUpperCase()} ${mode === 'gated' ? '(abstain when uncertain)' : '(always force best match)'} ==========\n`);
  let resolved = 0, correct = 0, wrongConfident = 0, abstained = 0, noZone = 0;
  for (const [title, okIf] of TESTS) {
    const r = mode === 'gated' ? resolveGated(title) : resolveTitle(title, index);
    const occ = r.soc ? (titles.socTitles[r.soc] || '?') : '(abstain)';
    const zone = r.soc ? (zones[r.soc] ?? '—') : '—';
    const isCorrect = r.soc && okIf.test(occ);
    if (r.soc) { resolved++; if (isCorrect) correct++; else if (r.matchType === 'exact' || r.confidence >= 0.7) wrongConfident++; if (zone === '—') noZone++; }
    else abstained++;
    const mark = !r.soc ? '·abstain' : isCorrect ? '✓' : '✗WRONG';
    const conf = r.matchType === 'exact' ? '1.00' : (r.confidence || 0).toFixed(2);
    console.log(`  ${mark.padEnd(8)} ${title.padEnd(42)} → [${r.matchType} ${conf}] ${occ}${r.soc ? ` (Zone ${zone})` : ''}`);
  }
  const N = TESTS.length;
  console.log(`\n  resolved: ${resolved}/${N}   CORRECT: ${correct}/${N} = ${((correct / N) * 100).toFixed(0)}%   confidently-WRONG: ${wrongConfident}   abstained: ${abstained}   no-JobZone: ${noZone}`);
  console.log(`  precision (correct / resolved): ${resolved ? ((correct / resolved) * 100).toFixed(0) : 0}%`);
}
