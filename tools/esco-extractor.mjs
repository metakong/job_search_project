// =====================================================================
// ESCO Skill Extractor (Phase 14 spike) — esco-extractor.mjs
// =====================================================================
// Pure, dependency-free, browser-portable. Given the ESCO skill lexicon
// (preferred + alt labels), it (1) builds an n-gram surface-form → skill map,
// and (2) extracts the set of ESCO skills literally present in a text (résumé
// or JD). This is the LITERAL-match baseline whose recall the spike measures —
// the make-or-break number that decides whether embeddings are needed.
// =====================================================================

const MAXN = 6; // longest ESCO phrase we bother sliding for

// Single-token surface forms this common are too noisy to index on their own.
const STOP = new Set([
  'the','and','for','with','that','this','from','have','are','you','your','our','will',
  'work','team','role','job','skill','skills','ability','able','strong','excellent',
  'management','manage','service','services','system','systems','data','process','support',
  'business','customer','client','product','project','develop','development','design',
  'plan','planning','control','use','using','new','staff','other','general','apply',
  'perform','provide','ensure','identify','maintain','operate','operation','operations',
]);

export function tokenize(text) {
  return (String(text || '').toLowerCase().match(/[a-z0-9+#.]+/g)) || [];
}

// Build surface-form → [skillIdx] map. `skills[i] = { label, alts:[], type, reuse }`.
// Returns { forms: Map, multiword: Set(form) }.
export function buildSurfaceMap(skills) {
  const forms = new Map();
  const multiword = new Set();
  const add = (form, idx, isMulti) => {
    let arr = forms.get(form);
    if (!arr) { arr = []; forms.set(form, arr); }
    if (!arr.includes(idx)) arr.push(idx);
    if (isMulti) multiword.add(form);
  };
  skills.forEach((s, idx) => {
    const labels = [s.label, ...(s.alts || [])];
    for (const lab of labels) {
      const toks = tokenize(lab);
      if (!toks.length) continue;
      const form = toks.join(' ');
      if (toks.length === 1) {
        if (toks[0].length < 4 || STOP.has(toks[0])) continue; // drop noisy single tokens
        add(form, idx, false);
      } else {
        add(form, idx, true);
      }
    }
  });
  return { forms, multiword };
}

// Extract ESCO skills present in `text`. Returns Map(skillIdx → { via:'multi'|'single', form }).
// Longer phrase matches win at a position (more specific), but every distinct skill
// found anywhere is recorded (deduped by skill index).
export function extractSkills(text, surface) {
  const toks = tokenize(text);
  const found = new Map();
  for (let i = 0; i < toks.length; i++) {
    for (let n = Math.min(MAXN, toks.length - i); n >= 1; n--) {
      const form = toks.slice(i, i + n).join(' ');
      const hit = surface.forms.get(form);
      if (hit) {
        const isMulti = surface.multiword.has(form);
        for (const idx of hit) if (!found.has(idx)) found.set(idx, { via: isMulti ? 'multi' : 'single', form });
        break; // longest match at this position wins
      }
    }
  }
  return found;
}
