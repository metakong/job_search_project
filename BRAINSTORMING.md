# 🧠 BRAINSTORMING — Ideas, Explorations & Potential Next Steps

**Purpose:** a living scratchpad for ideas, new features, data sources, and architectural
explorations that **may or may not** get implemented. Nothing here is a commitment. When an
idea graduates into real work, it moves to `PROJECT_PROGRESS.md` (shipped) and the code; if
it's rejected, it stays here with a note on *why* so we don't re-litigate it later.

**How to use:** append dated entries (newest at top). Keep verdicts honest. Cross-reference
`AGENTS.md` (the constitution — zero-backend North Star, honest math) so ideas are judged
against the real constraints, not a wish-list architecture.

---

## 2026-07-01 15:08 CDT — ESCO skill-layer spike RESULT: literal matching fails; ESCO needs a semantic bridge

**Ran the measure-before-building spike** (`tools/esco-extractor.mjs` + `esco-spike.mjs`, no app changes). Loaded all 13,960 ESCO skills → 99,233 surface forms (incl. alt-labels). Projected `esco-skills.json` = 3.26MB raw / **702KB gz**.

**Result — literal extraction fails badly:**
| Text | ESCO skills extracted |
|---|---|
| Real résumé (28-yr sales/ops/AI exec) | **8** (6 single-token *noise*: history, psychology, logic…) |
| sales_rep JD (in-field) | **0** |
| vp_sales JD (in-field) | **0** |
| revops JD (in-field) | 2 |
| lab_tech JD (off-field) | 2 |
| cpp_eng JD (off-field) | 3 |

**Coverage did NOT separate in-field from off-field** — in-field JDs extract ~0 skills, so the coverage metric collapses (0% ≈ off-field's 0%).

**Root cause (not a bug):** 96% of ESCO skills are multi-word competence *phrases* ("manage sales pipeline", "identify customers' needs") that never appear verbatim in natural résumé/JD prose ("owned the pipeline", "closed $2M in new logos"). Multi-word literal → near-zero recall; single-token → noise. The extractor works (it correctly caught verbatim phrases like "infection control", "agile development", "C++").

**Strategic takeaways (important):**
1. **Do NOT adopt ESCO via literal matching.** It is measurably *worse* than the status quo.
2. **The existing curated `competency-profiler` (13.7) already beats ESCO-literal** — it gives clean bimodal separation (in-field Δx≈0.37 vs off-field≈0.00). ESCO's granularity only pays off *with a semantic bridge* (embed ~14K ESCO phrases + résumé/JD sentences, cosine-match), and that bridge **must be measured to beat the curated profiler** before adoption — don't assume.
3. This is the **data-backed justification** for the semantic/LLM extraction layer (entry below): messy prose → structured skills is a *meaning*-matching problem, not a keyword one.

**Next candidate step (if ESCO is pursued):** feasibility-measure embedding the 14K ESCO phrases in-browser via the already-shipped transformers.js `all-MiniLM` local embedder (keyless, private) — cost, payload (~5–21MB of vectors), and whether semantic coverage separates in-field from off-field better than the curated profiler. Until that's proven, **the current competency-profiler stays the fit engine.**

---

## 2026-07-01 15:06 CDT — "Connect your LLM" via SSO/OAuth for live abstraction-refinement (evaluated, mostly redirected)

**Idea (owner):** non-technical users are comfortable with "click a pretty button to log in" (SSO/OAuth). Could we let them connect their chosen **free consumer LLM account** (Gemini / Claude / ChatGPT) so the app uses it to refine the messy skill/matching abstractions live while they search?

**Honest verdict — the specific mechanism doesn't exist:**
- **SSO/OAuth grants *identity*, not *inference*.** "Sign in with Google" says who you are; there is no OAuth scope like "run Gemini on my behalf" a consumer can grant by clicking.
- **Consumer subscription ≠ API.** ChatGPT Plus / Gemini Advanced / Claude.ai are chat apps; the *APIs* (platform.openai.com, Google AI Studio, console.anthropic.com) are billed separately and authenticated by an **API key**, not the chatbot login. None of the three expose "borrow my consumer sub for API calls." So "connect my free ChatGPT and let the app use it" is not a sanctioned path today.

**What actually works (two real paths):**
| Path | User experience | Reality |
|---|---|---|
| **BYOK — free API key** | Visit Google **AI Studio** → "Create API key" → paste | Most non-technical-friendly real option; Gemini free tier is generous + browser-callable. This is the app's old Phase-2 BYOK idea with a guided flow. |
| **OpenRouter OAuth (PKCE)** | Real "Connect" button → approve on OpenRouter → app gets a user-scoped key | **Closest thing to the vision that genuinely exists**: PKCE works from a static site (no server/secret), aggregates many providers incl. *free* models. Caveat: third-party aggregator, data routes through it; verify exact flow at build time. |

**The more important architectural point — *where* an LLM may live:**
- **NEVER in the scoring loop.** The project's identity is honest, deterministic, harness-verifiable math; an LLM is non-deterministic and hallucinates. Dropping it into `distributeAndRank` breaks the "honest math" contract.
- **DO put it at the *extraction seam*** — messy text → structured skills/YoE (résumé) and sparse JD → clean requirements. That's exactly the "messy abstractions" pain, it's what LLMs are best at, and it feeds the deterministic engine unchanged. It's also the natural mitigation for the ESCO phrase-recall risk.
- **"Real-time per job" is a quota/cost/latency trap** (a sweep = dozens–hundreds of jobs). Realistic real-time uses: (1) one-time résumé structuring at onboarding; (2) on-demand single-job "explain/refine this match" on click. Not a blanket per-listing call.
- **Opt-in + graceful fallback + privacy disclosure** (same pattern as embeddings + CORS proxy). Résumé/job text leaving the browser is a real change from "your data never leaves" — must be a conscious choice.

**Do we even need it?** The app already ships a browser-native local model (transformers.js `all-MiniLM` embeddings — no key, no cost, private). Local embeddings may solve enough of the ESCO recall problem *first*; an external LLM then becomes an opt-in "turbo," not a dependency.

**Disposition:** Phase-2, opt-in, at the extraction seam only. **Do not build auth yet** — the ESCO spike (below) decides whether we even need an external LLM for recall. If yes: guided BYOK (free Gemini) as the simple path, OpenRouter OAuth as the "pretty button." Never required; app must stay fully functional offline with no key.

---

## 2026-07-01 14:30 CDT — External data-source evaluation (ESCO / Lightcast / Wikidata / NLP models)

**Context:** A Google Search "AI Mode" pass suggested external data sources to move the engine
beyond flat keyword matching. Evaluated read-only against this app's hard constraints. This
follows the same session's two shipped/spiked items:
- **Shipped — Phase 13.8 Safety-Net fit gate** (fixed "unqualified roles in my Safety Net"; the
  Safety Net was the unconditional `else`-bucket with no fit gate). See `PROJECT_PROGRESS.md`.
- **Spiked — Phase 14.0 O*NET title→SOC** (measured ~60% accuracy, confident alias-quirk errors →
  *don't* anchor Delta-Y/qualification on free-text title resolution). See `PROJECT_PROGRESS.md`
  + `tools/`.

### The lens that decides everything
This is a **100% browser-native static PWA** — no backend, no build step for the end user, data
in IndexedDB, aimed at **non-technical** users (North Star: zero backend bloat, honest math).
**Any source that needs a server, a runtime API call, or a Python process is disqualified for
Phase 1**, no matter how good the data is. Also note: **sentence-transformers is already shipped**
here (`transformers-engine.js` + `semantic-worker.js` run `Xenova/all-MiniLM-L6-v2` q4 in a Web
Worker, embeddings cached in a Dexie table) — so that suggestion is "use what we have," not "add."

### Verdict table
| Source | Fits zero-backend PWA? | Solves a *real* gap? | Verdict |
|---|---|---|---|
| **ESCO occupation→skill relations** | ✅ build-time minify (like O*NET) | ✅✅ the missing "what does this role *require*" list | **Adopt — highest ROI** |
| **ESCO / Lightcast skill *dictionary*** | ✅ build-time asset | ✅ standardized extraction vocabulary | **Adopt (as lexicon, not API)** |
| **all-MiniLM embeddings** | ✅ already shipped | ✅ synonym/meaning matching | **Already have — use it more** |
| Lightcast Open Skills **API** | ❌ runtime network/key | data yes, API no | Use the *download*, not the API |
| O*NET-SOC Auto-Coder doc | ✅ reference only | ⚠️ marginal post-spike | Skim for weighting ideas; low priority |
| Wikidata / DBpedia **SPARQL** | ❌ runtime query (slow, CORS, flaky) | ⚠️ noisy | Reject at runtime; maybe 1-off offline extract |
| **spaCy / JobSpaCy** | ❌ **Python — needs a server** | — | **Reject (architectural mismatch)** |
| Milvus / Qdrant / SQLite-vec | ❌ servers / native ext | — | **Reject — a Dexie table + in-JS cosine IS the vector DB** |

### The one that changes the game: ESCO's *skill layer*
Last turn's spike proved title→occupation matching is too weak (~60%). ESCO doesn't fix that —
it makes it **unnecessary**. ESCO ships three things O*NET only approximated via Task Statements:
1. **~13,800 skills with preferred + rich *alternative* labels** → a curated extraction lexicon
   that replaces frequency-based `extractKeywords` (which grabs JD filler) with far higher precision.
2. **Occupation → *essential* vs *optional* skills relations** → the literal "requirements list"
   needed for **job→candidate coverage** (the true Safety-Net definition: "I have ~all it needs").
3. **Skill "reusability level"** (transversal / cross-sector / sector-specific / occupation-specific)
   → a ready-made **hard-vs-soft / discriminative-vs-generic weighting** — the exact distinction the
   `competency-profiler` hand-curates today.

**The architectural unlock:** do **not** map the scraped *title* to an ESCO occupation (same
fragility as SOC). Run the ESCO **skill lexicon** over the JD → the job's required-skill set; run
it over the résumé → the candidate's skill set. **Coverage = intersection ÷ job-requirements**, with
no title resolution in the loop. This is the honest job→candidate metric that should cure both the
reported Safety-Net leak *and* the Strike-Zone starvation (in-field fits capping at ~0.39 under the
0.40 bar — see open item below).

**Caveats to bank:**
- ESCO is EU-centric on *occupation labels*, but **skills are largely universal**; using the skill
  layer (not occupation matching) sidesteps the geography problem.
- ESCO gives **nothing on US salary or Job Zones** — keep the salary sanitizer + dual-baseline anchor.
- ESCO essential/optional skills can be generic — weight essential > optional and filter to
  discriminative skills (same discipline as `competency-profiler`).
- ESCO occupations carry **ISCO-08 codes**; O*NET↔ISCO crosswalks exist if we ever want to bridge to
  US Job Zones. Nice-to-have, not now.

### Translating Google's "Graph + Vector DB + spaCy" into *this* app
Their design is a sound *server* architecture and a wrong *PWA* architecture. Browser-native equiv:
- **Graph foundation** → ESCO occupation↔skill relations, minified to JSON at build time (the
  `tools/build-onet.mjs` pattern already proves this works). ✅
- **Vector layer** → **do not** add Milvus/Qdrant/SQLite-vec. At our scale (dozens–hundreds of jobs
  per sweep) a Dexie `embeddings` table + brute-force cosine in JS **is** the vector DB, and it
  already exists. A vector server is exactly the bloat `AGENTS.md` forbids. ✅
- **Parser** → not spaCy (Python = server). Skill-dictionary matching in JS + the existing opt-in
  embeddings for fuzzy cases. ✅

### New ways to analyze — UX ideas these unlock
Once standardized skills + coverage + YoE exist, the UX gets far more honest and actionable:
- **Coverage-based zone routing (makes zones literal):** Safety = coverage ≥ ~90%; Strike = ~70–90%
  & lateral; Moonshot = ~33–70% & reach-up. This is the original brief ("Moonshot ≈ 33% of required
  skills") as a real computation.
- **Skill-gap card:** for any Moonshot, show *exactly which ESCO skills you're missing* ("6 of 9;
  the reach is Terraform, Kubernetes, GraphQL"). Turns a vague "reach" into a study list.
- **"Highest & Best Use" reverse lookup:** rank the candidate's skills by cumulative YoE, then query
  ESCO occupation↔skill relations *backwards* — "which occupations most need *your* top-10 skills?"
  This literally generates Strike-Zone target titles from the résumé (the day-one ask).
- **Semantic skill de-duplication:** use embeddings to collapse "CoT rubric authoring" / "LLM
  evaluation" / "model-output grading" into one skill so YoE isn't multiply-counted.
- **YoE-weighted coverage:** having a skill isn't enough for Safety — you should *exceed* the tenure
  it implies. Attribute each résumé role's date-window to skills detected in it → cumulative YoE per
  skill → Safety requires coverage *and* YoE margin.

### Recommendation & agreed next step
Pursue exactly one thing next — **build job→candidate qualification-coverage on ESCO's skill layer**
(this is last turn's "option (a)," now with a concrete, feasible data source). Sequence:
1. **Spike ESCO like we spiked O*NET** — download skill + occupation-skill-relation files, minify,
   and measure: how many skills does the lexicon detect in the real résumé and in real JDs? Does
   coverage cleanly separate in-field (high) from off-field (low)? Measure before building.
2. If it separates cleanly → wire coverage in as the job→candidate axis and re-route zones on it.

**Status:** ⏳ Waiting on the project owner to grab the **ESCO download(s)** from
<https://esco.ec.europa.eu/en/use-esco/download> (classification CSV bundle — occupations, skills,
and `occupationSkillRelations`). Owner will handle the download after errands; the spike proceeds
once the files are local. (I can't fetch it from here without an authorized network call.)

**Drop entirely:** spaCy/JobSpaCy, Milvus/Qdrant/SQLite-vec, Wikidata/DBpedia at runtime, the
Lightcast *API*. Keep Lightcast only as an optional US-synonym *enrichment* of the ESCO lexicon if
the ESCO spike shows gaps.

---

## 🗒️ Open backlog (unscheduled ideas & follow-ups)

- **Strike-Zone starvation (from the 13.8 calibration finding):** on the real résumé, even strong
  in-field matches cap at Delta-X ≈ 0.37–0.39, just under `STRIKE_FIT_MIN` 0.40, so Strike is
  chronically empty and near-laterals spill into Moonshot. Root cause is the symmetric candidate→job
  overlap metric. The ESCO coverage metric is the principled fix (job→candidate). Until then, this is
  a known artifact, not a bug. See `PROJECT_PROGRESS.md` Phase 13.8 + `scoring-zone-design-intent`.
- **Résumé YoE parser:** ✅ SHIPPED as Increment 1 (`yoe-profiler.js`, Phase 14.3) — the "Highest &
  Best Use" panel (top hard/soft by cumulative years, overlap + self-employment discounted). Display-only
  for now. **Increment 2 (open):** feed YoE into qualification-weighted zoning (Safety = candidate
  exceeds the years the role implies) + fix Strike-Zone starvation.
- **O*NET `onet-zones.json`:** retained (2KB gz) as an optional *supplementary* Delta-Y sanity signal
  only — never a primary anchor (per the 14.0 spike).
- **Subresource Integrity (SRI) hashes** on CDN `<script>`s — deferred since Phase 13.5 (a wrong hash
  bricks load; compute carefully). Security hardening, low urgency.
