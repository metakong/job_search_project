# 🎯 Job Search Intelligence Platform

> **A free, browser-native PWA that discovers, scores, and tracks jobs — built for job-seekers, by job-seekers. Your search, your way, your data.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![PWA Ready](https://img.shields.io/badge/PWA-Ready-5A0FC8?logo=pwa)](https://web.dev/progressive-web-apps/)

---

## What Is This?

A **completely free, open-source job search platform** that runs entirely in your web browser. No accounts. No servers of ours. No tracking. It scrapes public job feeds, scores every listing **against your own résumé**, flags psychologically hazardous postings, and sorts everything into clear risk/reward zones — all on your machine, in IndexedDB.

Proprietary job platforms optimize for employers. This one optimizes for **you, the candidate**: you get granular control over the search, transparent scoring you can inspect, and your data never leaves your device (except cross-origin fetches, which route through a CORS proxy you can control — see [Privacy](#-privacy)).

---

## 🧭 The Core Idea: Two Axes, Four Zones

Every job is placed on two **candidate-relative** axes:

- **Delta-X — Fit (0–1):** how well the job matches *your résumé* (keyword overlap, supplementary skills, and optional AI semantic similarity).
- **Delta-Y — Trajectory (steps):** the job's seniority minus your current level.

From those, each job lands in one zone:

| Zone | Meaning |
|---|---|
| 🎯 **Strike Zone** | Average risk/reward. Well-aligned, roughly lateral — the roles you're a strong, natural fit for. |
| 🚀 **Moonshots** | High risk/reward. A reach *up* you're only partly qualified for. |
| 🛡️ **Safety Net** | Low risk/reward. A step *down* in your field — the fallback you'd take in a tough market. |
| 🔥 **Dante's Inferno** | Psychologically hazardous postings (scams, exploitation, toxic culture). A calibrated *minority*, never the default pile. |

### The Job Hunt Strategy Dial

A 3-step dial reshapes your feed using an exclusive tiering system based on Transition Friction, allowing you to focus purely on the jobs that match your risk appetite:

- **Survival** — Reveals jobs with the lowest transition friction (most aligned, easiest to secure).
- **Balanced** — The default. Reveals a balanced slice of the market.
- **Aggressive** — Reveals jobs with higher transition friction (reaches, pivots, and stretch roles).

Changing the dial instantly filters your feed to reveal ONLY that distinct subset of jobs, without requiring a full database re-score.

---

## ✨ Key Features

| Feature | Description |
|---|---|
| **Zero Setup** | No Python, no Node, no database to run. Open in a browser → follow the wizard → done. |
| **Offline-Capable PWA** | Installable; works offline after first load. |
| **Résumé-Driven Matching** | Upload your PDF résumé (parsed locally, never uploaded). It defines your fit profile and auto-calibrates your seniority and salary floor. |
| **Calibrated Toxicity Detection** | Additive, weighted red-flag scoring grounded in real-world hiring-scam and exploitation research. Genuinely toxic posts get mapped to the 9 Circles of Hell; a single cliché never sends a job there. |
| **Ghost Job Detection** | Flags stale, salary-free, perpetual-pipeline listings likely posted to farm résumés. |
| **Culture Score** | Rewards green flags — pay transparency above all — and penalizes yellow flags. |
| **Granular Filtering** | Zone, application status, location type, industry, salary range, recency window, full-text search, saveable filter profiles. |
| **Company Blacklist** | One-click blacklist with fuzzy matching (Fuse.js). Never see that company again. |
| **Optional AI Semantic Matching** | Opt-in local embedding model (Transformers.js) for deeper résumé↔job similarity. Off by default; keyword matching otherwise. |
| **Dynamic Probabilistic Scoring** | Shannon entropy (Ambiguity Index) and transition friction probabilistic models accurately evaluate non-linear careers and missing data without rigid ceilings. |
| **Data Portability** | Full JSON export/import. Your data is yours. 30-day backup reminders. |

---

## 🚀 Quick Start

This is a static site — serve the `pb_public/` directory with any HTTP server:

```bash
git clone <your-repo-url>
cd job_search_project
python -m http.server 8090 --directory pb_public
```

Open **http://127.0.0.1:8090/**. (No Python? `npx serve pb_public -p 8090`, or VS Code Live Server, or any static host.)

### First Launch
1. The **Setup Wizard** appears automatically.
2. Set your **location**, **radius**, **minimum salary**, and **current level**.
3. Enter your **target roles / search terms** (this drives the search) and/or pick quick presets.
4. Upload your **résumé PDF** (strongly recommended — it tailors every match to you).
5. Click **Complete Setup & Run Ingestion**.

### Deploy (static hosting)
Deploy `pb_public/` to GitHub Pages, Vercel, Netlify, or Cloudflare Pages (all free tiers).

---

## 🔒 Privacy

All processing and storage happen **in your browser** (IndexedDB). Two honest caveats:

1. **Cross-origin fetches need a CORS proxy.** By default the app uses a public proxy (`corsproxy.io`), which means job-board requests pass through a third party. For full privacy, deploy your own Cloudflare Worker (see [`cors-proxy/README.md`](cors-proxy/README.md)) and paste its URL in **Advanced Settings**.
2. **Optional AI matching** downloads a model from a CDN on first use (only if you enable it).

Nothing else — your résumé, your scores, your tracked applications — ever leaves your device.

---

## 🏗️ Architecture

```
┌───────────────────────────────────────────────┐
│  EXTRACTORS (browser, via CORS proxy)          │
│  rss-adapter · remotive-api · sitemap-parser   │
│  + Greenhouse/Lever ATS watchlists             │
└───────────────────────┬───────────────────────┘
                        ▼  raw listings
┌───────────────────────────────────────────────┐
│  SCORING PIPELINE (scoring-coordinator.js)     │
│  • ambiguity-index  → data entropy/confidence  │
│  • transition-friction → career pivot logic    │
│  • skill-matcher    → résumé-driven Fit (Δx)   │
│  • evaluator        → calibrated toxicity / 9 Circles │
│  • culture-evaluator→ culture vector           │
│  • industry-classifier → industry tag          │
│  • (optional) transformers-engine → semantic Δx│
│  → Core Score, zones, ghost/stale/dupe flags   │
└───────────────────────┬───────────────────────┘
                        ▼  scored & zoned
┌───────────────────────────────────────────────┐
│  Dexie.js / IndexedDB (local-db, db-adapter)   │
│  in-memory cache → filter · sort · paginate    │
└───────────────────────┬───────────────────────┘
                        ▼
┌───────────────────────────────────────────────┐
│  DASHBOARD (index.html · app.js · style.css)   │
│  zones · filters · cards · modal · CSV/JSON · SW│
└───────────────────────────────────────────────┘
```

### Project Structure
```
pb_public/                 # ← Serve this directory (static web root)
├── index.html  app.js  style.css  manifest.json  sw.js  icon.svg
└── js/
    ├── config.js
    ├── utils/fetch.js                 # CORS-aware fetch + SHA-256 hashing
    ├── storage/                       # local-db, db-adapter, data-portability
    ├── extractors/                    # rss-adapter, remotive-api, sitemap-parser
    ├── ai/                            # resume-parser, transformers-engine (opt-in)
    ├── workers/semantic-worker.js     # embedding worker (opt-in)
    ├── scoring/                       # evaluator, skill-matcher, culture-evaluator,
    │                                  #   industry-classifier, scoring-coordinator
    └── features/setup-wizard.js
```

---

## 🤝 Contributing

Contributions welcome. Please read [AGENTS.md](AGENTS.md) for the architecture and coding constraints first. The scoring engine has a Node-runnable simulation harness; keep Inferno a calibrated minority and keep the zones faithful to their definitions.

## 🗺️ Roadmap
- [ ] AI cover-letter & résumé-tailoring assistant (bring-your-own-key)
- [ ] More ingestion sources & first-class sitemap/careers-page watchlists
- [ ] Cross-platform mobile companion
- [ ] Multi-language support

## 📜 License
MIT. Built with ❤️ for job-seekers everywhere.
