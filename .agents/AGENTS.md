# Coding Agent Instructions (summary)

This project is a **browser-native static PWA** (no backend/Python/build step). `pb_public/` is the static web root. See the full guide in [`../AGENTS.md`](../AGENTS.md).

## Must-follow constraints
1. **Docs:** update `PROJECT_PROGRESS.md` and `README.md` with every meaningful change. Never document features that aren't wired in.
2. **Modules:** each `js/**` file is an IIFE exposing one `window.*` object; no global helpers.
3. **Performance:** pre-compile regexes at module scope; heavy AI work goes to `semantic-worker.js`; the dashboard filters an in-memory cache (`allJobsCache`), reading IndexedDB once per data change.
4. **Error handling:** wrap all network/IndexedDB/parse ops in `try/catch`; one bad item must never halt a sweep.
5. **Security:** render untrusted text via `escapeHtml()` / `renderMarkdownSafe()` (marked → DOMPurify); validate URLs with `safeUrl()` (http/https only); CSV via `csvCell()`. No secrets in the repo.
6. **UI/modals:** `overscroll-behavior: contain`, internal `overflow-y: auto`, `.no-scroll` body lock while open.

## Scoring (keep faithful)
Two candidate-relative axes — **Delta-X** (résumé fit) and **Delta-Y** (seniority trajectory) — route each job into **Strike / Moonshot / Safety / Inferno** (+ hidden `noise`). The **Strategy Dial** reshapes thresholds. **Core Score** = 55% fit + 25% pay + 20% culture. Toxicity (`evaluator.js`) is additive/weighted and calibrated so **Inferno stays a minority** — a single cliché never triggers it. Validate zone/toxicity distributions when tuning.
