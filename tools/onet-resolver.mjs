// =====================================================================
// O*NET Title → SOC Resolver (Phase 14 spike)
// =====================================================================
// Pure, dependency-free. Normalizes a messy scraped job title and resolves it
// to an O*NET-SOC occupation via (1) exact normalized-alias lookup, then
// (2) an IDF-weighted token vote over an inverted title index. Designed to be
// portable to the browser (no Node APIs here — the pipeline injects the index).
// =====================================================================

// Level / employment-type / formatting noise to drop from titles before matching.
// (O*NET occupation titles are largely seniority-agnostic, so level words hurt.)
const NOISE = new Set([
  'sr', 'senior', 'jr', 'junior', 'lead', 'principal', 'staff', 'entry', 'entrylevel',
  'experienced', 'level', 'levels', 'mid', 'midlevel', 'remote', 'hybrid', 'onsite',
  'contract', 'contractor', 'temporary', 'temp', 'fulltime', 'parttime', 'permanent',
  'w2', '1099', 'the', 'of', 'and', 'for', 'a', 'an', 'to', 'in', 'at', 'with',
  'i', 'ii', 'iii', 'iv', 'v',
]);

// Common résumé/job-board abbreviations → canonical O*NET-ish tokens.
const ABBREV = {
  exec: 'executive', execs: 'executive', mgr: 'manager', mgmt: 'management',
  dev: 'developer', eng: 'engineer', ops: 'operations', rep: 'representative',
  reps: 'representative', acct: 'account', admin: 'administrative', biz: 'business',
  bdr: 'business development representative', sdr: 'sales development representative',
  ae: 'account executive', csm: 'customer success manager', pm: 'product manager',
  qa: 'quality', hr: 'human resources', vp: 'vice president', svp: 'vice president',
  gm: 'general manager', cs: 'customer success', rn: 'registered nurse',
};

function stripDiacritics(s) { return s.normalize('NFKD').replace(/[̀-ͯ]/g, ''); }

// Normalize a raw title → { norm (string), tokens (array) }.
export function normalizeTitle(raw) {
  let s = stripDiacritics(String(raw || '').toLowerCase());
  s = s.replace(/&/g, ' and ').replace(/\//g, ' ');
  // Drop everything after the first qualifier delimiter: " - SaaS", ", Clerk",
  // " | B2B", "(Remote)". These are almost always employer qualifiers, not the role.
  s = s.split(/\s[-–—]\s|[|,(:]/)[0];
  s = s.replace(/[^a-z0-9\s]/g, ' ');                 // punctuation → space
  let tokens = s.split(/\s+/).filter(Boolean)
    .map(t => ABBREV[t] || t)                          // expand abbreviations
    .join(' ').split(/\s+/)                            // (multi-word expansions)
    .filter(t => t && !NOISE.has(t) && !/^\d+$/.test(t) && t.length >= 2);
  return { norm: tokens.join(' '), tokens };
}

// Build the fuzzy structures the resolver needs from a { title → SOC } alias list.
// Returns { exact, tokenIndex, idf, socCount }. `tokenIndex[token]` = array of
// distinct SOCs whose titles contain that token. `idf[token]` = log(N / df).
export function buildFuzzyIndex(aliasPairs) {
  const exact = Object.create(null);
  const tokenToSocs = new Map();  // token → Set(SOC)
  for (const [title, soc] of aliasPairs) {
    const { norm, tokens } = normalizeTitle(title);
    if (norm && !(norm in exact)) exact[norm] = soc;   // first writer wins (official titles loaded first)
    for (const tk of new Set(tokens)) {
      let set = tokenToSocs.get(tk);
      if (!set) { set = new Set(); tokenToSocs.set(tk, set); }
      set.add(soc);
    }
  }
  const allSocs = new Set();
  for (const set of tokenToSocs.values()) for (const s of set) allSocs.add(s);
  const N = allSocs.size || 1;
  const tokenIndex = Object.create(null);
  const idf = Object.create(null);
  for (const [tk, set] of tokenToSocs) {
    tokenIndex[tk] = Array.from(set);
    idf[tk] = Math.log(N / set.size);                  // rare token → high weight
  }
  return { exact, tokenIndex, idf, socCount: N };
}

// Rehydrate a shipped index (onet-titles.json) into a resolver-ready index.
// idf is derived from tokenIndex + socCount so it never has to be shipped.
export function hydrateIndex(raw) {
  const N = raw.socCount || 1;
  const idf = Object.create(null);
  for (const tk in raw.tokenIndex) idf[tk] = Math.log(N / raw.tokenIndex[tk].length);
  return { exact: raw.exact, tokenIndex: raw.tokenIndex, idf, socTitles: raw.socTitles };
}

// Resolve a raw title. `index` = { exact, tokenIndex, idf }.
// Returns { soc, matchType: 'exact'|'fuzzy'|'none', confidence (0–1), runnerUp }.
export function resolveTitle(raw, index) {
  const { norm, tokens } = normalizeTitle(raw);
  if (!norm) return { soc: null, matchType: 'none', confidence: 0 };
  if (index.exact[norm]) return { soc: index.exact[norm], matchType: 'exact', confidence: 1 };

  // IDF-weighted token vote.
  const scores = new Map();  // SOC → summed idf weight
  let totalWeight = 0;
  for (const tk of new Set(tokens)) {
    const socs = index.tokenIndex[tk];
    if (!socs) continue;
    const w = index.idf[tk] ?? 0;
    totalWeight += w;
    for (const soc of socs) scores.set(soc, (scores.get(soc) || 0) + w);
  }
  if (scores.size === 0 || totalWeight === 0) return { soc: null, matchType: 'none', confidence: 0 };

  let best = null, bestScore = 0, second = 0;
  for (const [soc, sc] of scores) {
    if (sc > bestScore) { second = bestScore; best = soc; bestScore = sc; }
    else if (sc > second) { second = sc; }
  }
  const confidence = bestScore / totalWeight;      // share of query weight captured
  const runnerUp = bestScore > 0 ? second / bestScore : 0;  // 1.0 = tie (ambiguous)
  return { soc: best, matchType: 'fuzzy', confidence, runnerUp };
}
