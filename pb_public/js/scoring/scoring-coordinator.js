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

        detectSeniority(title, desc) {
            const combined = `${title} ${desc || ''}`.toLowerCase();
            if (/\bdirector\b|\bvp\b|vice president|head of|\bchief\b|\bc[etof]o\b/i.test(combined)) return 'director';
            if (/\bmanager\b|\blead\b|\bsupervisor\b|\bprincipal\b/i.test(combined)) return 'manager';
            if (/\bsenior\b|\bsr\.?\b|\bstaff\b/i.test(combined)) return 'senior';
            if (/\bcoordinator\b|\bspecialist\b|\brepresentative\b|\bassociate\b|\bjunior\b|\bjr\.?\b|\bentry\b|\bintern\b/i.test(combined)) return 'entry';
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
            job.seniority_level = this.detectSeniority(title, descFull);
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
            const evalData = window.eligibilityEvaluator ? window.eligibilityEvaluator.evaluateJob(job) : { toxicityScore: 0, isInferno: false };
            job.toxicity_score = evalData.toxicityScore;
            job.toxicity_signals = evalData.signals;
            
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

        // Phase 2 - Distribution
        distributeAndRank(jobsList, userProfile) {
            const config = window.APP_CONFIG || {};
            // Using 75 as instructed for MIN_TOXICITY_FLOOR (since it's a 0-100 scale)
            const MIN_TOXICITY_FLOOR = config.MIN_TOXICITY_FLOOR || 75; 
            const INFERNO_PERCENTILE = config.INFERNO_PERCENTILE || 84;
            
            const eligibleJobs = jobsList.filter(j => j.is_eligible !== false);
            
            // 1. INFERNO PURGE
            eligibleJobs.sort((a, b) => (b.toxicity_score || 0) - (a.toxicity_score || 0));
            const p84Index = Math.floor(eligibleJobs.length * (1 - (INFERNO_PERCENTILE / 100)));
            const p84 = eligibleJobs.length > 0 && p84Index >= 0 && p84Index < eligibleJobs.length 
                ? (eligibleJobs[p84Index].toxicity_score || 0) : 0;
            
            const infernoCutoff = Math.max(p84, MIN_TOXICITY_FLOOR);
            
            for (const j of eligibleJobs) {
                if ((j.toxicity_score || 0) > infernoCutoff) {
                    j.computed_zone = 'inferno';
                }
            }
            
            const cleanPool = eligibleJobs.filter(j => j.computed_zone !== 'inferno');
            
            // 2. NOISE FILTER
            let sumDx = 0;
            for (const j of cleanPool) sumDx += (j.delta_x || 0);
            const meanDx = cleanPool.length > 0 ? sumDx / cleanPool.length : 0;
            
            let sumSqDx = 0;
            for (const j of cleanPool) sumSqDx += Math.pow((j.delta_x || 0) - meanDx, 2);
            const stdDx = cleanPool.length > 0 ? Math.sqrt(sumSqDx / cleanPool.length) : 0;
            
            const noiseFloor = Math.max(0.05, meanDx - 2 * stdDx);
            
            for (const j of cleanPool) {
                if ((j.delta_x || 0) < noiseFloor) {
                    j.computed_zone = 'noise';
                }
            }
            
            const distroPool = cleanPool.filter(j => j.computed_zone !== 'noise');
            
            // 3. FORCED PERCENTILE SPLIT
            distroPool.sort((a, b) => (b.match_score || 0) - (a.match_score || 0));
            
            // Compute percentiles for display
            const scores = Array.from(new Set(distroPool.map(j => j.match_score || 0))).sort((a, b) => a - b);
            const scoreToPct = {};
            scores.forEach((s, i) => { scoreToPct[s] = scores.length > 1 ? Math.round((i / (scores.length - 1)) * 100) : 100; });
            
            const third = Math.floor(distroPool.length / 3);
            
            distroPool.forEach((j, index) => {
                const pct = scoreToPct[j.match_score || 0] ?? 100;
                j.match_percentile = pct;
                j.zone_rank = index; // Keep sorting order
                
                if (distroPool.length < (config.MIN_CLEAN_POOL_FOR_DISTRIBUTION || 9)) {
                    // Fallback to absolute thresholds if pool is too small
                    if (j.delta_x >= 0.55 && j.match_score >= 70) j.computed_zone = 'strike';
                    else if (j.delta_x >= 0.40) j.computed_zone = 'moonshot';
                    else j.computed_zone = 'safety';
                } else {
                    if (index < third) j.computed_zone = 'strike';
                    else if (index < 2 * third) j.computed_zone = 'moonshot';
                    else j.computed_zone = 'safety';
                }
                
                // 4. TRAJECTORY OVERRIDE
                if (j.trajectory_peak !== null && j.trajectory_recent !== null) {
                    if (j.trajectory_peak >= -0.5 && j.trajectory_peak <= 0.5 && j.trajectory_recent >= 1) {
                        j.computed_zone = 'moonshot';
                    }
                    if (j.trajectory_peak <= -2) {
                        j.computed_zone = 'safety';
                    }
                }
            });
            
            // 5. STRATEGY TIERS (within zones)
            const zones = ['strike', 'moonshot', 'safety'];
            for (const z of zones) {
                const zoneJobs = distroPool.filter(j => j.computed_zone === z);
                // Sort by friction ascending (lowest friction = tier 1)
                zoneJobs.sort((a, b) => (a.transition_friction || 0) - (b.transition_friction || 0));
                
                const zThird = Math.floor(zoneJobs.length / 3);
                zoneJobs.forEach((j, index) => {
                    if (index < zThird) j.strategy_tier = 1; // Survival (easiest)
                    else if (index < 2 * zThird) j.strategy_tier = 2; // Balanced
                    else j.strategy_tier = 3; // Aggressive
                });
            }

            // Clean up titles
            for (const j of jobsList) {
                if (j.computed_zone === 'strike') j.target_status = 'Tier 1 / Top Match';
                else if (j.computed_zone === 'moonshot') j.target_status = 'Tier 2 / Strong Match';
                else if (j.computed_zone === 'safety') j.target_status = 'Tier 3 / Moderate Match';
                else if (j.computed_zone === 'inferno') j.target_status = 'Inferno';
                else j.target_status = 'Filtered';
            }
            
            return jobsList;
        }
    };

    window.scoringCoordinator = scoringCoordinator; // Export globally
})();
