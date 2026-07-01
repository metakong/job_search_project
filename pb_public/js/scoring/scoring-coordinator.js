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
            // Per-number 'k' capture (m[2]/m[4]) so "$120k–$150k" and "$120,000–$150,000"
            // both parse, and a lone "k" never inflates the OTHER number.
            const salAnnualRe = /\$\s*([\d,]+(?:\.\d+)?)\s*(k|K)?\s*(?:–|-|—|to)\s*\$?\s*([\d,]+(?:\.\d+)?)\s*(k|K)?/;
            const salHourlyRe = /\$\s*([\d.]+)\s*(?:per\s+hour|\/\s*hr|\/\s*hour|an hour|hourly)/i;
            const salSingleRe = /(?:up\s+to|starting\s+at|from|salary of)\s+\$\s*([\d,]+(?:\.\d+)?)\s*(k|K)?/i;
            const parseNum = s => parseFloat(String(s).replace(/,/g, '')) || 0.0;

            let m = salAnnualRe.exec(desc);
            if (m) {
                let lo = parseNum(m[1]); if (m[2]) lo *= 1000;
                let hi = parseNum(m[3]); if (m[4]) hi *= 1000;
                // If either side carried a 'k', treat sub-1000 bare numbers on the
                // other side as thousands too (e.g. "$120k - 150" → 120k–150k).
                if (m[2] || m[4]) { if (lo > 0 && lo < 1000) lo *= 1000; if (hi > 0 && hi < 1000) hi *= 1000; }
                if (lo > 0 || hi > 0) return this._sanitizeSalary(lo, hi);
            }
            m = salHourlyRe.exec(desc);
            if (m) {
                const hourly = parseFloat(m[1]) || 0;
                const annual = Math.round(hourly * 2080);
                if (annual > 0) return this._sanitizeSalary(annual, annual);
            }
            m = salSingleRe.exec(desc);
            if (m) {
                let val = parseNum(m[1]);
                if (m[2] && m[2].toLowerCase() === 'k' && val < 1000) val *= 1000;
                if (val > 0) return this._sanitizeSalary(val, val);
            }
            return { min: 0.0, max: 0.0, parseable: false };
        },

        // Coherence guard shared by every salary path (parser + feed-supplied
        // values). Swaps reversed ranges, and rejects figures too low to be a
        // real US annual salary (foreign-currency / hourly-misread artifacts like
        // "$5k–$20k" or "$312k–$52k") so the UI shows an honest "Salary N/A"
        // instead of misleading numbers that also skew the pay component.
        _sanitizeSalary(lo, hi, minPlausible) {
            lo = Number(lo) || 0; hi = Number(hi) || 0;
            if (lo > 0 && hi > 0 && lo > hi) { const t = lo; lo = hi; hi = t; } // swap reversed
            const floor = minPlausible || (window.CONFIG && window.CONFIG.SALARY_MIN_PLAUSIBLE_ANNUAL) || 18000;
            const top = hi || lo;
            const bottom = (lo > 0 && hi > 0) ? Math.min(lo, hi) : top;
            if (top > 0 && top < floor) return { min: 0, max: 0, parseable: false };   // whole range too low
            if (bottom > 0 && bottom < 7000) return { min: 0, max: 0, parseable: false }; // impossibly low floor → foreign currency
            if (lo > 0 && hi > 0 && hi / lo > 25) return { min: 0, max: 0, parseable: false }; // absurd spread
            return { min: lo, max: hi, parseable: (lo > 0 || hi > 0) };
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

            // Feed-supplied salaries pass through the SAME coherence guard as the
            // parser (Remotive/Muse ranges can be reversed or in another currency).
            const sal = (job.salary_parseable && (job.salary_max > 0 || job.salary_min > 0))
                ? this._sanitizeSalary(job.salary_min || 0, job.salary_max || 0)
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

            // DOMAIN-COMPETENCY GATE (primary, NON-FATAL): damp Delta-X when the job's
            // domain is one the candidate has little real standing in (derived from the
            // résumé, not the search categories). This is what stops a sales/ops résumé
            // from false-matching software-engineering / data-science / clinical roles
            // on shared buzzwords ("systems", "AI", "red team", "pipeline"). It must
            // NEVER short-circuit — every posting still gets full toxicity/Core/trajectory
            // math; the hide/zone decision stays with distributeAndRank's fit gates.
            const affinity = (userProfile && userProfile.domainAffinity) || null;
            if (affinity && window.competencyProfiler) {
                const dc = window.competencyProfiler.compatMultiplier(affinity, job);
                deltaX *= dc.mult;
                if (dc.compat !== null) { job.domain_compat = Math.round(dc.compat * 100); job.primary_domain = dc.primary; }
            } else {
                // Fallback when there's no résumé profile: the older title-based damp
                // against un-selected categories.
                const userCats = (userProfile && userProfile.categories) ? userProfile.categories.map(c => String(c).toLowerCase()) : [];
                if (userCats.length) {
                    const TECH_RE  = /\b(engineer|developer|devops|back[- ]?end|front[- ]?end|programmer|data scientist|software architect|\bsre\b|ios|android)\b/i;
                    const SALES_RE = /\b(account executive|sales rep(?:resentative)?|\bsdr\b|\bbdr\b|account manager|business development|sales director|inside sales)\b/i;
                    if (!userCats.includes('tech') && TECH_RE.test(title)) deltaX *= 0.4;
                    else if (!userCats.includes('sales') && SALES_RE.test(title)) deltaX *= 0.4;
                }
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
            
            // 7/8. trajectory — DUAL-BASELINE anchor.
            // A candidate with a high PEAK but a low RECENT level (an underemployed
            // senior — the exact case this platform exists for) is realistically
            // re-hired somewhere BETWEEN the two, not at their peak. Anchoring the
            // trajectory to the peak alone made every real job a "step down" and left
            // Moonshot mathematically empty. The effective baseline = floor midpoint
            // of peak & recent: it collapses to a single level for a linear career
            // (peak==recent) and depresses toward recent when there's a deficit.
            const jobSen = SENIORITY_MAP[job.seniority_level] !== undefined ? SENIORITY_MAP[job.seniority_level] : 0;
            const peakSen   = clamp(Number((userProfile && (userProfile.peakSeniority ?? userProfile.baselineSeniority)) ?? 2) || 2, 1, 4);
            const recentSen = clamp(Number((userProfile && userProfile.recentSeniority) ?? peakSen) || peakSen, 1, 4);
            const effectiveBaseline = clamp(Math.floor((peakSen + recentSen) / 2), 1, 4);
            job.effective_baseline = effectiveBaseline;
            if (jobSen === 0) {
                job.trajectory_peak = null;
                job.trajectory_recent = null;
                job.trajectory_effective = null;
            } else {
                job.trajectory_peak = jobSen - peakSen;
                job.trajectory_recent = jobSen - recentSen;
                job.trajectory_effective = jobSen - effectiveBaseline;
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
            const SAFETY_FIT   = cfg.SAFETY_FIT_MIN ?? STRIKE_FIT;

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
            // CRITICAL (AGENTS.md Law 3): the Safety Net is a HIGH-fit fallback —
            // "Delta-X > High Threshold ... NOT a trash can for irrelevant jobs."
            // It used to be the unconditional else-bucket, so a step-down / lateral /
            // unknown-level role with only 18–40% résumé fit (the domain gate crushes
            // OFF-field roles to ~0.1–0.25) still landed in the Safety Net — the exact
            // "roles I'm not qualified for" leak. Safety now enforces SAFETY_FIT (the
            // proven Strike bar): a nominal step-down you are NOT a strong in-field
            // match for is hidden as noise, not filed under Safety.
            for (const j of relevant) {
                const dy  = j.trajectory_effective;   // job − dual-baseline anchor; null if level unknown
                const fit = j.delta_x || 0;
                let zone;
                if (dy === null || dy === undefined) {
                    // Unknown level → can't claim a reach. Strong fit = Strike, else Safety-if-qualified.
                    zone = (fit >= STRIKE_FIT) ? 'strike' : (fit >= SAFETY_FIT ? 'safety' : 'noise');
                } else if (dy >= 2) {
                    zone = (fit >= MOON_FIT) ? 'moonshot'                    // clear reach up
                         : (fit >= SAFETY_FIT) ? 'safety'
                         : 'noise';
                } else if (dy === 1) {
                    zone = (fit >= STRIKE_FIT) ? 'strike'                    // qualified step-up
                         : (fit >= MOON_FIT)   ? 'moonshot'                  // partial-fit reach
                         : (fit >= SAFETY_FIT) ? 'safety'
                         : 'noise';
                } else if (dy <= -1) {
                    zone = (fit >= SAFETY_FIT) ? 'safety' : 'noise';         // step down, but must be a real in-field match
                } else {
                    zone = (fit >= STRIKE_FIT) ? 'strike' : (fit >= SAFETY_FIT ? 'safety' : 'noise'); // lateral
                }
                j.computed_zone = zone;
                j.zone_rank = 0;
            }

            // Anti-blank-screen guard — now also covers the new Safety fit gate. If the
            // ENTIRE relevant pool got demoted to 'noise' (a genuinely off-target batch,
            // or a résumé whose fit never clears SAFETY_FIT), show it honestly in the
            // Safety Net rather than rendering a "Zero Results" screen. Nothing weak ever
            // reaches Strike/Moonshot; the honest fallback is always the Safety Net.
            if (relevant.length && !relevant.some(j => j.computed_zone !== 'noise')) {
                for (const j of relevant) j.computed_zone = 'safety';
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
