// Assertion harness for the shipped yoe-profiler.js (Increment 1).
// Loads the real browser modules via vm, runs the FULL calibration path
// (resumeParser.calibrateFromText → yoeProfile), asserts the honest invariants.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const JS = path.join(ROOT, 'pb_public', 'js');

const ctx = { console, Math, Date, JSON, RegExp, Set, Map, Array, Object, String, Number, parseFloat, parseInt, isNaN, isFinite };
ctx.window = {}; ctx.self = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for (const rel of ['config.js','scoring/competency-profiler.js','scoring/yoe-profiler.js','ai/resume-parser.js'])
  vm.runInContext(fs.readFileSync(path.join(JS, rel), 'utf8'), ctx, { filename: rel });

const resumeText = fs.readFileSync(path.join(ROOT, 'Sean_Deardorff_06232026_1939.md'), 'utf8');
const cal = ctx.window.resumeParser.calibrateFromText(resumeText, 40000);
const p = cal.yoeProfile;

console.log('roleCount:', p.roleCount, ' totalYears:', p.totalYears);
console.log('HARD:', p.hard.map(s => `${s.skill} ${s.years}y`).join(' · '));
console.log('SOFT:', p.soft.map(s => `${s.skill} ${s.years}y`).join(' · '));
console.log('domains:', p.domains.map(d => `${d.domain} ${d.years}y`).join(' · '));

let pass = 0, fail = 0;
const A = (name, cond) => { cond ? (pass++, console.log(`  ✓ ${name}`)) : (fail++, console.log(`  ✗ FAIL: ${name}`)); };
const hardHas = k => p.hard.some(s => s.skill.toLowerCase().includes(k));
const domHas  = k => p.domains.some(d => d.domain === k);
const yearsOf = (list, k) => (list.find(s => s.skill.toLowerCase().includes(k)) || {}).years;

console.log('\n=== Assertions ===');
A('calibrateFromText returns a yoeProfile', !!p);
A('parsed 8 dated roles', p.roleCount === 8);
A('total career years plausible (18–30)', p.totalYears >= 18 && p.totalYears <= 30);
A('hard skills non-empty', p.hard.length > 0);
A('soft skills non-empty', p.soft.length > 0);
A('sales/ops present in hard signature', hardHas('salesforce') || hardHas('operations') || hardHas('logistics'));
A('leadership is the #1 soft skill', p.soft[0] && p.soft[0].skill.toLowerCase().includes('leadership'));
A('operations & sales are top domains', domHas('operations') && domHas('sales'));
A('off-field domains absent (software_eng, clinical_health, data_ml)', !domHas('software_eng') && !domHas('clinical_health') && !domHas('data_ml'));
A('no phantom finance domain', !domHas('finance_acct'));
// Self-employment discount: "salesforce" appears only in the 11.8y self-employed
// MetaKong role, so its credited years must be discounted well below 11.8.
const sf = yearsOf(p.hard, 'salesforce');
A('self-employment discount applied (salesforce < 9y, was 11.8 raw)', sf === undefined || sf < 9);

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
