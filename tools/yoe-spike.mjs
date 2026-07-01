// =====================================================================
// YoE / "Highest & Best Use" Profiler — SPIKE v2 (yoe-spike.mjs)
// =====================================================================
// v1 proved date-slicing works but exposed 3 honesty bugs: overlap double-counts
// (logistics 20.9y > sales), incidental-mention inflation (phantom 16.6y finance
// from one "payroll"), and empty soft skills (header-only + morphology). v2 fixes:
//   • CALENDAR-UNION years (merge overlapping role intervals per skill)
//   • PROMINENCE gate (attribute a skill to a role only if it's a signal term,
//     OR appears ≥2×, OR appears in the title) → kills incidental inflation
//   • stemmed + expanded soft matcher, and soft skills also read the summary header
// Uses the app's OWN curated vocab (competency-profiler) via vm. Read-only.
// Run: node tools/yoe-spike.mjs
// =====================================================================
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const JS = path.join(ROOT, 'pb_public', 'js');
const NOW = { y: 2026, m: 6 };

const ctx = { console, Math, Date, JSON, RegExp, Set, Map, Array, Object, String, Number, parseFloat, parseInt, isNaN, isFinite };
ctx.window = {}; ctx.self = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for (const rel of ['config.js','scoring/ambiguity-index.js','scoring/transition-friction.js','scoring/evaluator.js','scoring/skill-matcher.js','scoring/competency-profiler.js','scoring/culture-evaluator.js','scoring/industry-classifier.js','ai/resume-parser.js','scoring/scoring-coordinator.js'])
  vm.runInContext(fs.readFileSync(path.join(JS, rel), 'utf8'), ctx, { filename: rel });
const DOMAINS = ctx.window.competencyProfiler.DOMAINS;

function compile(t, g = false) {
  if (t.includes('\\')) return new RegExp(t, g ? 'ig' : 'i');
  const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const sb = /^[a-z0-9]/i.test(t) ? '\\b' : ''; const eb = /[a-z0-9]$/i.test(t) ? '\\b' : '';
  return new RegExp(`${sb}${esc}${eb}`, g ? 'ig' : 'i');
}
// HARD vocab, tagged signal vs context.
const HARD = [];
for (const [dom, { signal, context }] of Object.entries(DOMAINS)) {
  for (const t of signal)  HARD.push({ label: t.replace(/\\b|\\/g,''), domain: dom, isSignal: true,  re: compile(t), reG: compile(t, true) });
  for (const t of context) HARD.push({ label: t.replace(/\\b|\\/g,''), domain: dom, isSignal: false, re: compile(t), reG: compile(t, true) });
}
// SOFT vocab — stems so "mentor" catches mentoring/mentored, "negotiat" catches
// negotiation/renegotiations. Start-boundary only.
const SOFT = [
  ['leadership', /\b(lead(ership|ing)?|led|director|directed|spearhead|championed)/i],
  ['mentoring/coaching', /\b(mentor|coach|train(ed|ing|s)?\b)/i],
  ['negotiation', /negotiat/i],
  ['communication', /\bcommunicat/i],
  ['collaboration/teamwork', /\b(collaborat|teamwork|cross.?functional|team lead)/i],
  ['adaptability', /\badaptab|\bpivot|\bversatil/i],
  ['problem solving', /\bproblem.solving|\btroubleshoot|\bresolv/i],
  ['strategy', /\bstrateg/i],
  ['organization', /\borganiz|\borganis|\bcoordinat/i],
  ['initiative', /\binitiativ|\bproactiv|\bself.start/i],
];

// ── Parse résumé into dated roles ────────────────────────────────────────────
const text = fs.readFileSync(path.join(ROOT, 'Sean_Deardorff_06232026_1939.md'), 'utf8');
const MON = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?';
const MIDX = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
const re = new RegExp(`(${MON})?\\s*((?:19|20)\\d{2})\\s*(?:–|—|-|to|through|until)\\s*(?:(present|current)|(${MON})?\\s*((?:19|20)\\d{2}))`, 'ig');
const mi = s => s ? (MIDX[s.slice(0,3).toLowerCase()] ?? 0) : 0;
const matches = []; let m;
while ((m = re.exec(text)) !== null) matches.push({ idx: m.index, end: m.index + m[0].length,
  sV: +m[2] + mi(m[1])/12, eV: (m[3] ? NOW.y : +m[5]) + (m[3] ? NOW.m : mi(m[4]))/12, present: !!m[3], sY:+m[2], eY:m[3]?NOW.y:+m[5] });

const SELF = /self.?employed|founder|principal consultant|1099|freelance|sole proprietor|\bllc\b|co.?founder/i;
const summaryHeader = text.substring(0, matches.length ? matches[0].idx : 0); // summary + core competencies
const roles = [];
for (let i = 0; i < matches.length; i++) {
  const d = matches[i];
  const title = text.substring(i === 0 ? 0 : matches[i-1].end, d.idx).replace(/\s+/g,' ').trim().slice(-90);
  const window = text.substring(d.end, i + 1 < matches.length ? matches[i+1].idx : text.length);
  roles.push({ title, window, interval: [d.sV, d.eV], years: Math.max(0, d.eV - d.sV),
    span: `${d.sY}-${d.present ? 'now' : d.eY}`, selfEmp: SELF.test(title) });
}

// ── Attribute with prominence gate → per-skill intervals → calendar-union ─────
function unionYears(ivals) {
  if (!ivals.length) return 0;
  const s = ivals.slice().sort((a,b)=>a[0]-b[0]); let total=0, cs=s[0][0], ce=s[0][1];
  for (let i=1;i<s.length;i++){ const [a,b]=s[i]; if (a<=ce) ce=Math.max(ce,b); else { total+=ce-cs; cs=a; ce=b; } }
  return total + (ce-cs);
}
const hardIv = new Map(), softIv = new Map(), domIv = new Map();
const push = (map,k,iv)=>{ let a=map.get(k); if(!a){a=[];map.set(k,a);} a.push(iv); };
for (const r of roles) {
  const seenDom = new Set();
  for (const h of HARD) {
    const inTitle = h.re.test(r.title);
    const n = (r.window.match(h.reG) || []).length;
    const present = inTitle || n >= 1;
    // PROMINENCE gate: the skill must be PRESENT, and either a concrete signal term,
    // OR mentioned ≥2×, OR named in the title. A lone incidental mention of a generic
    // CONTEXT term (e.g. one "payroll") no longer grants years.
    if (present && (inTitle || h.isSignal || n >= 2)) {
      push(hardIv, h.label, r.interval);
      if (!seenDom.has(h.domain)) { push(domIv, h.domain, r.interval); seenDom.add(h.domain); }
    }
  }
  for (const [label, pat] of SOFT) if (pat.test(r.window) || pat.test(r.title)) push(softIv, label, r.interval);
}

const rank = map => [...map.entries()].map(([k,iv])=>[k, unionYears(iv)]).sort((a,b)=>b[1]-a[1]);

// ── Report ───────────────────────────────────────────────────────────────────
console.log(`\n=== Parsed roles ===`);
for (const r of roles) console.log(`  ${r.span.padEnd(9)} ${r.years.toFixed(1).padStart(5)}y ${r.selfEmp?'[self-emp]':'          '} ${r.title.slice(-58)}`);

console.log(`\n=== Cumulative CALENDAR-UNION years per DOMAIN (overlap-corrected) ===`);
for (const [d,y] of rank(domIv).slice(0,10)) console.log(`  ${d.padEnd(20)} ${y.toFixed(1)}y`);

console.log(`\n=== TOP 5 HARD skills (calendar-union years, prominence-gated) ===`);
rank(hardIv).slice(0,5).forEach(([k,y],i)=>console.log(`  ${i+1}. ${k.padEnd(26)} ${y.toFixed(1)}y`));
console.log(`\n=== TOP 5 SOFT skills (calendar-union years) ===`);
rank(softIv).slice(0,5).forEach(([k,y],i)=>console.log(`  ${i+1}. ${k.padEnd(26)} ${y.toFixed(1)}y`));

console.log(`\n=== "BEST & HIGHEST USE" (10-skill signature) ===`);
console.log('  HARD:', rank(hardIv).slice(0,5).map(([k])=>k).join(', '));
console.log('  SOFT:', rank(softIv).slice(0,5).map(([k])=>k).join(', '));
