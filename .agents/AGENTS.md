# Coding Agent Instructions & Documentation Guidelines

Welcome, Coding Agent! To maintain repository integrity and clear development tracking, you must adhere to the following rules during all project modifications.

---

## Documentation Synchronization Rules

Whenever you introduce a new feature, update an existing database schema, modify a script, or optimize an ETL phase, you **MUST** update the following documentation files before completing your task:

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
