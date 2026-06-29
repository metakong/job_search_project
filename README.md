# 🎯 Job Search Intelligence Platform

> **A free, browser-native PWA that automates job discovery, scoring, and tracking — built for job-seekers, by job-seekers.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![GitHub](https://img.shields.io/badge/GitHub-metakong%2Fjob__search__project-181717?logo=github)](https://github.com/metakong/job_search_project)
[![PWA Ready](https://img.shields.io/badge/PWA-Ready-5A0FC8?logo=pwa)](https://web.dev/progressive-web-apps/)

---

## What Is This?

This is a **completely free, open-source job search automation platform** that runs entirely in your web browser. No Python. No servers. No accounts. No tracking. Just open it and start finding jobs.

It scrapes job boards (Indeed RSS, Remotive API, ATS direct feeds), scores every listing against your skills and preferences, flags toxic workplaces, and presents everything in a premium intelligence dashboard — all from a single HTML page running on your machine.

**Built for the 2026 job market**, this project exists because proprietary job platforms serve employers, not candidates. This platform serves *you*.

---

## ✨ Key Features

| Feature | Description |
|---|---|
| **Zero Setup** | No Python, no Node.js, no databases. Open in browser → follow wizard → done. |
| **Offline-Capable PWA** | Install as a desktop/mobile app. Works offline after first load. |
| **Probabilistic Labor Matrix** | Real-time risk/reward zone classification (Strike Zone, Moonshot, Safety Net, Dante's Inferno) using relative Delta-X/Y vector math. |
| **Job Hunt Strategy Dial** | 3-step slider control (Survival, Balanced, Aggressive Growth) that dynamically recalibrates threshold calculations in real-time. |
| **Dante's Inferno Satire Crimson Theme** | Seamless transition of backgrounds, borders, and glows to a deep crimson theme when viewing toxic listings. |
| **9 Circles Classifier** | Toxic listings are parsed and banish-mapped to the 9 Circles of Hell (Limbo, Lust, Gluttony, Greed, Anger, Heresy, Violence, Fraud, Treachery) with Warning Banners. |
| **Ghost Job Detection** | Flags stale, vague, salary-free listings likely posted to farm resumes. |
| **Resume ATS Scoring** | Upload your PDF resume. The app extracts keywords and scores alignment, calibrating seniority levels (1-4) and salary floor baselines. |
| **Company Blacklist** | One-click blacklist with fuzzy matching (Fuse.js). Never see that company again. |
| **Data Portability** | Full JSON export/import of your database. Your data stays yours. 30-day backup reminders included. |

---

## 🚀 Quick Start (2 Minutes)

### Option A: Local File Server (Recommended)

You need **any** local HTTP server. The simplest option:

```bash
# Clone the repository
git clone https://github.com/metakong/job_search_project.git
cd job_search_project

# Serve the app (Python 3 is pre-installed on most systems)
python -m http.server 8090 --directory pb_public
```

Then open **[http://127.0.0.1:8090/](http://127.0.0.1:8090/)** in your browser. That's it.

> **Don't have Python?** Use any static file server:
> - `npx serve pb_public -p 8090`
> - VS Code "Live Server" extension
> - Any web server pointed at the `pb_public/` folder

### Option B: Deploy to Static Hosting

This is a fully static site. Deploy `pb_public/` to any of these (all free tiers):

- **GitHub Pages** — Push the `pb_public` folder
- **Vercel** — `vercel --cwd pb_public`
- **Netlify** — Drag-and-drop `pb_public`
- **Cloudflare Pages** — Connect your repo

### First Launch

1. The **Setup Wizard** appears automatically on first run
2. Set your **target location** and **search radius** (default: Springfield, MO / 30mi)
3. Select your **role categories** (Sales, Operations, Tech/AI)
4. Optionally upload your **resume PDF** for ATS scoring
5. Click **"Complete Setup & Run Ingestion"** — the app scrapes, scores, and displays results

> **API keys are optional.** The advanced settings panel is collapsed by default. The app works perfectly without any API keys.

---

## 🎯 Supported Job Categories

The platform maps role categories to high-signal boolean search queries:

| Category | Search Query |
|---|---|
| **Sales & Business Development** | `"Business Development" OR "Revenue Operations" OR "Sales Director" OR "Consultative Sales"` |
| **Operations & Process Improvement** | `"Operations Manager" OR "Process Improvement" OR "Turnaround" OR "Strategy"` |
| **Tech & AI** | `"AI Evaluator" OR "Systems Architecture" OR "Data Operations"` |

These queries are customizable via the Setup Wizard or by editing `js/config.js`.

---

## 🏗️ Architecture Overview

```
┌──────────────────────────────────────────────┐
│             BROWSER EXTRACTORS               │
│  ──────────────────────────────────────────  │
│  - Indeed RSS (rss-adapter.js)               │  ◄── RSS feed ingestion
│  - Remotive API (remotive-api.js)            │  ◄── Remote job categories
│  - ATS Direct (Greenhouse, Lever)            │  ◄── Company watchlist polling
│  - Sitemap Parser (sitemap-parser.js)        │  ◄── XML sitemap crawling
└──────────────────────┬───────────────────────┘
                       │
                       ▼ Raw job payloads
┌──────────────────────────────────────────────┐
│          SCORING & CLASSIFICATION            │
│  ──────────────────────────────────────────  │
│  - Kill Switch Evaluator (evaluator.js)      │  ◄── Hard exclusion filters
│  - Culture Evaluator (culture-evaluator.js)  │  ◄── Toxicity red-flag detection
│  - Skill Matcher (skill-matcher.js)          │  ◄── Set-based keyword overlap
│  - Industry Classifier (industry-classifier) │  ◄── First-match-wins tagger
│  - Scoring Coordinator (scoring-coordinator) │  ◄── Pipeline orchestrator
│  - Resume Parser (resume-parser.js)          │  ◄── PDF.js client-side extraction
└──────────────────────┬───────────────────────┘
                       │
                       ▼ Scored, classified listings
┌──────────────────────────────────────────────┐
│              DEXIE.JS INDEXEDDB              │
│  ──────────────────────────────────────────  │
│  - Local Database (local-db.js)              │  ◄── Client-side persistence
│  - DB Adapter (db-adapter.js)                │  ◄── CRUD & paginated queries
│  - Data Portability (data-portability.js)    │  ◄── JSON backup/restore
└──────────────────────┬───────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────┐
│        INTELLIGENCE DASHBOARD (PWA)          │
│  ──────────────────────────────────────────  │
│  - Multi-filter controls & tier sorting      │
│  - 8-badge pill system per card              │
│  - Pipeline transparency (raw/discarded)     │
│  - Ghost job warnings                        │
│  - Company blacklist (Fuse.js fuzzy)         │
│  - CSV export & JSON data portability        │
│  - Service Worker for offline capability     │
└──────────────────────────────────────────────┘
```

All processing happens **in your browser**. No data leaves your machine unless you configure an optional CORS proxy for cross-origin RSS fetching.

---

## 🔧 CORS Proxy Setup

Job board RSS feeds require a CORS proxy to fetch from the browser. The app defaults to `corsproxy.io`, but you can deploy your own Cloudflare Worker for reliability:

1. See [`cors-proxy/README.md`](cors-proxy/README.md) for the Cloudflare Worker setup
2. Enter your custom proxy URL in the Setup Wizard's **Advanced Settings**

---

## 📂 Project Structure

```
pb_public/                    # ← Serve this directory
├── index.html                # Dashboard entry point
├── app.js                    # Core UI logic & event handling
├── style.css                 # Premium dark theme styles
├── manifest.json             # PWA manifest
├── sw.js                     # Service Worker (offline caching)
└── js/
    ├── config.js             # Global configuration & defaults
    ├── utils/fetch.js        # CORS-aware fetch wrapper
    ├── storage/
    │   ├── local-db.js       # Dexie.js schema & migrations
    │   ├── db-adapter.js     # Query adapter layer
    │   └── data-portability.js
    ├── extractors/
    │   ├── rss-adapter.js    # Indeed RSS feed parser
    │   ├── remotive-api.js   # Remotive REST client
    │   └── sitemap-parser.js # XML sitemap crawler
    ├── scoring/
    │   ├── evaluator.js      # Kill switch exclusion engine
    │   ├── scoring-coordinator.js
    │   ├── skill-matcher.js
    │   ├── culture-evaluator.js
    │   └── industry-classifier.js
    ├── ai/
    │   ├── byok-router.js    # Multi-provider AI router
    │   ├── resume-parser.js  # PDF.js text extraction
    │   └── transformers-engine.js
    └── features/
        └── setup-wizard.js   # First-run onboarding wizard
```

---

## 🤝 Contributing

This project is a gift to the open-source community and to every job-seeker navigating the 2026 labor market. Contributions are welcome:

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/your-feature`)
3. **Commit** changes with clear messages
4. **Open** a pull request

Please read [AGENTS.md](AGENTS.md) for coding constraints and documentation requirements before contributing.

---

## 🗺️ Roadmap

- [ ] Cross-platform mobile companion (React Native / Capacitor)
- [ ] LinkedIn direct integration via browser extension
- [ ] Collaborative job sharing between users
- [ ] AI-powered cover letter generation (BYOK)
- [ ] Multi-language support

---

## 📚 Documentation

- **Progress Tracking**: [PROJECT_PROGRESS.md](PROJECT_PROGRESS.md)
- **Agent Guidelines**: [AGENTS.md](AGENTS.md)
- **CORS Proxy Setup**: [cors-proxy/README.md](cors-proxy/README.md)

---

## 📜 License

This project is open-source. Built with ❤️ for job-seekers everywhere.
