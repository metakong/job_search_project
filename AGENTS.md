# Coding Agent Instructions & Documentation Guidelines

Welcome, Coding Agent! This is a **100% browser-native static PWA** (no backend, no Python, no build step). All logic runs client-side; all data lives in IndexedDB (Dexie). The directory `pb_public/` is the static web root (the `pb_` prefix is legacy from a removed PocketBase era — it is just a folder).

---

## Documentation Synchronization Rules

When you add a feature, change the scoring model or schema, modify an extractor, or alter the UI, you **MUST** update:

1. **`PROJECT_PROGRESS.md`** — append an entry describing the change.
2. **`README.md`** — keep the architecture diagram, feature list, and zone/scoring description aligned with reality. **Do not advertise features that aren't wired in.**

---

## Architectural & Coding Constraints

1. **Module pattern.** Each `js/**` file wraps its logic in an IIFE and exposes a single object on `window` (e.g. `window.scoringCoordinator`). Do not leak helper functions to the global scope.

2. **Performance.** Pre-compile regexes at module scope (not in loops). Offload heavy work (AI embeddings) to the Web Worker (`semantic-worker.js`). The dashboard keeps one in-memory snapshot of listings (`allJobsCache`) and filters/sorts/paginates against it — read IndexedDB once per data change, not per keystroke.

3. **Robust error handling.** Wrap every network/IndexedDB/parse operation in `try/catch`. A single malformed feed item or failed request must never halt an ingestion sweep or crash the dashboard.

4. **Security (mandatory).**
   - Untrusted text (job descriptions, titles, company names) is rendered through `escapeHtml()` or, for markdown, `renderMarkdownSafe()` (marked → **DOMPurify**). Never `innerHTML` raw third-party content.
   - Apply/job URLs from feeds must pass through `safeUrl()` (http/https only) before use.
   - CSV export uses `csvCell()` (formula-injection guard).
   - Never commit secrets; there is no `.env` and no server credential in this project.

5. **UI & Modal constraints.** Modals use `overscroll-behavior: contain`, internal `overflow-y: auto`, and a `.no-scroll` body lock while open.

---

## The Scoring Engine (the heart)

Every job is placed on two candidate-relative axes and routed to a zone. **Keep these faithful**:

- **Delta-X (fit, 0–1):** résumé-driven overlap (`skill-matcher.overlapRatio`) + supplementary skills + optional semantic similarity.
- **Delta-Y (trajectory):** job seniority − candidate baseline seniority.
- **Zones:** Strike (aligned/lateral), Moonshot (reach up), Safety (step down in-field), Inferno (toxicity override), `noise` (below relevance floor; hidden). The **Strategy Dial** (1 Survival / 2 Balanced / 3 Aggressive) reshapes thresholds.
- **Core Score (0–100):** transparent blend — 55% fit, 25% pay-vs-floor, 20% culture. No hidden constants.

Modules:
- `scoring/evaluator.js` — **toxicity engine**: additive, weighted red-flag taxonomy mapped to the 9 Circles. Calibrated so Inferno is a *minority*; a single weak cliché never triggers it.
- `scoring/culture-evaluator.js` — **culture vector (0–1)**: rewards green flags (pay transparency first), penalizes yellow flags. Feeds the Core Score.
- `scoring/skill-matcher.js` — résumé keyword extraction + overlap (the primary fit signal) + supplementary skill list.
- `scoring/industry-classifier.js` — first-match-wins industry tag.
- `scoring/scoring-coordinator.js` — orchestrates all of the above; assigns zone, ghost/stale/duplicate flags, and percentiles.

**Calibration discipline:** when changing toxicity weights or zone thresholds, validate the distribution (Inferno should stay a minority; no zone should swallow everything). A Node harness can load these modules with a stub `window` and run synthetic + realistic samples.

---

## Other Components
- **Storage:** `storage/local-db.js` (Dexie schema + migrations), `storage/db-adapter.js` (CRUD, filtering, `getBlacklistNames`, `persistJobs`), `storage/data-portability.js` (JSON backup/restore).
- **Extractors:** `extractors/rss-adapter.js`, `remotive-api.js`, `sitemap-parser.js`; Greenhouse/Lever ATS watchlists are polled in `app.js`. All cross-origin requests go through the CORS proxy (`cors-proxy/worker.js`, or the public default).
- **Résumé:** `ai/resume-parser.js` (PDF.js, local) calibrates baseline seniority + salary floor.
- **Optional AI:** `ai/transformers-engine.js` + `workers/semantic-worker.js` (opt-in semantic matching; must degrade gracefully to keyword matching).
- **Dashboard:** `index.html`, `app.js`, `style.css`; Fuse.js (fuzzy blacklist), marked + DOMPurify (safe markdown), service worker `sw.js` (offline).
