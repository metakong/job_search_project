// =====================================================================
// ESCO Skill-Layer Spike — esco-spike.mjs
// =====================================================================
// Measures the make-or-break question: does LITERAL ESCO lexicon matching catch
// enough of a real résumé's / JD's skills, and does JD→candidate coverage cleanly
// separate in-field from off-field? Also reports the minified lexicon payload size.
// Read-only: parses ecso_data + the real résumé; writes NOTHING to the app tree.
// Run: node tools/esco-spike.mjs
// =====================================================================
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { buildSurfaceMap, extractSkills, tokenize } from './esco-extractor.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ESCO = path.join(ROOT, 'ecso_data', 'ESCO dataset - v1.2.1 - classification - en - csv');

function parseCSV(text) {
  const rows = []; let f = '', row = [], q = false;
  for (let i = 0; i < text.length; i++) { const c = text[i];
    if (q) { if (c === '"') { if (text[i+1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else { if (c === '"') q = true; else if (c === ',') { row.push(f); f=''; }
      else if (c === '\r') {} else if (c === '\n') { row.push(f); rows.push(row); row=[]; f=''; } else f += c; } }
  if (f.length || row.length) { row.push(f); rows.push(row); }
  return rows;
}

// ── Load ESCO skills ──────────────────────────────────────────────────────────
const rows = parseCSV(fs.readFileSync(path.join(ESCO, 'skills_en.csv'), 'utf8'));
const H = rows[0];
const ci = n => H.indexOf(n);
const [cLabel, cAlt, cType, cReuse] = [ci('preferredLabel'), ci('altLabels'), ci('skillType'), ci('reuseLevel')];
const skills = rows.slice(1).filter(r => r[cLabel]).map(r => ({
  label: r[cLabel],
  alts: (r[cAlt] || '').split('\n').map(s => s.trim()).filter(Boolean),
  type: r[cType] || '',
  reuse: r[cReuse] || '',
}));
console.log(`Loaded ${skills.length} ESCO skills.`);

const surface = buildSurfaceMap(skills);
console.log(`Surface-form map: ${surface.forms.size} forms (${surface.multiword.size} multi-word).`);

// ── Projected minified artifact size ─────────────────────────────────────────
const TYPE_CODE = { 'skill/competence': 'c', 'knowledge': 'k' };
const REUSE_CODE = { transversal: 't', 'cross-sector': 'x', 'sector-specific': 's', 'occupation-specific': 'o' };
const minified = skills.map(s => [s.label, TYPE_CODE[s.type] || '', REUSE_CODE[s.reuse] || '', s.alts.join('\n')]);
const json = JSON.stringify(minified);
console.log(`Projected esco-skills.json: raw=${(Buffer.byteLength(json)/1024/1024).toFixed(2)}MB  gzip=${(zlib.gzipSync(json).length/1024).toFixed(0)}KB`);

// ── Résumé recall (REAL text) ────────────────────────────────────────────────
const resumeText = fs.readFileSync(path.join(ROOT, 'Sean_Deardorff_06232026_1939.md'), 'utf8');
const resumeFound = extractSkills(resumeText, surface);
const byVia = { multi: 0, single: 0 };
const byReuse = {};
for (const [idx, m] of resumeFound) { byVia[m.via]++; const rl = skills[idx].reuse || '—'; byReuse[rl] = (byReuse[rl]||0)+1; }
console.log(`\n=== RÉSUMÉ recall (real text) ===`);
console.log(`matched ESCO skills: ${resumeFound.size}   (multi-word forms: ${byVia.multi}, single-token: ${byVia.single})`);
console.log(`by reuseLevel:`, Object.entries(byReuse).map(([k,v])=>`${k}=${v}`).join('  '));
const resumeLabels = [...resumeFound.entries()].map(([idx,m]) => `${skills[idx].label}${m.via==='single'?'*':''}`);
console.log(`sample matched skills (first 40; * = single-token match):`);
console.log('  ' + resumeLabels.slice(0, 40).join(' · '));

// ── JD coverage separation (in-field vs off-field) ───────────────────────────
const salesRepJD = `Entry-level Sales Representative. Own the full sales pipeline and sales cycle: prospecting, cold outreach,
consultative selling, discovery calls, product demonstrations, negotiation and closing deals to hit quota. Manage your book of
business in Salesforce CRM, forecast revenue, and drive business development and account management across B2B and B2C accounts.`;
const revOpsJD = `Revenue Operations Manager. Lead revenue operations and sales operations: own the CRM (Salesforce, HubSpot),
sales forecasting, quota and territory design, go-to-market process, pipeline management, and business development analytics.
Partner with sales leadership on account management, reporting, and process improvement.`;
const vpSalesJD = `VP of Sales. Own the company go-to-market and revenue strategy. Build and scale the sales organisation, sales
pipeline, quota model and territory plan. Salesforce CRM, business development, consultative sales, forecasting, contract
negotiation, team leadership and staff management.`;
const labTechJD = `Junior Laboratory Technician. Perform phlebotomy and specimen collection, run clinical diagnostic assays,
maintain the electronic health record, follow infection-control protocols, calibrate laboratory instruments, and support
registered nurses and physicians with patient care in a hospital laboratory.`;
const cppJD = `Senior C++ Software Engineer. Design and build backend microservices in C++ and Python. Implement REST APIs,
apply data structures and algorithms, write unit tests, conduct code review, use Docker, Kubernetes and CI/CD pipelines, and
deploy to AWS in an agile software development team.`;

const JDS = [
  ['sales_rep (in-field)', salesRepJD],
  ['revops (in-field)', revOpsJD],
  ['vp_sales (in-field)', vpSalesJD],
  ['lab_tech (OFF-field)', labTechJD],
  ['cpp_eng (OFF-field)', cppJD],
];
const resumeSet = new Set(resumeFound.keys());
console.log(`\n=== JD → candidate COVERAGE (JD-as-requirements, no title mapping) ===`);
for (const [name, jd] of JDS) {
  const jf = extractSkills(jd, surface);
  const jdIdx = [...jf.keys()];
  const covered = jdIdx.filter(i => resumeSet.has(i));
  const cov = jdIdx.length ? covered.length / jdIdx.length : 0;
  console.log(`\n• ${name}`);
  console.log(`   JD skills extracted: ${jdIdx.length}   covered by résumé: ${covered.length}   COVERAGE: ${(cov*100).toFixed(0)}%`);
  console.log(`   JD skills: ${jdIdx.slice(0,14).map(i=>skills[i].label).join(' · ')}${jdIdx.length>14?' …':''}`);
  if (covered.length) console.log(`   covered:   ${covered.slice(0,14).map(i=>skills[i].label).join(' · ')}`);
}
