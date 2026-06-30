// =====================================================================
// Scoring Coordinator & Pipeline Orchestrator — scoring-coordinator.js
// =====================================================================
// Orchestrates dynamic, probabilistic job scoring and forced distribution.

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

    // ── Seniority ladder ─────────────────────────────────────────────
    const SENIORITY_MAP = { director: 4, manager: 3, senior: 2, entry: 1, unspecified: 0 };

    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

    const scoringCoordinator = {
        SENIORITY_MAP,

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

        classifyLocationType(desc, loc) {
            const combined = `${desc} ${loc}`.toLowerCase();
            if (/\bremote\b|work from home|fully distributed|\bwfh\b|100%\s*remote/i.test(combined)) return 'remote';
            if (/\bhybrid\b|days in office|partial remote|flexible location/i.test(combined)) return 'hybrid';
            if (/on.?site|in.?office required|must be local|in person/i.test(combined)) return 'on_site';
            return 'unknown';
        },

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

        getRecencyMultiplier(days, locationType) {
            const remoteLike = !(locationType === 'on_site' || locationType === 'hybrid');
            if (days <= 7)  return { mult: 1.0, isStale: false };
            if (days <= 14) return { mult: remoteLike ? 0.80 : 0.85, isStale: false };
            if (days <= 21) return { mult: remoteLike ? 0.55 : 0.75, isStale: false };
            return { mult: remoteLike ? 0.25 : 0.40, isStale: true };
        },

        // Seniority is read from the TITLE ONLY. Scanning the full description
        // hallucinated levels ("…reports to the Director" → 'director'), which
        // flattened the Delta-Y trajectory axis. The title is the authoritative,
        // low-noise signal; a missing level word honestly yields 'unspecified'.
        detectSeniority(title) {
            const t = (title || '').toLowerCase();
            if (/\bdirector\b|\bvp\b|vice president|head of|\bchief\b|\bc[etof]o\b|\bpresident\b/i.test(t)) return 'director';
            if (/\bmanager\b|\bmgr\b|\blead\b|\bsupervisor\b|\bprincipal\b/i.test(t)) return 'manager';
            if (/\bsenior\b|\bsr\.?\b|\bstaff\b|\blevel iii\b|\biii\b/i.test(t)) return 'senior';
            if (/\bcoordinator\b|\bspecialist\b|\brepresentative\b|\bassociate\b|\bjunior\b|\bjr\.?\b|\bentry\b|\bintern\b|\bassistant\b|\bclerk\b|\btrainee\b|\bapprentice\b/i.test(t)) return 'entry';
            return 'unspecified';
        },

        detectApplyType(url, desc) {
            const u = (url || '').toLowerCase();
            if (u.includes('linkedin.com/jobs') || u.includes('indeed.com/viewjob') || /easy\s*apply|quick\s*apply|one.click\s*apply/i.test(desc || '')) return 'easy_apply';
            const ext = ["greenhouse.io", "workday", "lever.co", "taleo.net", "icims.com", "bamboohr.com", "jobvite.com", "smartrecruiters.com", "ashbyhq.com"];
            for (const d of ext) if (u.includes(d)) return 'external_ats';
            return 'unknown';
        },

        detectGhostJob(descFull, scrubbed, days, salaryParseable) {
            if (salaryParseable) return false;
            const perpetual = /always (?:accepting|taking) applications|building a (?:pipeline|pool|bench) of (?:candidates|talent)|for future (?:opportunities|openings|consideration)|we(?:'re| are) always hiring/i.test(descFull);
            if (days >= 30 && perpetual) return true;
            if (days >= 30 && scrubbed.length < 350) return true;
            if (days >= 60) return true;
            return false;
        },

        buildProfileKeywords(userProfile) {
            const resume = (userProfile && userProfile.resumeText) || '';
            if (resume.trim().length > 50) return window.skillMatcher.extractKeywords(resume, 60);
            const q = (userProfile && userProfile.search_queries) || [];
            const blob = Array.isArray(q) ? q.join(' ') : String(q || '');
            return blob.trim() ? window.skillMatcher.extractKeywords(blob, 40) : [];
        },

        _payFitScore(job, profile) {
            const sal = job.salary_mid || 0;
            if (sal === 0 && !job.salary_parseable) return null; // Null if no salary data
            const floor = (profile && profile.salaryFloor) ? profile.salaryFloor : 40000;
            if (sal < floor * 0.8) return 15;
            if (sal < floor) return 40;
            if (sal <= floor * 1.5) return 85;
            return 100;
        },

        _adaptiveCoreScore(fitPercent, payScore, cultureScore, ambiguityIndex) {
            const AI = ambiguityIndex || 0;
            let w_fit = 0.55 * (1 - 0.3 * AI);
            let w_pay = 0.25;
            let w_culture = 0.20 + 0.165 * AI;
            
            // Missing salary: redistribute proportionally
            if (payScore === null) {
                const total = w_fit + w_culture;
                w_fit = w_fit / total;
                w_culture = w_culture / total;
                w_pay = 0;
            }
            
            if (cultureScore === null) {
                if (payScore === null) {
                    w_fit = 1;
                    w_culture = 0;
                    w_pay = 0;
                } else {
                    const total = w_fit + w_pay;
                    w_fit = w_fit / total;
                    w_pay = w_pay / total;
                    w_culture = 0;
                }
            }
            
            return Math.round(
                100 * (w_fit * fitPercent + w_pay * ((payScore || 0) / 100) + w_culture * (cultureScore || 0))
            );
        },

        scoreAndClassifyJob(job, userProfile, blacklistNames = [], profileKeywords = null) {
            const descFull = job.description_full || job.description || '';
            const title    = job.title || '';
            if (profileKeywords === null) profileKeywords = this.buildProfileKeywords(userProfile || {});
            
            // 0. Blacklist
            const companyClean = (job.company_name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            let isBlacklisted = false;
            for (const name of blacklistNames) {
                const b = String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                if (b && companyClean && (companyClean.includes(b) || b.includes(companyClean))) { isBlacklisted = true; break; }
            }
            
            // 1. Structured signals
            const computedLoc = this.classifyLocationType(descFull, job.job_location || '');
            job.location_type = (job.location_type === 'remote') ? 'remote' : computedLoc;

            const sal = (job.salary_parseable && (job.salary_max > 0 || job.salary_min > 0))
                ? { min: job.salary_min || 0, max: job.salary_max || 0, parseable: true }
                : this.parseSalary(descFull);
            job.salary_min = sal.min; job.salary_max = sal.max; job.salary_parseable = sal.parseable;
            const salaryMid = sal.parseable ? (sal.max > 0 && sal.min > 0 ? (sal.min + sal.max) / 2 : (sal.max || sal.min)) : 0;
            job.salary_mid = salaryMid;

            const scrubbed = this.scrubBoilerplate(descFull);
            // Prefer a seniority supplied by a structured source (e.g. The Muse's
            // explicit "levels"); otherwise derive it from the title only.
            job.seniority_level = (job.source_seniority && SENIORITY_MAP[job.source_seniority] !== undefined)
                ? job.source_seniority
                : this.detectSeniority(title);
            if (window.industryClassifier) job.industry = window.industryClassifier.classify(descFull);
            job.apply_type = this.detectApplyType(job.apply_url, descFull);

            const days = Number.isFinite(job.days_since_posted) ? job.days_since_posted : 0;
            const rec = this.getRecencyMultiplier(days, job.location_type);
            job.recency_multiplier = rec.mult;
            job.is_stale = rec.isStale;
            job.is_ghost_job = this.detectGhostJob(descFull, scrubbed, days, sal.parseable);

            // Phase 1 - Individual Scoring
            
            // 1. ambiguity_index
            const ai = window.ambiguityIndex ? window.ambiguityIndex.compute(descFull) : 0;
            job.ambiguity_index = ai;
            
            // 2. skill_overlap
            let deltaX = 0;
            if (window.skillMatcher) {
                const builtin = window.skillMatcher.match(scrubbed, title);
                const builtinNorm = Math.min(1, builtin / 12);
                job.skill_match_score = builtin;
                
                const softSkills = (userProfile && userProfile.softSkills) ? userProfile.softSkills : [];
                const hardOverlap = window.skillMatcher.computeATSScore(scrubbed, profileKeywords);
                job.ats_alignment_score = Math.round(hardOverlap * 100);
                
                const overlap = window.skillMatcher.computeWeightedOverlap(profileKeywords, softSkills, scrubbed, ai);
                job.overlap_ratio = overlap; // Save for friction calculation
                
                const sem = (typeof job.semantic_similarity === 'number') ? job.semantic_similarity : null;
                if (sem !== null && profileKeywords.length) deltaX = 0.50 * sem + 0.35 * overlap + 0.15 * builtinNorm;
                else if (profileKeywords.length)            deltaX = 0.70 * overlap + 0.30 * builtinNorm;
                else                                         deltaX = builtinNorm;
            }
            deltaX = clamp(deltaX, 0, 1);
            job.delta_x = deltaX;
            job.fit_score = Math.round(deltaX * 100);
            
            // 3. culture_score
            const cult = window.cultureEvaluator ? window.cultureEvaluator.evaluate(descFull) : { cultureScore: null };
            job.culture_score = cult.cultureScore !== null ? Math.round(cult.cultureScore * 100) : null;
            
            // 4. toxicity
            const evalData = window.eligibilityEvaluator ? window.eligibilityEvaluator.evaluateJob(job) : { toxicityScore: 0, isInferno: false, dominantCircle: null };
            job.toxicity_score = evalData.toxicityScore;
            job.toxicity_signals = evalData.signals;
            // Persist the dominant cause so the Inferno banner/modal can name the
            // "circle" (previously never stored → always rendered the generic label).
            job.inferno_circle = evalData.dominantCircle || null;
            
            // 5. pay_score
            const payScore = this._payFitScore(job, userProfile);
            
            // 6. core_score
            job.match_score = this._adaptiveCoreScore(deltaX, payScore, cult.cultureScore, ai);
            
            // 7/8. trajectory
            const jobSen = SENIORITY_MAP[job.seniority_level] !== undefined ? SENIORITY_MAP[job.seniority_level] : 0;
            const peakSen = (userProfile && userProfile.peakSeniority) || 2;
            const recentSen = (userProfile && userProfile.recentSeniority) || peakSen;
            if (jobSen === 0) {
                job.trajectory_peak = null;
                job.trajectory_recent = null;
            } else {
                job.trajectory_peak = jobSen - peakSen;
                job.trajectory_recent = jobSen - recentSen;
            }
            
            // 9. transition_friction
            if (window.transitionFriction) job.transition_friction = window.transitionFriction.compute(job, userProfile || {});
            
            // Eligibility & overrides
            job.is_eligible = !isBlacklisted;
            if (isBlacklisted) {
                job.computed_zone = 'noise';
                job.discard_reason = 'Blacklisted-Company';
                return job;
            }
            job.discard_reason = null;
            
            job.computed_zone = 'pending';
            
            return job;
        },

        flagDuplicates(jobs) {
            const seen = new Set();
            for (const job of jobs) {
                const key = `${(job.company_name || '').toLowerCase().replace(/[^a-z0-9]/g, '')}::${(job.title || '').toLowerCase().replace(/[^a-z0-9]/g, '')}`;
                if (seen.has(key)) job.is_duplicate = true;
                else { seen.add(key); job.is_duplicate = false; }
            }
            return jobs;
        },

        // Phase 2 — Distribution.
        // Zones are assigned from the two candidate-relative axes the platform is
        // built on (per AGENTS.md): résumé fit (Delta-X) and trajectory (Delta-Y).
        // Absolute fit GATES — not forced score percentiles — decide Strike/Moonshot,
        // so a starved or off-target pool can never promote "the best of the worst".
        distributeAndRank(jobsList, userProfile) {
            const cfg = window.CONFIG || {};
            const INFERNO_TOX  = cfg.INFERNO_TOXICITY_THRESHOLD ?? 50;
            const INFERNO_MAXF = cfg.INFERNO_MAX_FRACTION ?? 0.40;
            const NOISE_FIT    = cfg.NOISE_FIT_FLOOR ?? 0.18;
            const STRIKE_FIT   = cfg.STRIKE_FIT_MIN ?? 0.40;
            const MOON_FIT     = cfg.MOONSHOT_FIT_MIN ?? 0.30;

            const eligible = jobsList.filter(j => j.is_eligible !== false);
            // Idempotent reset so re-scoring an existing cache re-routes cleanly.
            for (const j of eligible) if (j.computed_zone === 'inferno' || j.computed_zone === 'noise') j.computed_zone = 'pending';

            // ── 1. INFERNO — absolute, calibrated toxicity threshold (matches evaluator.js).
            // A safety cap guarantees Inferno can never become the majority pile,
            // even for a pathological batch of postings.
            let infernoJobs = eligible.filter(j => (j.toxicity_score || 0) >= INFERNO_TOX);
            const cap = Math.floor(eligible.length * INFERNO_MAXF);
            if (infernoJobs.length > cap) {
                infernoJobs.sort((a, b) => (b.toxicity_score || 0) - (a.toxicity_score || 0));
                infernoJobs = infernoJobs.slice(0, cap);
            }
            const infernoSet = new Set(infernoJobs);
            for (const j of infernoSet) { j.computed_zone = 'inferno'; j.strategy_tier = null; }
            const clean = eligible.filter(j => !infernoSet.has(j));

            // ── 2. PERCENTILE (display only) over the clean pool.
            const scores = Array.from(new Set(clean.map(j => j.match_score || 0))).sort((a, b) => a - b);
            const scoreToPct = {};
            scores.forEach((s, i) => { scoreToPct[s] = scores.length > 1 ? Math.round((i / (scores.length - 1)) * 100) : 100; });
            for (const j of clean) j.match_percentile = scoreToPct[j.match_score || 0] ?? 100;

            // ── 3. RELEVANCE FLOOR (fit-primary) → 'noise' (hidden).
            // Fit (Delta-X) is the true relevance signal; pay/culture must not rescue
            // an off-target role. If the ENTIRE pool is weak (e.g. starved network, no
            // résumé), we DON'T hide everything — better an honest Safety Net than a
            // blank "Zero Results" screen. Nothing weak ever reaches Strike/Moonshot.
            const allWeak = clean.length > 0 && clean.every(j => (j.delta_x || 0) < NOISE_FIT);
            for (const j of clean) {
                j.computed_zone = (!allWeak && (j.delta_x || 0) < NOISE_FIT) ? 'noise' : 'pending';
            }
            const relevant = clean.filter(j => j.computed_zone !== 'noise');

            // ── 4. ZONE by trajectory (Delta-Y), gated by fit (Delta-X).
            for (const j of relevant) {
                const dy  = j.trajectory_recent;   // job − recent seniority; null if level unknown
                const fit = j.delta_x || 0;
                let zone;
                if (dy === null || dy === undefined) {
                    // Unknown level → can't claim a reach. Strong fit = Strike, else fallback.
                    zone = (fit >= STRIKE_FIT) ? 'strike' : 'safety';
                } else if (dy >= 2) {
                    zone = (fit >= MOON_FIT) ? 'moonshot' : 'safety';        // clear reach up
                } else if (dy === 1) {
                    zone = (fit >= STRIKE_FIT) ? 'strike'                    // qualified step-up
                         : (fit >= MOON_FIT)   ? 'moonshot'                  // partial-fit reach
                         : 'safety';
                } else if (dy <= -1) {
                    zone = 'safety';                                         // step down in-field
                } else {
                    zone = (fit >= STRIKE_FIT) ? 'strike' : 'safety';        // lateral
                }
                j.computed_zone = zone;
                j.zone_rank = 0;
            }

            // ── 5. STRATEGY TIERS within each zone — sliced by transition friction
            // (ascending: tier 1 = lowest friction / easiest, tier 3 = biggest reach).
            // The Strategy Dial selects which tier to show. Too-small zones get the
            // neutral Balanced tier so the dial never blanks them.
            for (const z of ['strike', 'moonshot', 'safety']) {
                const zoneJobs = relevant.filter(j => j.computed_zone === z)
                    .sort((a, b) => (a.transition_friction || 0) - (b.transition_friction || 0));
                const zThird = Math.floor(zoneJobs.length / 3);
                zoneJobs.forEach((j, i) => {
                    j.zone_rank = i;
                    if (zThird === 0) j.strategy_tier = 2;
                    else if (i < zThird) j.strategy_tier = 1;
                    else if (i < 2 * zThird) j.strategy_tier = 2;
                    else j.strategy_tier = 3;
                });
            }

            // ── 6. Labels.
            for (const j of jobsList) {
                switch (j.computed_zone) {
                    case 'strike':   j.target_status = 'Tier 1 / Top Match'; break;
                    case 'moonshot': j.target_status = 'Tier 2 / Strong Match'; break;
                    case 'safety':   j.target_status = 'Tier 3 / Moderate Match'; break;
                    case 'inferno':  j.target_status = 'Inferno'; break;
                    default:         j.target_status = 'Filtered';
                }
            }
            return jobsList;
        }
    };

    window.scoringCoordinator = scoringCoordinator; // Export globally
})();
