// =====================================================================
// O*NET Minification Pipeline (Phase 14 spike) — build-onet.mjs
// =====================================================================
// Ingests the heavy tab-delimited O*NET .txt files, strips government/survey
// metadata, and emits compact cache-first JSON for the PWA:
//   pb_public/js/data/onet-zones.json   SOC → Job Zone (1–5)
//   pb_public/js/data/onet-titles.json  { socCount, socTitles, exact, tokenIndex }
// Run: node tools/build-onet.mjs
// =====================================================================
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { normalizeTitle, buildFuzzyIndex } from './onet-resolver.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'universal_classifiers');
const OUT = path.join(ROOT, 'pb_public', 'js', 'data');

// Parse a tab-delimited O*NET file → array of row-arrays (header dropped).
function parseTsv(file) {
  const raw = fs.readFileSync(path.join(SRC, file), 'utf8');
  const lines = raw.split(/\r?\n/).filter(l => l.length > 0);
  lines.shift(); // header
  return lines.map(l => l.split('\t'));
}

console.log('Reading O*NET source files…');
const occ = parseTsv('Occupation Data.txt');          // SOC, Title, Description
const reported = parseTsv('Sample of Reported Titles.txt'); // SOC, Reported Title, Shown
const jobTitles = parseTsv('Job Titles.txt');         // SOC, Job Title, Short, Source
const zonesRaw = parseTsv('Job Zones.txt');           // SOC, Job Zone, Date, Domain

// ── Zones ────────────────────────────────────────────────────────────────────
const zones = Object.create(null);
for (const [soc, zone] of zonesRaw) { const z = parseInt(zone, 10); if (soc && z) zones[soc] = z; }

// ── Official titles (for display / debugging) ────────────────────────────────
const socTitles = Object.create(null);
for (const [soc, title] of occ) if (soc && title) socTitles[soc] = title;

// ── Alias pairs (title → SOC), official first so exact map prefers official ──
const aliasPairs = [];
for (const [soc, title] of occ) if (soc && title) aliasPairs.push([title, soc]);
for (const [soc, title] of reported) if (soc && title) aliasPairs.push([title, soc]);
for (const [soc, title] of jobTitles) if (soc && title) aliasPairs.push([title, soc]);

console.log(`  occupations=${occ.length}  reported=${reported.length}  jobTitles=${jobTitles.length}  zones=${Object.keys(zones).length}`);
console.log(`  alias pairs (raw) = ${aliasPairs.length}`);

const { exact, tokenIndex, socCount } = buildFuzzyIndex(aliasPairs);
console.log(`  distinct normalized aliases = ${Object.keys(exact).length}  tokens = ${Object.keys(tokenIndex).length}  socs = ${socCount}`);

// ── Write artifacts ──────────────────────────────────────────────────────────
fs.mkdirSync(OUT, { recursive: true });
const titlesPayload = { socCount, socTitles, exact, tokenIndex };
const files = {
  'onet-zones.json': zones,
  'onet-titles.json': titlesPayload,
};
console.log('\nArtifacts:');
for (const [name, data] of Object.entries(files)) {
  const json = JSON.stringify(data);
  fs.writeFileSync(path.join(OUT, name), json);
  const raw = Buffer.byteLength(json);
  const gz = zlib.gzipSync(json).length;
  console.log(`  ${name.padEnd(20)} raw=${(raw / 1024).toFixed(0)}KB  gzip=${(gz / 1024).toFixed(0)}KB`);
}
console.log('\nDone → pb_public/js/data/');
