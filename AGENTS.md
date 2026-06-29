# Coding Agent Instructions & Documentation Guidelines

Welcome, Coding Agent! To maintain repository integrity and clear development tracking, you must adhere to the following rules during all project modifications.

---

## Documentation Synchronization Rules

Whenever you introduce a new feature, update the database schema, modify a scraper, or optimize a frontend component, you **MUST** update the following documentation files before completing your task:

### 1. `PROJECT_PROGRESS.md`
- **Location**: [PROJECT_PROGRESS.md](file:///c:/job_search_project/PROJECT_PROGRESS.md)
- **Role**: A living progress log tracking exact changes made to the codebase.
- **Action**: Add a new entry under the relevant phase detailing the scope of changes, new components, and optimization details.

### 2. `README.md`
- **Location**: [README.md](file:///c:/job_search_project/README.md)
- **Role**: The primary developer overview.
- **Action**: Update the system architecture diagram, core component lists, and verification steps to align with the new code state.

---

## Architectural & Coding Constraints

1. **Performance First**:
   - Prioritize memory-efficient, non-blocking JavaScript execution.
   - Offload heavy computing (such as AI embeddings/feature extraction) to Web Workers (`semantic-worker.js`) to prevent main-thread freezing and UI lag.
   - Pre-compile and reuse regular expression objects at the module/file level rather than constructing them inside loops.

2. **Memory Management & Persistence**:
   - Utilize [local-db.js](file:///c:/job_search_project/pb_public/js/storage/local-db.js) and Dexie.js as the primary relational persistence layer.
   - Avoid loading entire database collections into memory. Utilize Dexie's paginated queries (`.offset()` and `.limit()`) and cursor-based iteration.
   - Be mindful of IndexedDB transaction and connection limits. Ensure transactions are properly scoped and closed.

3. **Robust Error Handling**:
   - Wrap IndexedDB and network operations (CORS proxy fetch requests, RSS parsing, API calls) in robust `try-catch` structures. A single malformed RSS feed item, API response, or database fetch error must never halt the scraping/ingestion sweep.
4. **Never modify test_phase_2.py** (Retained for legacy verification safety).
5. **UI & Modal Constraints**:
   - All modals/overlays MUST utilize `overscroll-behavior: contain` to prevent scroll-chaining to the background.
   - Include internal `overflow-y: auto` to ensure content scroll accessibility.
   - Trigger a body scroll lock (e.g. via appending a `.no-scroll` class to `document.body` set to `overflow: hidden !important;`) upon modal activation to prevent background scroll traps.

---

## Phase 11 / PWA Refactor Architecture

### Data Persistence Layer
- **Dexie.js IndexedDB**: Primary relational storage is configured in [local-db.js](file:///c:/job_search_project/pb_public/js/storage/local-db.js) and accessed via [db-adapter.js](file:///c:/job_search_project/pb_public/js/storage/db-adapter.js).
- **Collections Schema**: Persists collections client-side including `job_listings`, `blacklisted_companies`, and `filter_profiles`.

### Ingestion Streams (Client-Side)
- **RSS Feeds**: [rss-adapter.js](file:///c:/job_search_project/pb_public/js/extractors/rss-adapter.js) fetches and parses Indeed RSS feeds directly.
- **Remotive APIs**: [remotive-api.js](file:///c:/job_search_project/pb_public/js/extractors/remotive-api.js) fetches Remote developer/sales categories.
- **Sitemaps**: [sitemap-parser.js](file:///c:/job_search_project/pb_public/js/extractors/sitemap-parser.js) scans XML links with a concurrency limit of 3.
- **CORS Bypass**: All requests route through the Cloudflare CORS proxy setup (`cors-proxy/worker.js`).

### Scoring & Filtering Logic
- **Toxicity & Culture**: Evaluated via [culture-evaluator.js](file:///c:/job_search_project/pb_public/js/scoring/culture-evaluator.js) utilizing red-flag phrases and proximity gates.
- **Skill Matching**: Handled by [skill-matcher.js](file:///c:/job_search_project/pb_public/js/scoring/skill-matcher.js) using set-based keyword intersections.
- **Industry Tagger**: Categorizes jobs using a first-match-wins algorithm in [industry-classifier.js](file:///c:/job_search_project/pb_public/js/scoring/industry-classifier.js).
- **ATS Alignment Scorer**: Reads candidate PDF resumes with `PDF.js` via [resume-parser.js](file:///c:/job_search_project/pb_public/js/ai/resume-parser.js) and computes keyword overlap.
- **Kill Switch Status**: Removes MLM/Predatory, Regulated/Non-Relevant, Trades/Labor, Clinical, and Hard-Personal-Disqualifier (degree mandates, travel, gov't) exclusions.

### Dashboard Stack
- **Fuse.js (CDN)**: Performs client-side fuzzy blacklist matching.
- **marked.js (CDN)**: Handles markdown description rendering in the details modal.
- **Data Portability**: Facilitates backups/restores via [data-portability.js](file:///c:/job_search_project/pb_public/js/storage/data-portability.js) and shows a 30-day reminder banner.