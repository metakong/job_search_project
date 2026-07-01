# Project Progress and Implementation Log

This file tracks all changes, architectural decisions, and feature implementations for the job search project.

---

## Log of Implementations

### Phase 1: Localized Data Extraction (Bronze Layer)
- **Status**: Completed
- **Changes**:
  - Developed `phase_1_extraction.py` as an asynchronous ETL script to ingest localized job postings concurrently from JSearch, Adzuna, and Jooble.
  - Configured strict radius constraints around Springfield, MO (30 miles / 48 km).
  - Enforced concurrent semaphores for endpoint rate-limiting protection.
  - Saved raw API payloads directly into local Pocketbase `raw_jobs` records.

### Phase 2: Semantic De-Noising & Kill Switch Module (Silver Layer)
- **Status**: Completed (Optimized)
- **Changes**:
  - Installed and configured high-performance `ujson` for all JSON deserialization.
  - Created `.env` file to securely maintain local Pocketbase credentials.
  - Initialized Pocketbase collections programmatically using flat field parameters for v0.22+ compatibility.
  - Created modular `evaluator.py` containing the `evaluate_eligibility(text)` function, backed by pre-compiled regex patterns at the module level for $O(1)$-like category matching.
  - Created `cleaner.py` containing the `scrub_boilerplate(text)` function, using pre-compiled regexes to truncate noise phrases (EEO, benefits, and fluff) at the first occurrence.
  - Updated `core/pocketbase_client.py` with custom CRUD, `/api/collections/_superusers` authentication, and page-based fetching.
  - Updated `phase_2_cleansing.py` to:
    - Process `status = 'raw'` records in iterator-based batches of 50.
    - Unpack multi-job sweeps into individual listings and update parent sweep statuses to `'processed'`.
    - Persist transformation results for **every** job directly to `job_listings` using the relation-based schema (`raw_job_id`, `is_eligible`, `discard_reason`, `description_clean`).
    - Wrap single-listing evaluations in try-except blocks to prevent crashes on malformed data.
  - Wrote a unified testing suite in `test_phase_2.py` with 100% pass rates.
  - Verified end-to-end functionality via `mock_etl_run.py` validation script.

### Quality Check & Robustness Refactoring (Silver Layer Enhancements)
- **Status**: Completed
- **Changes**:
  - Fixed false-positive truncation issue on the De-Noiser pattern by adding word boundaries to the `pto` regex (preventing accidental truncation on words like `symptom`).
  - Added support for plural EEO phrases (e.g., `disabilities`) and medical benefit variations (e.g. `health, dental and/&/or vision`).
  - Re-implemented `fetch_all_companies()` and `fetch_raw_jobs()` in `PocketbaseClient` with proper page-based pagination loops to scale beyond 500 records.
  - Configured `phase_2_cleansing.py` orchestrator to populate `analysis_metadata` and `description_clean` fields in the `raw_jobs` table, and capture processor exceptions directly in the database's discard reason.
  - Added unit test cases for new regex boundary and EEO variations, achieving 100% pass rate.
  - Verified E2E correctness against local PocketBase server.

### Phase 3: ARM64 C-Level Performance Optimization & Identity Resolution Refactoring
- **Status**: Completed
- **Changes**:
  - Refactored `CompanyResolver` to use `rapidfuzz.process.extractOne` for company identity resolution, shifting comparisons from Python loops to C-level executions optimized for ARM64.
  - Implemented normalization to lowercase and stripped punctuation from corporate names to improve match consistency.
  - Integrated dynamic in-memory caching directly inside `CompanyResolver` to minimize database queries.
  - Re-architected `phase_2_cleansing.py` to process records in a contiguous, single-pass loop (stream in batches of 50, unpack sweeps, and process individual listings consecutively).
  - Added the Date field `enriched_at` to the `job_listings` collection schema in `setup_pocketbase.py`.
  - Developed a standalone `execute_local_enrichment_placeholder(company_id, listing_id)` module step that records a timestamp value to `enriched_at` without firing external network queries.
  - Updated the unit tests in `test_phase_2.py` and validated 100% success rate E2E.

### Phase 4: Local Linguistic Signal Node & Skill-Intersection Matrix (Gold Layer Analysis)
- **Status**: Completed
- **Changes**:
  - Created `core/culture_evaluator.py` containing the `CorporateCultureEvaluator` class, using precompiled regexes with word boundaries (`\b`) at the module level to scan job descriptions for 25 distinct red-flag phrases (burnout, exploitation, puffery, and bureaucracy).
  - Created `core/skill_matcher.py` containing the `SkillMatcher` class, using precompiled regexes with word boundaries to scan for 15 target Systems Architecture/Operations skills.
  - Updated `setup_pocketbase.py` to support the new schema fields in the `job_listings` collection: `toxicity_score` (number), `skill_match_count` (number), `leverage_ratio` (number), and `target_status` (text).
  - Updated the contiguous main loop in `phase_2_cleansing.py` to run the evaluators on eligible cleaned job descriptions, calculate the leverage ratio (skills divided by max of 1 and toxicity score), and assign a strategic target status ("Turnaround / High Leverage", "Pristine Target", "Toxic / Low Match (Discard)", or "Standard Review").
  - Extended the unit test suite in `test_phase_2.py` to cover both evaluators, word boundary behaviors, and status classification logic, maintaining a 100% pass rate.
  - Created and ran `verify_phase_4.py` validation script, confirming correct classification and scoring across all test cases.

### Phase 5: Static Dashboard Development (Gold Layer Visualization)
- **Status**: Completed
- **Changes**:
  - Configured a directory junction mapping `C:\forge\foundry_project\bus\pocketbase\pb_public` to `c:\job_search_project\pb_public` to allow native serving of files by Pocketbase.
  - Set public read rules (`listRule` and `viewRule` set to `""`) for both `companies` and `job_listings` collections in `setup_pocketbase.py` to allow anonymous API requests from the frontend.
  - Created `pb_public/index.html` using Pico.css as a styling baseline, designing a clean, responsive dark-themed dashboard. Added a stats panel, status search/filter controls, and a results grid.
  - Created `pb_public/style.css` containing custom obsidian glassmorphic theme styling, transitions, copy success indicators, and pulsing connectivity badges.
  - Created `pb_public/app.js` using the PocketBase JavaScript SDK (via CDN) to asynchronously fetch eligible listings, calculate aggregate stats, filter/search/sort listings in-memory, open the clean description viewer, and copy clean descriptions directly to the clipboard.
  - Verified local server accessibility at `http://127.0.0.1:8090/` with successful asset retrieval (HTTP 200).


### Phase 6: System Refactor, Concurrency Constraints, & Presentation Upgrades
- **Status**: Completed
- **Changes**:
  - **Module 1 (Schema & DB Hardening)**: Deleted `pb_migrations/` to start fresh. Updated `setup_pocketbase.py` to add indices (`idx_status`, `idx_hash`, `idx_eligible`, `idx_target`), changed `raw_job_id` `cascadeDelete` to `False` to protect the Gold Layer, and added data vector fields (`salary_min`, `salary_max`, `apply_url`, `posted_at`, `payload_hash`).
  - **Module 2 (Extraction & Deduplication)**: Refactored `phase_1_extraction.py` to include a Deduplication Gate using MD5 hashing. Migrated from `response.json()` to `ujson.loads()`. Eliminated `asyncio.Semaphore` and restructured `main()` to use a master `asyncio.gather()` block wrapping sequential query loops with embedded rate-limiting delays.
  - **Module 3 (Deterministic Scoring)**: Expanded `evaluator.py` exclusion dictionary with "Trades/Labor" and "Clinical" branches. Refactored `core/culture_evaluator.py` and `core/skill_matcher.py` to use explicit tuple mappings with varying weights. Updated `CompanyResolver` to use `rapidfuzz.fuzz.WRatio` with a >66.0 threshold. Handled idempotence in `unpack_single_sweep()` and extracted new data vectors in the `phase_2_cleansing.py` transformation loop.
  - **Module 4 (Presentation Layer)**: Pinned PocketBase SDK to `@0.22.0`. Implemented server-side pagination (`getList(1, 50, ...)`) and a "Load More" button in `pb_public/app.js`. Deferred heavy description fetches to the modal overlay. Rendered salary brackets, relative job age, and apply links in the UI. Linked the `.pulse-indicator` CSS element directly to actual database query states.
  - **Module 5 (Project Hygiene)**: Replaced hardcoded paths in `core/config.py` with relative paths (`Path(__file__).parent.parent`) and created `core/__init__.py` for local package visibility.

### Phase 7: Critical Repair — UI Filter Synchronization & JIT Description Scraping
- **Status**: Completed
- **Root Causes Diagnosed**:
  - The dashboard's Pristine filter dropdown used `value="Pristine Target"` while the database stores `"Low-Risk / Near Pristine"`, causing PocketBase `getList()` queries to return 0 results.
  - Adzuna and Jooble APIs return truncated search-result snippets (~255 chars with `&nbsp;` artifacts) in their `description` fields, not full job bodies. The pipeline stored and scored these fragments, degrading toxicity and skill-match accuracy.
- **Changes**:
  - **Module 1 (UI & Dashboard Synchronization)**: Fixed the `<option value>` for Pristine in `pb_public/index.html` from `"Pristine Target"` to `"Low-Risk / Near Pristine"`. Removed the redundant dual-match OR clause in `pb_public/app.js` `calculateStats()` so stats rely exclusively on the canonical DB string.
  - **Module 2 (JIT Scraper Architecture)**: Created `core/jit_scraper.py` implementing an async `fetch_full_description(apply_url)` function using `httpx` and `BeautifulSoup4`. Features include: `User-Agent` header, `follow_redirects=True`, 10s connection timeout, regex-based `<script>`/`<style>` block removal, hierarchical DOM extraction (job-desc class/ID → `<article>` → `<main>` → `<body>`), 200-char sanity check (discards if too short), and lazy singleton client with conservative connection limits (5 max). Added `beautifulsoup4>=4.12.0` to `requirements.txt`.
  - **Module 3 (Pipeline Orchestration Refactor)**: Reordered `phase_2_cleansing.py` to call `extract_metadata()` before `evaluate_eligibility()` so `apply_url` is available in scope for the JIT scraper. Inserted JIT fetch logic in the eligible branch: for Adzuna/Jooble sources with a valid `apply_url`, the scraper attempts to retrieve full text before `scrub_boilerplate()`. On success, overwrites `desc_raw`; on failure, gracefully falls back to the original snippet. Added `asyncio.sleep(JIT_FETCH_DELAY)` rate-limiting between fetches. Added `close_jit_client()` to the `finally` block for proper resource cleanup.
  - **Module 4 (Data Backfill Utility)**: Created `scripts/backfill_descriptions.py` as a one-time utility to retroactively enrich existing Adzuna/Jooble records. Scans `job_listings` for records with `description_clean` shorter than 300 chars, expands through `raw_job_id` to verify source, JIT-fetches full text via the shared `core/jit_scraper.py`, re-cleans with `scrub_boilerplate()`, and patches the record. Supports `--dry-run` and `--batch-size` flags.

---

### Phase 8: 25-Item Overhaul — Full Pipeline Refactor
- **Status**: Completed
- **Scope**: 15 files modified, 4 new files created, 4 new PocketBase collections, 20 new job_listings schema fields.
- **Items Delivered**:

#### Phase A — Schema Foundation (`setup_pocketbase.py`)
- Full destructive rebuild adds 20 new fields to `job_listings`:
  `description_full`, `description_scored`, `salary_parseable`, `days_since_posted`, `recency_multiplier`, `is_stale`, `location_type`, `seniority_level`, `industry`, `application_status`, `apply_type`, `is_ghost_job`, `is_duplicate`, `match_percentile`, `ats_alignment_score`, `final_leverage_ratio`, `source_platform`, `job_location`, `company_name`, `payload_hash`.
- Three new collections: `blacklisted_companies`, `filter_profiles`, `ats_watchlist`.
- `updateRule` and `createRule` set to `""` on `job_listings`, `blacklisted_companies`, `filter_profiles` so the dashboard can write without a proxy.

#### Phase B — Kill Switch Overhaul (`evaluator.py`) — Items 4, 5
- **Item 4**: Removed `Entry-Level/Support` category entirely. All seniority levels now permitted through the kill switch gate.
- **Item 5**: Added `Hard-Personal-Disqualifier` category with 26 pre-compiled regex patterns covering degree mandates, travel requirements, and government/public-sector signals.

#### Phase C — JIT Scraper Rewrite (`core/jit_scraper.py`) — Item 3, Tier 3
- Full rewrite: `robots.txt` check via stdlib `urllib.robotparser` (cached per domain), 3-attempt retry (immediate → 5s → 15s), module-level 3s global rate limiter (`_last_fetch_time`), structured JSON-line logging to `jit_scraper.log`, trigger condition `< 150 chars`.
- `close_jit_client` alias preserved for backward compat.

#### Phase E — ATS Direct Watcher (`core/ats_watcher.py`) — Item 3, Tier 2
- New module. `run_watchlist_sweep(pb_client)` polls `ats_watchlist` entries for Greenhouse, Lever, Workday (2-step detail fetch). 2s inter-company delay. Results tagged `source_platform = "ats_direct_{ats_type}"`. Logs to `jit_scraper.log` with `[ATS]` prefix.

#### Phase D — Ingestion Engine Replacement (`phase_1_extraction.py`) — Item 3, Tier 1
- Complete replacement of JSearch/Muse engine with a three-tier architecture:
  - **Tier 1 (JobSpy)**: 5 queries × 4 boards (Indeed, LinkedIn, ZipRecruiter, Google) via `ThreadPoolExecutor`. 3s inter-board delay. SHA-256 dedup gate. Hourly → annual salary annualization (×2080). Records inserted directly into `job_listings` with `is_eligible=null` (awaiting phase_2 scoring).
  - **Tier 2 (ATS Watcher)**: Calls `run_watchlist_sweep()` after Tier 1.
  - **Tier 3 (JIT Backfill)**: Patches `description_full` for records under 150 chars.
- `--dry-run`, `--skip-ats`, `--skip-jit` CLI flags added.

#### Phase F — Dual Description Split (`cleaner.py`) — Item 2
- Added `split_description(text) -> tuple[str, str]` returning `(description_full_unchanged, scrub_boilerplate(text))`.
- Original `scrub_boilerplate(text) -> str` preserved with identical signature for `test_phase_2.py` compatibility.

#### Phase H — Scoring Module Rebuilds
- **`core/skill_matcher.py`** (Item 8): Full rebuild. Weight-3: 18 high-signal terms (Salesforce, HubSpot, CRM, RevOps, etc.). Weight-1: 26 supporting terms. Set-based matching (each keyword counts at most once). Input is `description_scored`. SQL and DSIE removed.
- **`core/industry_classifier.py`** (Item 14): New module. First-match-wins keyword scanner across 11 industry tags. All regex pre-compiled at module level.
- **`core/resume_profile.py`** (Item 23): New module. `RESUME_KEYWORDS` list (34 terms). `compute_ats_alignment_score(desc_full) -> int` returns 0-100 overlap percentage.

#### Phase G — phase_2_cleansing.py Major Overhaul — Items 1, 6, 7, 9, 11, 12, 13, 19, 21, 22, 23, 24
- **Dual-stream architecture**: Stream A processes legacy `raw_jobs` records; Stream B processes new `job_listings` records where `is_eligible IS NULL` (from phase_1).
- **Item 1**: Kill switch runs on full untruncated `description_full` text; `scrub_boilerplate()` only runs after eligibility is confirmed.
- **Item 6**: Remote-only hard stop after location_type classification. If `remote` and no Springfield/MO/Ozarks signal → `discard_reason="Remote-No-Local-Presence"`.
- **Item 7**: Salary floor check. Parses salary from `description_full` (annual, hourly, single-value patterns). Discards if `salary_parseable=True AND salary_max < $40,000`. Stores `salary_parseable` field.
- **Item 9**: Recency decay bands (0-7d: ×1.0, 8-14d: ×0.80, 15-21d: ×0.55, 22+d: ×0.25). Writes `recency_multiplier`, `final_leverage_ratio = leverage_ratio × recency_multiplier`, `is_stale=True` if ≥22d.
- **Item 11**: Post-sweep match percentile computation. `_compute_percentiles()` ranks all eligible records by `final_leverage_ratio`. Updates `match_percentile` (0-100) and `target_status` to tier labels: Tier 1/Top (≥80), Tier 2/Strong (≥50), Tier 3/Moderate (≥20), Tier 4/Low (<20).
- **Item 12**: `_classify_location_type()` — remote/hybrid/on_site/unknown, first-match-wins.
- **Item 13**: `_detect_seniority()` — director/manager/senior/entry/unspecified, display-only.
- **Item 19**: Blacklist loaded once per sweep via PocketBase. RapidFuzz `token_sort_ratio > 90` check per record.
- **Item 21**: Ghost job flag — set if `days >= 30 AND NOT salary_parseable AND ghost phrase found`.
- **Item 22**: Post-sweep RapidFuzz fuzzy dedup. Queries same `company_name` records, title `token_sort_ratio > 90` → `is_duplicate=True`.
- **Item 23**: `compute_ats_alignment_score()` called per eligible record.
- **Item 24**: `_detect_apply_type()` — easy_apply/external_ats/unknown detection from URL + description.
- Bug fix: corrected the `title = job_payload.get("company")` assignment bug in the legacy `else:` branch.

#### Phase I — Logger Extension (`logger.py`)
- Added 6 new counters to `CleansingLogger.__init__`: `stale_flagged`, `ghost_jobs_flagged`, `duplicates_flagged`, `salary_floor_discards`, `remote_no_local`, `blacklist_discards`.
- `save_stats()` appends these as new keys after the original 4 keys (backward compat guaranteed).

#### Phase J — Dashboard Overhaul (`pb_public/`)
- **`app.js`**: Complete rewrite. New: 8-badge pill row per card (tier, seniority, salary, location, days, industry, app-status, apply-type); recency toggle (7d/14d/21d/30d/All, default 14d); remote cap at 14d regardless of toggle; application status PATCH to PocketBase with per-modal status editor; Fuse.js client-side fuzzy blacklist filtering; blacklist management panel (add/remove chips); filter profile save/load via `filter_profiles` collection; CSV export (all current records + full descriptions, filename `job_export_YYYY-MM-DD.csv`).
- **`index.html`**: New controls: recency toggle buttons, app-status filter, location-type filter, Save Filter/Load Profile row, Export CSV button, Settings/blacklist toggle. Fuse.js CDN added.
- **`style.css`**: Complete overhaul. New: pill-row system with 15+ variants; tier accent bars on cards; recency-toggle button group; blacklist-panel with chip UI; loader ring animation; 4-tier color system (replaces pristine/turnaround/toxic labels); backward compat `.badge.pristine` etc. classes retained.

#### Phase K — Infrastructure
- **`Run_Job_Sweep.ps1`**: Appends JSON entry to `sweep_log.json` after each phase (timestamp, status, exit code, stats summary). Log capped at 200 entries.
- **`setup_scheduled_task.ps1`** (new): Registers Windows Task Scheduler task `JobSearch_DailySweep` at 07:00, 12:00, 18:00 daily. Idempotent. 2-hour execution limit, 1 auto-restart, IgnoreNew multi-instance policy.

#### Phase L — Completion
- `requirements.txt`: Added `python-jobspy>=0.1.0`. Documented stdlib modules.
- **Test suite status after refactor** (expected, per mandate): `test_evaluate_eligibility_junior_disqualified` FAILS (Entry-Level category removed, Item 4). `test_skill_matcher_boundaries` FAILS (SQL removed from skills, Item 8). Two additional tests were already failing pre-refactor from Phase 6 weighted scoring changes (`test_culture_evaluator_distinct_flags`, `test_skill_matcher_matches`). All `test_scrub_boilerplate_*` tests PASS (original signature preserved). All resolver and structure tests PASS.
- `AGENTS.md`: Updated with new modules, new fields, three-tier architecture.
- `README.md`: Architecture diagram and core components updated.

### Phase 9: Scoring Overhaul & Dashboard Completion
- **Status**: Completed
- **Changes**:
  - **Module 1 (Culture Evaluator)**: Removed "fast-paced" from the `DICT_CHAOS_BURNOUT` array in `core/culture_evaluator.py`.
  - **Module 2 (Skill Matcher)**: Added proximity-gating for the keyword "Pipeline" (context window of 60 characters containing sales/revenue/deal/crm/account/quota). Restricted "Director" keyword strictly to the job title field matching. Expanded and pruned the skill keyword list (added RevGrowth, removed Training/Automation/Retail, etc).
  - **Module 3 (PocketBase & Pipeline Updates)**: Added `role_title_score` field. Modified `final_leverage_ratio` formula to include `role_title_score`. Implemented split decay curve in `_recency_multiplier` (harsher penalty for remote/unknown locations vs on-site/hybrid). Renamed `skill_match_count` to `skill_match_score` globally. Fixed `location_type` context loss in `_score_and_classify`.
  - **Module 4 (Dashboard Completion)**: Added Industry and Salary Range filters to the frontend. Added Ghost Job toggle (hide/show) with warning badge on cards. Added ATS Alignment to sort options. Mapped all newly required fields (salary, industry, seniority, location, apply type, percentile, role title score, days since, posted date, source platform) to the modal display overlay. Added "Apply Now" button to modal footer. Rendered raw description content in the modal using `marked.js` markdown parser for proper HTML rendering.

### Phase 10: Performance & Reliability Fixes
- **Status**: Completed
- **Scope**: Resolving serial bottlenecks, API breaks, and logging noise.
- **Changes**:
  - **Module 1 (Performance)**: Replaced serial DB query in `phase_1_extraction.py` with a bulk payload hash pre-load `db_client.fetch_all_payload_hashes()`, converting a O(N) HTTP overhead into an O(1) local hash set check. Replaced serial resolver in `phase_2_cleansing.py` and `core/resolver.py` with an async bulk query `resolve_company_identities_bulk`.
  - **Module 2 (Reliability)**: Removed ZipRecruiter from standard JobSpy board list. Integrated the internal `ZIPRECRUITER_MCP_URL` as a direct HTTP ingestion function `_fetch_ziprecruiter_api()` (renamed from `_fetch_ziprecruiter_mcp()` to reflect its direct REST-over-HTTP nature) inside Phase 1, mapped directly to the PocketBase schema. Implemented zero-result Google Jobs failure detection to warn of broken scrapers.
  - **Module 3 (Config & Logging)**: Added `ENABLE_GOOGLE_JOBS` and `LINKEDIN_FETCH_FULL_DESC` to `core/config.py` for easy toggle of error-prone scrapers. Muted `httpx` INFO logs to WARNING, downgraded PocketBase insert logs to DEBUG, and added explicit Phase 1 ingestion summaries and Tier 2/3 start/completion counts to standard output.
  - **Module 4 (Exclusions)**: Fixed `evaluator.py` by removing overly broad "assembl" and "warehouse" tokens and replaced them with the context-aware regex group `_TRADES_COMPLEX_PATTERNS` prior to the hard disqualifier block.

### Phase 11: Browser-Native Progressive Web App (PWA) Refactor
- **Status**: Completed
- **Changes**:
  - Replaced the local Python/PocketBase scraper and cleansing pipelines entirely with browser-native scripts.
  - Developed `js/storage/local-db.js` using `Dexie.js` to initialize local IndexedDB storage.
  - Developed `js/storage/db-adapter.js` to abstract database actions for simple frontend data read/write.
  - Integrated a CORS proxy URL in `js/config.js` and wrapped HTTP request utilities in `js/utils/fetch.js` to solve browser CORS restrictions.
  - Developed browser-native extractors `rss-adapter.js` (Indeed RSS parser), `remotive-api.js` (Remotive API fetcher), and `sitemap-parser.js` (sitemap parser with robots.txt parsing and a parallel concurrency limit of 3).
  - Developed `js/ai/byok-router.js` to dynamically route LLM prompt payloads to Cerebras, Groq, or Gemini Flash depending on token count and task context.
  - Offloaded heavy semantic embeddings calculations (`Xenova/all-MiniLM-L6-v2` at `dtype: "q4"`) to Web Workers using `js/workers/semantic-worker.js` and `js/ai/transformers-engine.js`.
  - Developed `js/ai/resume-parser.js` using `PDF.js` for client-side PDF text extraction and saved resume profiles directly into IndexedDB.
  - Ported the entire scoring engine (kill switches, skill matchers, toxicity evaluators, industry classifiers, and coordinator) from Python to identical JS modules.
  - Created `manifest.json` and a service worker `sw.js` with static cache-first and network-first API fetching strategies to complete PWA compliance.
  - Created a first-run Setup Wizard modal (`js/features/setup-wizard.js`) for parameters, categories, resume uploads, API keys, and CORS proxies.
  - Created `js/storage/data-portability.js` to export/import versioned JSON backups and show a 30-day backing reminder banner.
  - Deprecated and removed obsolete Python scripts, updated `requirements.txt`, and provided a private Cloudflare Worker CORS proxy in `cors-proxy/worker.js` with a setup instructions guide in `cors-proxy/README.md`.

### Phase 11.1: UI Patch & Documentation Alignment
- **Status**: Completed
- **Changes**:
  - **Fixed Setup Wizard Scrolling Bug**: Modified `.setup-wizard-dialog` in `pb_public/style.css` to restrict the modal's maximum height (`max-height: 90vh;`) and enabled vertical scrolling (`overflow-y: auto;`) for internal modal contents.
  - **Body Scroll Lock**: Added the `.no-scroll` utility class to `pb_public/style.css` and updated `pb_public/js/features/setup-wizard.js` to append `.no-scroll` to `document.body` when the setup wizard modal opens, and remove it upon modal close or successful setup submission.
  - **Cleaned Up AGENTS.md**: Removed deprecated Python-specific rules (`cleansing_stats.json`, `setup_scheduled_task.ps1`, PocketBase API rules), and updated constraints to reflect JavaScript/IndexedDB constraints (transaction limits, Web Workers off-main-thread execution).
  - **Overhauled README.md**: Rewrote the system architecture overview diagram to align with Phase 11 PWA (Browser Extractors -> Web Workers -> Dexie.js IndexedDB), removed obsolete Python execution instructions, and established serving the `pb_public` directory via a local HTTP server as the primary execution method.

### Phase 11.2: Critical UI Scroll Fix & Doc Audit
- **Status**: Completed
- **Changes**:
  - **Audited DOM & Modal Structure**: Identified that the setup wizard dialog wrapper (`.setup-wizard-dialog`) is a `<dialog>` element, and the actual content container is `.setup-wizard-card`.
  - **Setup Wizard Scroll Correction**: Relocated the scroll behavior from the outer dialog to `.setup-wizard-card` inside `pb_public/style.css`, applying `max-height: 85vh;`, `overflow-y: auto;`, and `overscroll-behavior: contain;` to block background scroll-chaining.
  - **Lock Enforcement**: Updated `pb_public/js/features/setup-wizard.js` to prevent native ESC key cancellations via a `'cancel'` listener, ensuring that the body `.no-scroll` lock (reinforced with `!important`) is only removed upon successful form submission.
  - **Guidelines Hardening**: Updated [AGENTS.md](file:///c:/job_search_project/AGENTS.md) to add strict **UI & Modal Constraints** instructing all future modifications to utilize `overscroll-behavior: contain`, internal scrolling, and active body scroll locking.
  - **README Enrichment**: Updated [README.md](file:///c:/job_search_project/README.md) to explicitly document that the Setup Wizard configures **Localized Geofencing (Location & Radius)** and filters by specific categories (**Sales, Operations, and Tech/AI**).

### Phase 11.3: Pipeline Transparency & High-Signal Query Mapping
- **Status**: Completed
- **Changes**:
  - **Silent Kill Switch Fix**: Removed the `Remote-No-Local-Presence` hard discard logic from `scoring-coordinator.js`. Nationwide remote jobs now pass eligibility, and the penalty for being remote without a local presence is handled by the recency/leverage multipliers instead of an outright discard.
  - **High-Signal Query Mapping**: Intercepted the role category checkboxes in `setup-wizard.js` to map them directly to high-leverage boolean search strings for Sales, Operations, and Tech categories.
  - **Configuration Update**: Updated `config.js` default queries and modified `app.js` to ingest these specific high-signal queries from the user profile.
  - **Pipeline Transparency UI**: Modified `index.html` to include small statistic displays under "Eligible Jobs Scored" showing "Raw Ingested" and "Discarded/Deduped" counts. Updated the ingestion sweep logic in `app.js` to compute and render the true ingestion funnel stats to the dashboard.

### Phase 11.4: GitHub Deployment Readiness & Zero-Friction UX
- **Status**: Completed
- **Changes**:
  - **Zero-Friction Onboarding**: Wrapped the "Step 3: BYOK LLM Keys & CORS Proxy" section in `setup-wizard.js` inside a native HTML `<details>/<summary>` element labeled "Advanced Settings (Optional: API Keys & Proxies)". The section is collapsed by default so non-technical users never see API key fields during first-run. Added an explanatory paragraph inside confirming that API keys are optional and the app works without them.
  - **Details/Summary CSS**: Added CSS rules in `style.css` for the collapsible details toggle including arrow rotation animation on open and webkit marker suppression, plus `.stat-sub` styling for the pipeline funnel sub-statistics.
  - **README.md Overhaul for Open Source**: Completely rewrote `README.md` for the general public and GitHub deployment at `https://github.com/metakong/job_search_project`. Emphasizes zero-Python setup requirement, browser-native PWA architecture, and includes: quick-start guide with multiple serving options (Python, npx, VS Code Live Server, static hosting), supported high-signal job categories table, full architecture diagram, project structure, contributing guidelines, and roadmap.
  - **Legacy Cleanup (.agents/AGENTS.md)**: Replaced the outdated `.agents/AGENTS.md` which still referenced Python-specific constraints (ARM64, `ujson`, `re.compile`, `try-except`) with the current Phase 11 JavaScript/PWA-aligned constraints (Dexie.js, Web Workers, IndexedDB, UI modal rules).
  - **Verification**: Confirmed all prior Phase 11.1–11.3 changes remain intact: setup wizard scroll fix (`max-height: 85vh`, `overflow-y: auto`, `overscroll-behavior: contain`), `.no-scroll` body lock, ESC prevention, high-signal query mapping, pipeline transparency stats, and Remote-No-Local-Presence kill switch removal.

### Phase 11.6: The Probabilistic Labor Matrix & Inferno Classifier
- **Status**: Completed
- **Changes**:
  - **Premium Tabbed Navigation Overhaul**: Removed the old `#status-filter` select element from the controls card. Injected a beautifully styled obsidian tabs layout (Strike Zone, Moonshot, Safety Net, and Dante's Inferno) with interactive glows and informational tooltips.
  - **Job Hunt Strategy Dial**: Injected a 3-step slider control (Survival, Balanced, Aggressive Growth) that dynamically recalibrates threshold calculations in real-time.
  - **Dante's Inferno Satire Crimson Theme**: Implemented body level `.inferno-mode` layout modifier, seamlessly transitioning backgrounds, borders, and glows from obsidian-indigo to deep hellish crimson gradients (`#2a0808` to `#0d0202`).
  - **9 Circles Classifier Banishment Math**: Dismantled hard-drop discard gates. Toxic listings now persist in the local database but are dynamically routed into the **9 Circles of Corporate Hell** (Limbo, Lust, Gluttony, Greed, Anger, Heresy, Violence, Fraud, Treachery) with customized banner warnings and crackling animation flairs.
  - **Probabilistic Risk/Reward Matrix**: Evaluates listings against user profiles using relative Delta-X (Skills Overlap Ratio) and Delta-Y (Trajectory Seniority Steps) coordinates, shifting classifications dynamically based on Strategy Dial rules.
  - **Automated Resume Seniority Calibration**: Re-engineered `resume-parser.js` to parse uploaded PDF resumes for seniority levels (Director/VP/Founder = 4, Manager/Lead = 3, Senior = 2, Entry = 1) and salary floor anchors, saving the baseline directly into the local `user_profile` IndexedDB store.

### Phase 11.7: Production UX Layout & Math Engine Repair
- **Status**: Completed
- **Changes**:
  - **UI/UX Layout De-Cramming**: Extracted the Zone Tabs and Strategy Dial from the cramped `.controls-card` grid into a dedicated, full-width `<section id="strategy-navigation">` injected directly above the jobs section in `index.html`.
  - **Styling Hierarchy**: Updated `style.css` to include the `.zone-tabs` class with flexible layout, dark theme adaptations, and interactive `.active` button states. Improved the `.inferno-mode` background variable configuration.
  - **Delta Math Repair**: Fixed the `NaN` cascade in `scoring-coordinator.js` by establishing bulletproof numeric seniority parsing and correctly normalizing `Delta-X` scaling out of 5 skills.
  - **Dynamic Categorization Matrix**: Unified the Strategy Dial logic (Survival, Balanced, Aggressive) natively into `scoreAndClassifyJob()` and `recalculatePercentiles()`, ensuring deterministic categorizations based on `Delta-X` and `Delta-Y`. Dante's 9 Circles banishment rules enforce a strict override.
  - **UI Logic Wiring**: Updated `app.js` and `db-adapter.js` to implement exact filtering based on the selected `currentZone`. Wired real-time IndexedDB persistence to the Strategy Dial event listener, automatically triggering background re-scores.

### Phase 11.8: Fatal Crash Resolution & Data Migration
- **Status**: Completed
- **Changes**:
  - **Scrubbed Ghost References**: Verified and removed any dangling references to the deleted `#status-filter` element across `app.js` and `db-adapter.js` to prevent fatal `TypeError` crashes on dashboard load.
  - **Legacy Data Graceful Fallback**: Modified the `getJobs` query in `db-adapter.js` to handle older scraped jobs lacking a `computed_zone` property, safely defaulting them to `'strike'` so they remain visible in the UI rather than turning into invisible ghosts.
  - **Bulletproofed Inferno Flag**: Hardened the Dante's Inferno override logic in `scoring-coordinator.js` to securely reference the evaluator payload without triggering `ReferenceError` crashes on undefined `eligibility` properties.
  - **Console Verification**: Added verbose filter logging in `app.js` to prove `currentZone` state accurately passes down into the IndexedDB query logic.

### Phase 11.9: Ingestion Spigot Uncorking & Relevance Math
- **Status**: Completed
- **Changes**:
  - **Atomic Query Mapping**: Modified `setup-wizard.js` to produce a flattened array of distinct atomic strings rather than single boolean OR strings for search queries, bypassing API limitations.
  - **Multi-Request Iteration**: Updated `rss-adapter.js` and `remotive-api.js` to iterate over the `queries` array, dispatching independent fetch requests per string and deduplicating results via `payload_hash`.
  - **The Relevance Floor**: Enforced a `deltaX < 0.15` filter inside `scoreAndClassifyJob()` in `scoring-coordinator.js` to automatically categorize jobs with near-zero skill overlap as `noise`. Prevented `recalculatePercentiles` from overwriting this zone.
  - **UI Noise Filtering**: Hardened `db-adapter.js` `getJobs()` logic to actively discard jobs where `computed_zone === 'noise'` from all dashboard view payloads.

### Phase 11.10: The Hexagonal Labor Matrix & 36-State Routing Engine Deployed
- **Status**: Completed
- **Changes**:
  - **Hexagonal Matrix Foundation**: Updated `evaluator.js` with new Logistical and Toxicity Gate logic returning vectors instead of just filtering. Toxicity uses prioritized threshold checks for Dante's 9 Circles.
  - **36-State Routing**: Replaced naive final_leverage_ratio with Core Score (combining Semantic skill vector, Trajectory Delta, Economic scaling, and placeholder Culture scoring) inside `scoring-coordinator.js` which branches out deterministically based on Strategy Dial constraints.
  - **UI Matrix Metrics Display**: Job Cards now prominently display the "Core Score" out of 100 instead of arbitrary technical skill overlaps, giving direct feedback on overall opportunity leverage. Reconfigured sorting engine to map to this core score metric seamlessly.

### Phase 12: QA Refactor — Calibration, Honesty & Hardening (Opus 4.8)
- **Status**: Completed
- **Context**: A full read-only QA review found that the rapid Phase 11.6–11.10 changes (done by other models) had left several headline features broken or dead, the toxicity engine wildly over-flagging (sending the majority of jobs to Inferno), and the matching hardcoded to one persona. This phase fixes all of it and re-grounds the project in its candidate-first mission.
- **Scoring engine (recalibrated & verified)**:
  - **`evaluator.js`** rewritten as an **additive, weighted toxicity engine** grounded in real 2024–2026 hiring red-flag research (MLM/biz-opp scams, wage-theft/unpaid work, overwork, discrimination). Strong scam/exploitation signals can trigger Inferno alone; weak clichés ("fast-paced", "rockstar") only matter in accumulation. Threshold calibrated so **Inferno is a minority** (validated by a Node simulation: ~16–20% on an 18%-toxic synthetic mix). Removed the bug where a single common word like "pipeline" or "fast-paced" auto-banished jobs to Hell.
  - **`culture-evaluator.js`** repurposed into a real **culture vector (0–1)** that rewards green flags (pay transparency first) — it now actually feeds the Core Score (previously a hardcoded `0.5` placeholder).
  - **`skill-matcher.js`** made **résumé-driven**: extracts the candidate's signature keywords (or their search terms) and measures overlap — works for ANY candidate, not just sales/ops. Built-in skill list is now only a supplement.
  - **`scoring-coordinator.js`** rewritten: transparent Core Score (55% fit / 25% pay / 20% culture, no hidden constants); trajectory-led zone routing faithful to the definitions (Strike=aligned lateral, Moonshot=reach up, Safety=step down in-field, Inferno=toxicity override, noise=hidden); Strategy Dial reshapes thresholds; **real** ghost/stale/duplicate detection and recency; **global** percentiles (no longer per-page).
- **Critical bug fixes**:
  - Added missing `dbAdapter.getBlacklistNames()` — the Strategy Dial threw a `TypeError` on every change and silently did nothing; it now performs a correct batched, persisted re-score.
  - Removed dead, always-zero UI metrics (`final_leverage_ratio`, `role_title_score`) and replaced them with honest ones (Core Score, Fit %, Culture %, Toxicity, Trajectory).
  - Fixed résumé calibration: `saveResumeText`/`calibrateFromText` are now actually invoked by the wizard and write the correct `baselineSeniority` field (was `user_baseline_seniority`, never read).
  - Fixed pagination/zone inconsistency by removing view-time re-scoring; scoring/zones are persisted, the dashboard only filters an in-memory cache.
- **Security**: markdown descriptions now sanitized via **DOMPurify** (was a stored-XSS sink); apply URLs validated to http/https via `safeUrl()` (was a `javascript:` vector); CSV export guards against formula injection; deleted the on-disk `.env` credential (verified never committed).
- **Honesty & cleanup**: removed the dead BYOK LLM router (collected API keys, did nothing); semantic embeddings (`transformers-engine` + `semantic-worker`) are now an **opt-in** Delta-X booster with graceful keyword fallback (previously dead); deleted legacy cruft (`requirements.txt`, `__pycache__`, `pip_*.log`, `jit_scraper.log`); replaced hot-linked remote PWA icons with a local `icon.svg`; hardened the service worker (resilient install, pinned CDN versions, caches the full local app shell).
- **Granular control**: wizard now takes free-text target roles and an explicit current-level selector; recency defaults to "All"; honest privacy disclosure about the CORS proxy.
- **Modules** are now IIFE-wrapped (removed duplicate global `escapeRegExp` definitions). Dexie schema bumped to v2 with migration.
- **Verification**: Node simulation harness asserts known-toxic→Inferno, known-good→not, correct zone placement across all three Strategy Dial settings, and Inferno-minority distributions (11/11 pass). All 62 DOM ids referenced by `app.js` confirmed present in `index.html`.

### Phase 12.1: Async Stabilization & Pipeline Resiliency
- **Status**: Completed
- **Changes**:
  - **Sequential Network Throttling (`app.js`)**: Replaced concurrent `Promise.all()` fetching with sequential `for...of` loops and injected a global `sleep(1000)` throttle to prevent CORS proxy rate-limiting and DDoS. Added granular UI updates via `updateLoadingText()`.
  - **AI Pre-Warming & Timeout Fallback (`setup-wizard.js`, `transformers-engine.js`)**: Sent a `warmup` message to the semantic worker if AI Semantic Matching is enabled to trigger background model download. Wrapped the Web Worker `postMessage` call in `transformers-engine.js` with a `Promise.race()` and a 10-second timeout to gracefully degrade to keyword math if the model download hangs.
  - **Database Write Chunking (`db-adapter.js`)**: Rewrote `saveJobsBulk(jobs)` to chunk IndexedDB writes (arrays of 25) to prevent memory spikes. Retained payload hash deduplication logic.
  - **Targeted DOM Mutations (`app.js`)**: Optimized the save status action in the modal by removing full screen re-rendering `renderCards()`. Now manually queries and updates the specific card's pill row directly in the DOM using its ID (`job-card-{id}`).
  ### Phase 13.0: Dynamic Probabilistic Scoring & Pipeline Architecture Refactor
- **Status**: Completed
- **Changes**:
  - **Component 1 (Pipeline Stabilization)**: Refactored configurations for robust timeouts, chunked persistence to IndexedDB to avoid freezing the UI, worker queues, and timeout defaults.
  - **Component 2 (New Scoring Modules)**: Created `ambiguity-index.js` (Shannon entropy approach) and `transition-friction.js` to compute transition probabilities based on job title, industry, and skills.
  - **Component 3 (Scoring Engine Refactor)**: Refactored `resume-parser.js` for Peak vs Recent seniority detection. Added `computeWeightedOverlap` in `skill-matcher.js`. Overhauled `scoring-coordinator.js` to use a 2-phase pipeline (feature extraction -> global percentile distribution). Re-calibrated the toxicity minimum floor to 75 (0-100 scale).
  - **Component 4 (Schema Migration)**: Bumped Dexie DB schema in `local-db.js` to v3. Added new fields (`ambiguity_index`, `transition_friction`, `strategy_tier`, `zone_rank`). Implemented a `requires_rescore_v13` trigger on upgrade.
  - **Component 5 (UI Updates)**: Refactored Strategy Dial to be an exclusive filter (`db-adapter.js`) mapping strictly to 1/3 subsets. Updated `app.js` to handle `requires_rescore_v13` with a non-blocking toast, and implemented dual seniority dropdowns in `setup-wizard.js`. Added `card--pending` CSS for loading states.

### Phase 13.3: Production Hardening
- **Status**: Completed
- **Changes**:
  - **CORS Proxy Rotation**: Updated `fetch.js` to rotate through a fallback list of proxies, preventing 403 blocks from crashing the ingestion sweep.
  - **Delta-Y Math Repair**: Fixed the trajectory flatlining logic in `scoring-coordinator.js` so "Unknown" seniority jobs are correctly assigned `null` trajectories instead of `0`. Updated the UI in `app.js` to render "Unknown Trajectory" accordingly.
  - **Dynamic Strategy Slicing**: Altered `app.js` to dynamically toggle the Strategy Dial between Exclusive (tier matching) and Additive (tier threshold) filtering if the active pool drops below 50 listings.

### Phase 13.4: Critical Stabilization & Outlier Recovery
- **Status**: Completed (validated by Node simulation harness + live browser verification)
- **Context**: Live testing surfaced four compounding failures after the 13.0 forced-percentile refactor. Root cause analysis showed the percentile-thirds distribution had drifted away from the project's own two-axis (Delta-X / Delta-Y) zone definitions. This phase restores that intent and hardens the edges.

- **Diagnostic 1 — The Percentile Fallacy (data starvation promoting garbage)**:
  - **Re-architected `distributeAndRank()`** in `scoring-coordinator.js`. Zones are no longer forced score-quotas (top third → Strike, etc.). They are now assigned from the two candidate-relative axes the platform is built on: **trajectory (Delta-Y) chooses the zone** (reach-up → Moonshot, lateral → Strike, step-down → Safety) and **fit (Delta-X) gates entry** via absolute floors (`STRIKE_FIT_MIN`, `MOONSHOT_FIT_MIN`). A starved/off-target pool can no longer promote "the best of the worst": nothing below the fit floor reaches Strike or Moonshot.
  - **Relevance floor is fit-primary, not core-primary.** Deliberately diverged from the brief's "Core Score > 40" suggestion — Core Score blends in pay/culture, so a high-paying *irrelevant* role can score 44 on 8% fit. Fit (Delta-X) is the true relevance signal; pay must not rescue an off-target match. Genuinely irrelevant roles (fit `< NOISE_FIT_FLOOR`) are hidden as `noise`.
  - **Anti-blank-screen guard**: if the *entire* clean pool is below the fit floor (true starvation, or no résumé), nothing is hidden — the pool shows honestly in the Safety Net instead of rendering a "Zero Results" screen.
  - **Inferno is now an absolute, calibrated threshold** (`toxicity ≥ 50`, matching `evaluator.js`) with a hard **40% safety cap** (`INFERNO_MAX_FRACTION`) so a pathological batch can never make Inferno the majority pile. Replaces the confusing p84/75-floor hybrid (which also disagreed with the evaluator's own calibrated threshold).
  - **Ingestion (`themuse-api.js`, NEW)**: added The Muse as a key-free, CORS-friendly, US-centric source to relieve starvation when Indeed RSS is WAF-blocked — no backend, no mandatory key (North Star intact). It also exposes explicit `levels`, passed through as a **trusted `source_seniority`** to strengthen the Delta-Y axis for localized roles. Wired into the sweep in `app.js` (`mapToMuseCategories`). *Note: the network call could not be live-verified from the dev sandbox; it follows the proven `remotive-api.js` pattern and is best-effort (failures are caught and never halt a sweep).*
  - **`fetch.js` hardened**: tries a **direct request first** (many JSON APIs send CORS headers) before falling through an expanded proxy list, with a per-attempt `AbortController` timeout so one hung route can't stall a sweep. Fixed the `corsproxy.io` URL format (`?url=`).

- **Diagnostic 2 — Seniority Hallucinations (Delta-Y flatline)**:
  - **`detectSeniority()` now scans the TITLE ONLY.** Scanning `description_full` mis-read context ("…reports to the Director" → `director`), flattening trajectory. Added `assistant`, `clerk`, `trainee`, `apprentice` to the entry tier. `scoreAndClassifyJob()` honors a trusted `source_seniority` (e.g. The Muse) over the title heuristic, but the heuristic always re-derives from the title on re-score so a prior bad value is never "locked in".
  - *Validated*: "Assistant Accounts Payable Clerk (reports to the Director)" → `entry` (was `director`).

- **Diagnostic 3 — Additive Slider Defiance & Micro-Slicing**:
  - Rewrote the slicing in `app.js`: high-volume buckets use **exclusive equivalency** (`strategy_tier === dial`); buckets below `LOW_VOLUME_THRESHOLD` (24) **disable slicing entirely and show the whole bucket** (replaces the old `<= tier` additive behavior that the dial was stuck in for any pool under 50). Untiered jobs stay visible as a safety net.
  - *Validated*: a 30-job Strike zone shows 10/10/10 across dial positions 1/2/3 (exclusive, not 10/20/30 additive); a 1-job Safety zone shows that job at every dial position.

- **Diagnostic 4 — Inferno UI State Desync**:
  - The Strategy Dial is **disabled and labelled "N/A · Hazard View"** in the Inferno tab (career strategy is meaningless for a list of postings to avoid), via a single `updateStrategyDialState()` source of truth wired into init, zone-tab switches, and dial changes. Inferno jobs carry `strategy_tier = null` and are always shown in their tab. *Honest note: the literal "prints Survival" symptom was not reproducible from the committed code (the label was correctly bound to the dial); the underlying defect — Inferno jobs excluded from the tier system + a dial that implied it filtered hazards — is real and is what this fix resolves.*
  - **Bonus bug fixed**: `inferno_circle` was never persisted, so the banner/modal always fell back to a generic label. `evaluator.js` now returns `dominantCircle` (the top-weighted cause regardless of threshold) and the coordinator stores it. The banner now reads e.g. "🔥 Circle 8: Fraud (MLM / Biz-Opp) · Toxicity 100".

- **Config (`config.js`)**: bumped to `13.4.0`; added `INFERNO_TOXICITY_THRESHOLD`, `INFERNO_MAX_FRACTION`, `NOISE_FIT_FLOOR`, `STRIKE_FIT_MIN`, `MOONSHOT_FIT_MIN`, `LOW_VOLUME_THRESHOLD`, `FETCH_TIMEOUT_MS`; removed the now-dead `MIN_TOXICITY_FLOOR` / `INFERNO_PERCENTILE` / `MIN_CLEAN_POOL_FOR_DISTRIBUTION`. **Fixed a latent bug**: the coordinator read `window.APP_CONFIG` (never set) and silently used inline defaults — it now reads `window.CONFIG`, so these constants actually apply.
- **Schema (`local-db.js`)**: added v4 (logic-only change) that re-flags `requires_rescore_v13`, so existing users' listings are re-routed by the new engine on next load.
- **Validation**: `scratch/sim-harness.js`-style Node harness loads the real modules with a stub `window` and asserts the invariants across three scenarios — mixed pool, **pure starvation** (34 off-target roles → all Safety, none promoted, app not blank), and **toxic flood** (30 scams → Inferno capped at exactly 40%). All assertions pass. Verified live in-browser: zone routing, exclusive/low-volume slicing, and the Inferno dial state.

### Phase 1.0 Finalization
- **Status**: Completed
- **Changes**:
  - **Mathematical Anchoring (`skill-matcher.js`)**: Replaced raw keyword count denominator with `Math.max(keywords.length, 5)` to eliminate the 100% Fit Paradox on sparse descriptions.
  - **The Cross-Domain Veto (`scoring-coordinator.js`)**: Implemented a title-based veto matrix (comparing `profile.categories` against explicit `TECH_TITLES` and `SALES_TITLES` lists) that sinks `deltaX` by an 80% penalty if a cross-functional mismatch occurs. Avoided the "Industry vs. Function" trap.
  - **The Top-Level Noise Gate (`scoring-coordinator.js`)**: Installed a `deltaX < 0.25` guard clause immediately following the veto execution, definitively blocking irrelevant jobs from polluting the Trajectory or Safety Net logic.
  - **Title-Strict Seniority (`scoring-coordinator.js`)**: Verified and maintained `detectSeniority`'s strict adherence to scanning only `job.title`, eliminating structural hallucinations.
  - **Dynamic UI Slicing Override (`app.js`)**: Hardcoded the low-volume threshold to `30`. Implemented logic to dynamically fallback from Exclusive Slicing (`=== strategy_tier`) to Additive Slicing (`<= strategy_tier`) when the bucket is below threshold, protecting non-technical users from blank "Zero Results" dashboards.
  - > ⚠️ **Superseded by Phase 13.5.** Two of the bullets above shipped real regressions (verified by harness + browser): the `deltaX < 0.25` Noise Gate `return`ed *before* toxicity scoring, so off-field scams silently escaped Inferno; and the "Additive Slicing" fallback re-introduced the Diagnostic-3 slider bug and could blank the Survival view. See Phase 13.5 for the corrected, validated behavior.

### Phase 13.5: Full-Codebase Production Audit & Drift Reconciliation
- **Status**: Completed (validated: Node harness 15/15 + live browser parity)
- **Context**: Whole-codebase pass to fix all logical/math mistakes and reach June-2026 production quality for non-technical users (advanced/technical-user features intentionally deferred to a future phase). It also reconciled an external "Phase 1.0 Finalization" edit that had regressed verified Phase 13.4 behavior.

- **Drift reconciliation (`scoring-coordinator.js`, `app.js`)** — the highest-severity finds:
  - **Off-field scams escaping Inferno (CRITICAL).** A `deltaX < 0.25` "Noise Gate" early-`return` inside `scoreAndClassifyJob` ran *before* toxicity evaluation, so any toxic posting with low résumé fit (e.g. a scam targeting someone outside its field — the common case) was silently filed as hidden `noise` and never flagged. Removed the early return. `scoreAndClassifyJob` now always computes the full signal set (toxicity, Core, trajectory) for every posting; **`distributeAndRank` remains the single source of truth for noise/zoning.** Locked with a permanent harness assertion ("off-field scam → Inferno").
  - **Cross-domain veto kept, made non-fatal.** The title-based domain check (good intent) was reworked from an 80% penalty + early-exit into a bounded ×0.4 fit *damp* with word-boundary matching (so "Salesforce"/"Sales Engineer" aren't false-flagged) and **no short-circuit**.
  - **Additive slider regression reverted.** `app.js` low-volume slicing had been changed back to `<= strategy_tier` (additive — Diagnostic 3) with a hardcoded `30`. Restored to config-driven `LOW_VOLUME_THRESHOLD`: high-volume = exclusive `=== dial`; low-volume = **whole bucket, no tier filter** (never additive, never blank). Re-verified in browser: Strike 10/10/10 across the dial; a 1-job Safety bucket shows at every position incl. Survival.
  - Kept the `Math.max(keywords.length, 5)` overlap anchor (a sound anti-inflation guard) and title-only seniority (already correct).

- **Logical / math bug fixes (audit)**:
  - **`transformers-engine.js` (CRITICAL for opt-in AI)**: `init()`'s 30s timeout was never cleared, so it fired *after a successful init* and flipped `degraded = true`, silently killing semantic matching mid-session. Now cleared on settle; init errors degrade gracefully. `_send()` timers are likewise cleared.
  - **`setup-wizard.js`**: warm-up posted to `window.semanticWorker`, which never existed (the worker is owned by `transformersEngine`). Now calls `transformersEngine.init()` — the correct pre-warm path.
  - **`resume-parser.js`**: salary-floor calibration took `min()` over *every* `$` figure in a résumé (budgets, revenue, hourly), so "managed a $250k budget" could become the salary floor. Now only counts amounts in an explicit pay context.
  - **`app.js`**: imported backups are now re-scored with the current engine (were left with stale zones); the ingest-complete message is honest and actionable when 0 jobs return (no more bare "0 added"); the "discarded" stat counts from the distributed cache instead of the pre-distribution array.
  - **`data-portability.js`**: dropped the stale `source_health` table from the export list.

- **June-2026 best-practice / PWA hardening**:
  - **`index.html` + `sw.js`**: pinned Dexie to `4.0.8` (was `dexie@latest` — the SW even forbids `@latest`) and aligned it with the service-worker precache URL; added the missing `themuse-api.js`, `ambiguity-index.js`, `transition-friction.js` to `CORE_ASSETS`; bumped cache to `job-search-v3`. Offline + reproducibility now hold.
  - **`config.js`**: `FETCH_TIMEOUT_MS` 12s → 8s so a fully-blocked sweep stays responsive.
  - *Deferred (noted, not done): Subresource Integrity hashes on CDN `<script>`s — valuable, but a wrong hash bricks load and the exact digests can't be computed safely from here. Recommended as a follow-up. The self-hosted `cors-proxy/worker.js` (advanced-user, self-host territory) was left as-is for the future technical-user phase.*

### Phase 13.6: Dual-Baseline Anchor, Salary Sanity, Dead-Feed Removal & Ingestion Transparency (Opus 4.8)
- **Status**: Completed (validated: Node harness 23/23 + live browser parity on the real résumé)
- **Context**: Live testing with the project owner's actual résumé (a 28-yr sales/ops executive whose most-recent *employed* role was an entry-level retail sales rep) surfaced the platform's single biggest defect: **every real job was routing to the Safety Net and the Moonshot zone was always empty.** Root-caused, fixed, and verified end-to-end in the browser.

- **THE FIX — Dual-baseline seniority anchor (`scoring-coordinator.js`, `resume-parser.js`)**:
  - **Root cause**: zones were routed off `trajectory_recent = jobSeniority − recentSeniority`, and `recentSeniority` collapsed to the **peak** (Director/Founder = 4) because (a) the résumé parser's recent-level detector scanned for the *last* year-token in the document — which in a reverse-chronological résumé lands on an *old* entry — and (b) when unsure it defaulted `recent = peak`. With the anchor pinned at 4, every posting was `jobSen − 4` = lateral-or-negative → Safety Net became a trash can and **Moonshot (which needs `jobSen > anchor`) was mathematically unreachable.**
  - **New math**: introduced an **effective baseline = `floor((peak + recent) / 2)`** (the dual-baseline / seniority-deficit concept from the 2026 hiring-algorithms research). It collapses to a single level for a linear career (`peak == recent`) and depresses toward `recent` when there's a deficit. For the owner (peak 4, recent 1) it yields anchor **2**, producing exactly the intended, honest mapping: **entry retail → Safety, complex-entry / lower-mgmt / Senior AE → Strike, Director/VP → Moonshot.** `distributeAndRank` and `transition-friction` now route off `trajectory_effective`; `trajectory_peak`/`trajectory_recent` are retained for reference.
  - **Robust recent detection**: `resume-parser.js` rewritten. `_detectRecent()` walks date-range anchors top-down (most-recent first), reads only each role's **title window bounded by the previous date anchor** (so a prior role's "Founder/1099/Self-Employed" markers can never bleed in — a real bug the *browser* caught that the Node test missed), and **skips self-employment/founder/1099-contract titles** (a solo-LLC "Founder" is not a Director in a recruiter's eyes). `_detectLevelStrict()` returns 1–4 or `null` (so ambiguous windows are skipped, not silently defaulted). Added entry-tier titles (sales consultant/associate/rep, retail, cashier, etc.). Result on the owner's résumé: **peak 4, recent 1** (was 4/4).
  - **Wizard as authority**: relabeled the dropdowns to **"Peak Career Level"** and **"Realistic Current Level"** with helper text explaining the latter anchors the zones (set it below peak after a gap/pivot/step-down). The wizard stamps `calibrationVersion` so the one-time migration never clobbers a user's manual choice.
  - **Zero-touch migration (`app.js`)**: `ensureCalibration()` re-derives peak/recent from a stored résumé once (versioned) so existing users are fixed on next load without re-running setup. Dexie bumped to **v5** to force a re-score onto the corrected engine.

- **Salary sanitization (`scoring-coordinator.js`, `config.js`)** — fixes the garbage seen live (`$312k–$52k`, `$5k–$20k`, `$3k–$10k`):
  - Rewrote `parseSalary` with **per-number `k` capture** (a lone "k" no longer multiplies the *other* number) and routed every path (parser + feed-supplied Remotive/Muse values) through one `_sanitizeSalary()` guard: swaps reversed ranges (`$312k–$52k` → `$52k–$312k`), rejects sub-`$18k` ceilings and sub-`$7k` floors (hourly-misreads / foreign currency), and rejects absurd (>25×) spreads → shows an honest "Salary N/A" instead of misleading numbers that also skewed the pay component of Core Score. Added `SALARY_MIN_PLAUSIBLE_ANNUAL`.

- **Dead Indeed RSS feed removed from the default sweep (`config.js`, `app.js`)**: Indeed discontinued its public RSS years ago; the endpoint only ever returned an HTML/error page (never job XML) and is CORS/WAF-blocked on every proxy. It spammed ~200 red console errors per sweep and cost ~16 s. Now gated behind `ENABLE_INDEED_RSS` (default **false**) for a future technical-user phase with a working private proxy. The sweep now honestly relies on Remotive + The Muse + ATS watchlists.

- **Ingestion transparency (`app.js`)** — answers "where did the 210 duplicates go?": the sweep now tallies **raw per source**, prints a `console.table` breakdown + a collapsible group, persists a full `lastSweepReport` to `localStorage`, and the completion alert lists per-source raw counts and explains that duplicates are the *same* listing returned by multiple search terms/sources (Remotive returns its recent global pool per query), collapsed on a company+title+location hash. The "N duplicates" number is no longer a black box.

- **Config/SW**: `VERSION` → `13.6.0`; `CACHE_NAME` → `job-search-v4`.
- **Validation**: Node harness (23 assertions) covers calibration (peak 4 / recent 1 / effective 2), salary sanitization (6 cases), full zone routing on the real persona, and the retained invariants (off-field scam → Inferno, pure-starvation never blanks the screen, Inferno hard-capped at 40%). Re-verified live in-browser against the owner's résumé: Director → Moonshot, Senior AE → Strike, entry SDR → Safety, scam → Inferno, `$312k–$52k` → coherent `$52k–$312k`. **Browser-verification lesson**: the service worker's cache-first strategy served stale JS after edits; a `CACHE_NAME` bump (and, during dev, clearing caches + unregistering the SW) is required to see changes — returning users may need a second reload after an update.

### Phase 13.7: Domain-Competency Delta-X Gate — the "AI buzzword ≠ software engineer" fix (Opus 4.8)
- **Status**: Completed (validated: Node harness 40/40 + live browser + Dexie parity on the real résumé)
- **Context**: After 13.6 fixed the seniority (Delta-Y) axis, live testing exposed that the **fit (Delta-X) axis** was still catastrophically wrong for a non-linear candidate. The owner (a sales/ops exec with a *hobby* AI-evaluation background and, by his own account, **no professional coding skills**) saw senior engineering roles — Offensive Security Engineer, Quality Engineer, C++ Engineer, DB2 Programmer, ML Test Engineer, Data Scientist — scoring **80–100% "fit"** and filling the Safety Net, plus niche roles (steam-turbine Parts Sales Manager, Water infrastructure Specialist, an 8-yr/Figma/Mixpanel Product Manager) landing in the Strike Zone. Root cause: `skill-matcher`'s Delta-X is a **flat, symmetric bag-of-words overlap** with no concept of *domain* — the résumé's AI/systems buzzwords ("systems", "AI", "red team", "pipeline", "architecture") collide with engineering JD vocabulary. Informed by the two research docs (esp. `2026_recruiter_perception_of_non-linear_careers.md`, a per-résumé recruiter analysis confirming the owner's true domains are Sales / RevOps / Operations / no-code automation / AI-evaluation — explicitly **not** software/data/hardware engineering).

- **THE FIX — `competency-profiler.js` (NEW module)**:
  - Classifies BOTH the résumé and each job into ~15 weighted competency **domains** (sales, operations, automation_nocode, software_eng, data_ml, product, marketing, finance_acct, design, hr_recruiting, customer_support, ai_eval, industrial_eng, security, clinical_health) using **concrete, discriminative** skill terms only — named tools, languages, certs (`salesforce`, `python`, `pytorch`, `figma`, `steam turbine`, `\bcpa\b`, `\brn\b`). Generic buzzwords ("system", "data", "AI", "pipeline", "automation") are **deliberately excluded**, and collision-prone terms are assigned to a single domain (`red team` → security only; `coding` is **not** software_eng — the owner's "AI-assisted coding" is not professional SWE).
  - `profileResume()` → per-domain **affinity** ∈ [0,1] (the candidate's competency *shape*). The owner profiles as **sales 1.0, operations 1.0, ai_eval 1.0**, and **software_eng / data_ml / product / industrial / clinical / security = 0.00**.
  - `compatMultiplier(affinity, job)` damps Delta-X by domain compatibility: `compat = Σ_d jobDomainDist[d]·affinity[d]`, `mult = 0.12 + 0.88·compat`, with a hard cap (`≤0.25`) when the job's **primary** domain is one the candidate barely touches (affinity < 0.2). No résumé signal or no job signal → multiplier 1 (never gate blindly → never blanks the screen).
  - Wired into `scoring-coordinator.js` `scoreAndClassifyJob` (replacing the weak title-only cross-domain veto, kept as a no-résumé fallback). Non-fatal — every posting still gets full toxicity/Core/trajectory math; `distributeAndRank` still owns zoning.
  - The résumé domain affinity is computed in `resume-parser.js` `calibrateFromText` and persisted (wizard + `saveResumeText` + the `ensureCalibration` migration, now `CALIBRATION_VERSION = 3`). The **search categories** the user ticks no longer influence fit — the résumé is the ground truth for "what am I?".
- **Result (verified through real Dexie storage)**: all 10 out-of-domain problem roles → **crushed to `noise` (off the board)** at fit 0.00–0.02 (SWE, security, data-sci, product, water/industrial, AP clerk, etc.); the board is repopulated with genuine matches — **Head of Sales → Moonshot, Revenue Operations Manager → Strike, Senior Account Executive → Safety** (RevOps is the #1 "optimal role" from the recruiter doc). Every prior 13.4/13.5/13.6 invariant still holds (23 original + 17 new = 40 assertions).
- **Config/SW/DB**: `VERSION` → `13.7.0`; `CACHE_NAME` → `job-search-v5`; `competency-profiler.js` added to `index.html` + SW precache; Dexie **v6** forces a re-score so existing listings re-route through the domain gate.

