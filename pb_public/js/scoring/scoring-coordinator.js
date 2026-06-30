// =====================================================================
// Scoring Coordinator & Pipeline Orchestrator — scoring-coordinator.js
// =====================================================================
// Places every job on two candidate-relative axes and routes it into one of
// four zones (plus the toxic Inferno override and a hidden "noise" floor):
//
//   • Delta-X  (FIT, 0..1)   — how well the job matches the candidate, driven
//                              primarily by the candidate's own résumé.
//   • Delta-Y  (TRAJECTORY)  — jobSeniority − candidateSeniority (integer steps).
//
//   ZONES (definitions, faithful to project intent):
//     STRIKE   — average risk/reward; well-aligned, roughly lateral move.
//     MOONSHOT — high risk/reward; a reach UP you're only partly qualified for.
//     SAFETY   — low risk/reward; a step DOWN you'd take in a tough market.
//     INFERNO  — psychologically hazardous (toxicity override; a calibrated minority).
//     noise    — genuinely irrelevant (below the relevance floor); hidden by default.
//
//   The Strategy Dial (1 Survival · 2 Balanced · 3 Aggressive) reshapes the
//   thresholds: Survival widens the net and embraces step-downs; Aggressive
//   demands high fit, pushes upward reaches into Moonshot, and hides mediocrity.
//
// Core Score (0..100) is a transparent blend: 55% fit, 25% pay-vs-floor,
// 20% culture. No hidden constants.
// =====================================================================

(function () {
    'use strict';

    // ── Boilerplate scrub patterns ───────────────────────────────────
    const TRUNCATION_PHRASES = [
        "equal opportunity employer", "affirmative action", "protected veteran status",
        "\\bdisabilit(y|ies)\\b", "race, color, religion, sex",
        "applicants will receive consideration"
    ];
    const TRUNCATE_PATTERN = new RegExp(TRUNCATION_PHRASES.join('|'), 'i');
    const HTML_TAG_RE   = /<[^>]*>/g;
    const WHITESPACE_RE = /\s+/g;
    const BODY_RE       = /<body[^>]*>([\s\S]*?)<\/body>/i;

    // ── Core Score weights (sum to 1.0) ──────────────────────────────
    const W_FIT = 0.55, W_PAY = 0.25, W_CULTURE = 0.20;

    // ── Seniority ladder ─────────────────────────────────────────────
    const SENIORITY_MAP = { director: 4, manager: 3, senior: 2, entry: 1, unspecified: 2 };

    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

    // ── Zone thresholds per Strategy Dial setting ────────────────────
    // floor: relevance floor below which an off-target job is hidden as noise.
    // strikeFit: fit bar for a well-aligned lateral ("on target").
    function thresholds(strategy) {
        if (strategy === 1) return { floor: 0.10, strikeFit: 0.45 }; // Survival
        if (strategy === 3) return { floor: 0.20, strikeFit: 0.50 }; // Aggressive
        return { floor: 0.15, strikeFit: 0.55 };                     // Balanced
    }

    // Pure zone classifier (Inferno/blacklist handled by the caller). Zones are
    // trajectory-led (a step UP is a reach → Moonshot; a step DOWN in-field is a
    // fallback → Safety; lateral & relevant → Strike), with fit gating relevance.
    function classifyZone(dx, dy, strategy) {
        const { floor, strikeFit } = thresholds(strategy);

        // Below the relevance floor and not a deliberate upward reach → hide.
        if (dx < floor && dy < 2) return 'noise';

        if (strategy === 3) { // Aggressive — emphasize reaches; keep only strong laterals/step-downs
            if (dy >= 1) return 'moonshot';
            if (dy === 0) return dx >= strikeFit ? 'strike' : 'noise';
            return dx >= 0.65 ? 'safety' : 'noise';
        }

        // Survival (1) & Balanced (2)
        if (dy >= 2) return 'moonshot';                                  // clear reach up
        if (dy === 1) return dx >= strikeFit + 0.15 ? 'strike' : 'moonshot'; // near-promotion vs reach
        if (dy <= -1) return 'safety';                                   // step down in-field (overqualified)
        return 'strike';                                                 // relevant lateral
    }

    const scoringCoordinator = {
        // Expose for tooling/tests.
        SENIORITY_MAP,
        classifyZone,

        // ── Boilerplate scrubbing (for skill matching only) ──────────
        scrubBoilerplate(text) {
            if (!text) return '';
            let clean = text
                .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ');
            const bodyMatch = BODY_RE.exec(clean);
            if (bodyMatch) clean = bodyMatch[1];
            if (clean.length > 40000) clean = clean.substring(0, 40000);
            const t = TRUNCATE_PATTERN.exec(clean);
            if (t) clean = clean.substring(0, t.index);
            return clean.replace(HTML_TAG_RE, ' ').replace(WHITESPACE_RE, ' ').trim();
        },

        // ── Location type ────────────────────────────────────────────
        classifyLocationType(desc, loc) {
            const combined = `${desc} ${loc}`.toLowerCase();
            if (/\bremote\b|work from home|fully distributed|\bwfh\b|100%\s*remote/i.test(combined)) return 'remote';
            if (/\bhybrid\b|days in office|partial remote|flexible location/i.test(combined)) return 'hybrid';
            if (/on.?site|in.?office required|must be local|in person/i.test(combined)) return 'on_site';
            return 'unknown';
        },

        // ── Salary parsing ───────────────────────────────────────────
        parseSalary(desc) {
            const salAnnualRe = /\$\s*([\d,]+)\s*(?:k|K)?\s*(?:–|-|to)\s*\$\s*([\d,]+)\s*(?:k|K)?/i;
            const salHourlyRe = /\$\s*([\d.]+)\s*(?:per\s+hour|\/\s*hr|\/\s*hour|an hour|hourly)/i;
            const salSingleRe = /(?:up\s+to|starting\s+at|from|salary of)\s+\$\s*([\d,]+)\s*(k|K)?/i;
            const parseNum = s => parseFloat(String(s).replace(/,/g, '')) || 0.0;

            let m = salAnnualRe.exec(desc);
            if (m) {
                let lo = parseNum(m[1]), hi = parseNum(m[2]);
                if (m[0].toLowerCase().includes('k')) { if (lo < 1000) lo *= 1000; if (hi < 1000) hi *= 1000; }
                if (lo > 0 || hi > 0) return { min: lo, max: hi, parseable: true };
            }
            m = salHourlyRe.exec(desc);
            if (m) {
                const hourly = parseFloat(m[1]) || 0;
                const annual = Math.round(hourly * 2080);
                if (annual > 0) return { min: annual, max: annual, parseable: true };
            }
            m = salSingleRe.exec(desc);
            if (m) {
                let val = parseNum(m[1]);
                if (m[2] && m[2].toLowerCase() === 'k' && val < 1000) val *= 1000;
                if (val > 0) return { min: val, max: val, parseable: true };
            }
            return { min: 0.0, max: 0.0, parseable: false };
        },

        // ── Recency multiplier / staleness ───────────────────────────
        getRecencyMultiplier(days, locationType) {
            const remoteLike = !(locationType === 'on_site' || locationType === 'hybrid');
            if (days <= 7)  return { mult: 1.0, isStale: false };
            if (days <= 14) return { mult: remoteLike ? 0.80 : 0.85, isStale: false };
            if (days <= 21) return { mult: remoteLike ? 0.55 : 0.75, isStale: false };
            return { mult: remoteLike ? 0.25 : 0.40, isStale: true };
        },

        // ── Seniority detection ──────────────────────────────────────
        detectSeniority(title, desc) {
            const combined = `${title} ${(desc || '').substring(0, 300)}`.toLowerCase();
            if (/\bdirector\b|\bvp\b|vice president|head of|\bchief\b|\bc[etof]o\b/i.test(combined)) return 'director';
            if (/\bmanager\b|\blead\b|\bsupervisor\b|\bprincipal\b/i.test(combined)) return 'manager';
            if (/\bsenior\b|\bsr\.?\b|\bstaff\b/i.test(combined)) return 'senior';
            if (/\bcoordinator\b|\bspecialist\b|\brepresentative\b|\bassociate\b|\bjunior\b|\bjr\.?\b|\bentry\b|\bintern\b/i.test(combined)) return 'entry';
            return 'unspecified';
        },

        // ── Apply type detection ─────────────────────────────────────
        detectApplyType(url, desc) {
            const u = (url || '').toLowerCase();
            if (u.includes('linkedin.com/jobs') || u.includes('indeed.com/viewjob') || /easy\s*apply|quick\s*apply|one.click\s*apply/i.test(desc || '')) return 'easy_apply';
            const ext = ["greenhouse.io", "workday", "lever.co", "taleo.net", "icims.com", "bamboohr.com", "jobvite.com", "smartrecruiters.com", "ashbyhq.com"];
            for (const d of ext) if (u.includes(d)) return 'external_ats';
            return 'unknown';
        },

        // ── Ghost-job detection (conservative; a genuine minority) ────
        // A ghost listing is one likely posted to farm résumés rather than to
        // fill a real, current role: old + no pay + (perpetual-pipeline language
        // OR an unusually thin description).
        detectGhostJob(descFull, scrubbed, days, salaryParseable) {
            if (salaryParseable) return false;
            const perpetual = /always (?:accepting|taking) applications|building a (?:pipeline|pool|bench) of (?:candidates|talent)|for future (?:opportunities|openings|consideration)|we(?:'re| are) always hiring/i.test(descFull);
            if (days >= 30 && perpetual) return true;
            if (days >= 30 && scrubbed.length < 350) return true;   // old + thin + no pay
            if (days >= 60) return true;                            // very stale + no pay
            return false;
        },

        // ── Build candidate keyword profile (résumé first, queries fallback) ──
        buildProfileKeywords(userProfile) {
            const resume = (userProfile && userProfile.resumeText) || '';
            if (resume.trim().length > 50) return window.skillMatcher.extractKeywords(resume, 60);
            const q = (userProfile && userProfile.search_queries) || [];
            const blob = Array.isArray(q) ? q.join(' ') : String(q || '');
            return blob.trim() ? window.skillMatcher.extractKeywords(blob, 40) : [];
        },

        // ── Main pipeline: score + classify a single job ─────────────
        scoreAndClassifyJob(job, userProfile, blacklistNames = [], profileKeywords = null) {
            const descFull = job.description_full || job.description || '';
            const title    = job.title || '';
            const strategy = parseInt((userProfile && userProfile.strategyDial) || 2, 10) || 2;
            if (profileKeywords === null) profileKeywords = this.buildProfileKeywords(userProfile || {});

            // 0. Blacklist → hidden noise.
            const companyClean = (job.company_name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            let isBlacklisted = false;
            for (const name of blacklistNames) {
                const b = String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                if (b && companyClean && (companyClean.includes(b) || b.includes(companyClean))) { isBlacklisted = true; break; }
            }

            // 1. Structured signals.
            const computedLoc = this.classifyLocationType(descFull, job.job_location || '');
            job.location_type = (job.location_type === 'remote') ? 'remote' : computedLoc;

            const sal = (job.salary_parseable && (job.salary_max > 0 || job.salary_min > 0))
                ? { min: job.salary_min || 0, max: job.salary_max || 0, parseable: true }
                : this.parseSalary(descFull);
            job.salary_min = sal.min; job.salary_max = sal.max; job.salary_parseable = sal.parseable;
            const salaryMid = sal.parseable ? (sal.max > 0 && sal.min > 0 ? (sal.min + sal.max) / 2 : (sal.max || sal.min)) : 0;
            job.salary_mid = salaryMid;

            const scrubbed = this.scrubBoilerplate(descFull);
            job.seniority_level = this.detectSeniority(title, descFull);
            job.industry = window.industryClassifier.classify(descFull);
            job.apply_type = this.detectApplyType(job.apply_url, descFull);

            const days = Number.isFinite(job.days_since_posted) ? job.days_since_posted : 0;
            const rec = this.getRecencyMultiplier(days, job.location_type);
            job.recency_multiplier = rec.mult;
            job.is_stale = rec.isStale;
            job.is_ghost_job = this.detectGhostJob(descFull, scrubbed, days, sal.parseable);

            // 2. Fit (Delta-X): résumé-driven overlap + supplementary skills + optional semantics.
            const builtin     = window.skillMatcher.match(scrubbed, title);
            const builtinNorm = Math.min(1, builtin / 12);
            const overlap     = window.skillMatcher.overlapRatio(scrubbed, profileKeywords);
            const sem = (typeof job.semantic_similarity === 'number') ? job.semantic_similarity : null;
            let deltaX;
            if (sem !== null && profileKeywords.length) deltaX = 0.50 * sem + 0.35 * overlap + 0.15 * builtinNorm;
            else if (profileKeywords.length)            deltaX = 0.70 * overlap + 0.30 * builtinNorm;
            else                                         deltaX = builtinNorm;
            deltaX = clamp(deltaX, 0, 1);
            job.skill_match_score = builtin;
            job.ats_alignment_score = Math.round(overlap * 100);
            job.delta_x = deltaX;
            job.fit_score = Math.round(deltaX * 100);

            // 3. Trajectory (Delta-Y).
            const jobSen  = SENIORITY_MAP[job.seniority_level] || 2;
            const userSen = (userProfile && userProfile.baselineSeniority) || 2;
            const deltaY = jobSen - userSen;
            job.delta_y = deltaY;

            // 4. Pay & culture vectors.
            const floor = (userProfile && userProfile.salaryFloor) || 0;
            let vE = 0.5;
            if (salaryMid > 0 && floor > 0) vE = clamp(salaryMid / floor, 0, 1.3);
            const cult = window.cultureEvaluator.evaluate(descFull);
            const vP = cult.cultureScore;
            job.culture_score = Math.round(vP * 100);

            // 5. Core Score (transparent blend).
            job.match_score = Math.round(100 * (W_FIT * deltaX + W_PAY * Math.min(1, vE) + W_CULTURE * vP));

            // 6. Toxicity → Inferno override.
            const evalData = window.eligibilityEvaluator.evaluateJob(job);
            job.toxicity_score = evalData.toxicityScore;
            job.toxicity_signals = evalData.signals;

            job.is_eligible = !isBlacklisted;
            if (isBlacklisted) {
                job.computed_zone = 'noise';
                job.discard_reason = 'Blacklisted-Company';
                return job;
            }
            job.discard_reason = null;

            if (evalData.isInferno) {
                job.computed_zone = 'inferno';
                job.inferno_circle = evalData.infernoCircle;
                return job;
            }
            job.inferno_circle = null;

            // 7. Zone routing.
            job.computed_zone = classifyZone(deltaX, deltaY, strategy);
            return job;
        },

        // ── Flag near-duplicate listings across boards (keep the first) ──
        flagDuplicates(jobs) {
            const seen = new Set();
            for (const job of jobs) {
                const key = `${(job.company_name || '').toLowerCase().replace(/[^a-z0-9]/g, '')}::${(job.title || '').toLowerCase().replace(/[^a-z0-9]/g, '')}`;
                if (seen.has(key)) job.is_duplicate = true;
                else { seen.add(key); job.is_duplicate = false; }
            }
            return jobs;
        },

        // ── Global percentiles + tier labels over the full eligible set ──
        // Zones are assigned by scoreAndClassifyJob; this only ranks matches.
        recalculatePercentiles(jobsList) {
            const RANKED = new Set(['strike', 'moonshot', 'safety']);
            const ranked = jobsList.filter(j => j.is_eligible !== false && RANKED.has(j.computed_zone));
            const scores = Array.from(new Set(ranked.map(j => j.match_score || 0))).sort((a, b) => a - b);
            const scoreToPct = {};
            scores.forEach((s, i) => { scoreToPct[s] = scores.length > 1 ? Math.round((i / (scores.length - 1)) * 100) : 100; });

            for (const j of jobsList) {
                if (j.is_eligible !== false && RANKED.has(j.computed_zone)) {
                    const pct = scoreToPct[j.match_score || 0] ?? 100;
                    j.match_percentile = pct;
                    j.target_status = pct >= 80 ? 'Tier 1 / Top Match'
                                    : pct >= 50 ? 'Tier 2 / Strong Match'
                                    : pct >= 20 ? 'Tier 3 / Moderate Match'
                                    : 'Tier 4 / Low Match';
                } else {
                    j.match_percentile = null;
                    j.target_status = j.computed_zone === 'inferno' ? 'Inferno'
                                    : j.computed_zone === 'noise' ? 'Filtered' : 'Pending';
                }
            }
            return jobsList;
        }
    };

    window.scoringCoordinator = scoringCoordinator; // Export globally
})();
