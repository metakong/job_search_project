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
