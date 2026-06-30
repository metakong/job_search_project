# Coding Agent Instructions & Architecture Constitution

Welcome, Coding Agent. You are contributing to the **Job Search Intelligence Platform**, a 100% browser-native static Progressive Web App (PWA). All logic runs client-side; all data lives in IndexedDB (Dexie). There is no backend, no build step, and no database server.

## 🌟 THE NORTH STAR (PROJECT END GOAL)
This tool is built **for the candidate, by the candidate**. It discovers, scores, and tracks jobs using brutally honest, highly accurate, and mathematically sound logic. 
You must operate within a **Dual-Phase Plan**:
*   **Phase 1 (Current Strict Focus):** Achieve absolute production-readiness for **non-technical users**. The platform must be instantly usable, bulletproof against bad data, resilient to hostile networks, and yield flawlessly accurate job routing.
*   **Phase 2 (Future Roadmap):** Integrate advanced tools for technically proficient users (e.g., BYOK LLM API integrations, custom Cloudflare worker proxies). *Build the Phase 1 architecture to accommodate this, but do not prioritize Phase 2 bloat over Phase 1 stability.*

**Agent Freedom Clause:** You possess the autonomy to optimize regex patterns, refactor asynchronous pipelines, and enhance UI rendering loops, **PROVIDED** your implementations strictly adhere to the mathematical guardrails, routing laws, and zero-bloat constraints defined below.

---

## ⚖️ THE IMMUTABLE LAWS OF MATHEMATICS & ROUTING

You must never use arbitrary distribution (e.g., "top 33% percentile") to determine a job's fitness. Categorization is absolute and deterministic, governed by two axes: **Delta-X (Fit)** and **Delta-Y (Trajectory)**.

### Law 1: Delta-X (The Fit Score) & The Noise Floor
Delta-X measures the candidate's technical and operational overlap with the job.
*   **The Minimum Denominator Rule:** To prevent the "100% Fit Paradox" on sparse job descriptions, all ratio-based overlap math MUST enforce a statistical floor. Example: `matches / Math.max(required_skills_count, 5)`. A job with only 1 required generic skill cannot mathematically exceed a 20% fit.
*   **The Absolute Noise Floor:** The relevance floor is tied **STRICTLY TO DELTA-X**, not the blended Core Score. Any job with a `Delta-X < 0.25` (25%) is definitively irrelevant. It must be classified as `zone: 'noise'` and hidden from the UI entirely.

### Law 2: Delta-Y (The Trajectory) & Anti-Hallucination
Delta-Y measures the step-up or step-down in seniority (`Job Seniority - Candidate Baseline`).
*   **Title-Strict Parsing:** Seniority extraction algorithms (e.g., `_detectSeniority`) MUST be restricted exclusively to the `job.title` string. **DO NOT** scan the `description_full` string for seniority keywords, as this causes reporting-structure hallucinations (e.g., "reports to the Director" flagging an Entry role as a Director).
*   **Implicit Mapping:** Hardcode mappings for implicit titles (e.g., "Architect" = Level 3/4, "Clerk" = Level 1).

### Law 3: Strict Zone Routing Logic
The zones are honest reflections of a user's career reality. You must route jobs based on the following exact logic:
*   🎯 **Strike Zone (Lateral):** `Delta-Y === 0` AND `Delta-X > Moderate/High Threshold`
*   🚀 **Moonshot (Reach Up):** `Delta-Y > 0` AND `Delta-X > Moderate Threshold`
*   🛡️ **Safety Net (Step Down):** `Delta-Y < 0` AND `Delta-X > High Threshold`. *CRITICAL: The Safety Net is a high-fit fallback. It is NOT a trash can for irrelevant jobs or 0% matches.*
*   🔥 **Dante's Inferno:** `Toxicity Score >= 50` (or dynamically capped at worst 40% of pool). This overrides all other `Delta-Y` routing.

---

## 🖥️ UI/UX & STATE MANAGEMENT CONSTRAINTS

1.  **The Strategy Dial (Volume-Aware Slicing):**
    *   The Strategy Dial (Survival / Balanced / Aggressive) filters jobs by `transition_friction`.
    *   **High-Volume Mode (> 50 jobs):** Use **Exclusive** slicing (`tier === dialValue`). Show exactly 1/3 of the bucket per dial notch.
    *   **Low-Volume Mode (< 50 jobs):** Use **Additive/Bypass** slicing (`tier <= dialValue` or disable slicing). You must never allow exclusive slicing to result in a "Zero Results" screen due to data starvation.
    *   **Inferno Mode:** The dial must be disabled, dimmed, and its label overridden (e.g., "N/A - Hazard View") when the user is in Dante's Inferno.
2.  **Targeted DOM Mutations:** Avoid `innerHTML = ''` nukes. When updating states (like saving an Application Status), query and mutate the specific job card's DOM node directly.
3.  **Modal Lock:** Modals must use `overscroll-behavior: contain`, internal `overflow-y: auto`, and append a strict `.no-scroll` class to the body.

---

## 🌐 NETWORK & INGESTION PIPELINE RULES

The browser environment is hostile. Cross-Origin Resource Sharing (CORS) proxies will fail, Web Application Firewalls (WAFs) will block you, and APIs will return garbage.
1.  **Zero-Trust Parsing:** NEVER blindly pass a network response into `DOMParser` or `JSON.parse()`.
    *   For XML/RSS: You must inspect the text (`payload.trim().startsWith('<')`) to ensure you have not intercepted an HTML CAPTCHA challenge page before parsing.
2.  **Graceful Network Degradation:** If a target (e.g., Indeed) blocks a CORS proxy and returns a 403 Forbidden, catch the error, log a clean console warning, and return `[]`. An unreachable endpoint must NEVER trigger an unhandled promise rejection that crashes the Service Worker or ingestion loop.
3.  **Data Sourcing Strategy:** Prioritize aggregator endpoints with lenient, public-friendly APIs (e.g., Remotive, The Muse). Phase 2 will introduce BYOK (Bring Your Own Key) commercial scrapers.

---

## 🔒 SECURITY & CODE HYGIENE

1.  **Module Isolation:** Each `js/**` file wraps its logic in an IIFE and exposes a single object on `window` (e.g., `window.scoringCoordinator`).
2.  **XSS Protection:** Untrusted text (job descriptions) rendered to the DOM MUST pass through `DOMPurify` (or equivalent markdown sanitizer).
3.  **Async Chunking:** Heavy database writes to Dexie must be chunked (e.g., batches of 25) to prevent main-thread UI freezing. Heavy math (Semantic Embeddings) belongs in `semantic-worker.js`.

---

## 📝 DOCUMENTATION SYNCHRONIZATION

When you execute a refactor, fix a bug, or add a feature, you **MUST** update:
1.  **`PROJECT_PROGRESS.md`**: Append a clear, concise log of what was changed and why.
2.  **`README.md`**: Ensure the architecture diagram, UI descriptions, and feature lists match the literal reality of the codebase. Do not advertise features that are theoretically planned but not yet wired in.