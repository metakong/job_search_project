// =====================================================================
// Scoring Coordinator & Pipeline Orchestrator — scoring-coordinator.js
// =====================================================================

// Truncation phrases for EEO / legal boilerplate scrubbing
const TRUNCATION_PHRASES = [
    "equal opportunity employer",
    "affirmative action",
    "protected veteran status",
    "\\bdisabilit(y|ies)\\b",
    "race, color, religion, sex",
    "applicants will receive consideration",
    "comprehensive benefits package",
    "\\b401\\(k\\)\\b",
    "\\bhealth,\\s*dental\\s*(?:,\\band\\b|&)\\s*vision\\b",
    "paid time off",
    "\\bpto\\b",
    "join our fast-paced",
    "world-class culture",
    "looking for a self-motivated rockstar"
];

const TRUNCATE_PATTERN = new RegExp(TRUNCATION_PHRASES.join('|'), 'i');
const HTML_TAG_RE      = /<[^>]*>/g;
const WHITESPACE_RE    = /\s+/g;
const BODY_RE          = /<body[^>]*>([\s\S]*?)<\/body>/i;

// Default resume keywords for ATS alignment calculation
const DEFAULT_RESUME_KEYWORDS = [
    "Salesforce", "Zoho", "Nimble", "HubSpot", "CRM", "Sales Operations",
    "Business Development", "Revenue", "Pipeline", "Lead Generation",
    "P&L", "Process Improvement", "SOP", "Logistics", "Procurement",
    "Turnaround", "Contract Negotiation", "B2B", "B2C", "Quota",
    "Territory", "Cold Calling", "Mentoring", "Forecasting", "Go-to-Market",
    "Workflow Automation", "AI", "Operations Manager", "Director",
    "Account Manager", "Account Executive", "E-commerce", "Vendor Management",
    "Revenue Operations"
];

// Helper to escape regex special chars
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Precompile default resume keyword regexes
const COMPILED_DEFAULT_RESUME = DEFAULT_RESUME_KEYWORDS.map(kw => {
    const escaped = escapeRegExp(kw);
    const sb = /^[A-Za-z0-9]/.test(kw) ? '\\b' : '';
    const eb = /[A-Za-z0-9]$/.test(kw) ? '\\b' : '';
    return new RegExp(`${sb}${escaped}${eb}`, 'i');
});

// Scoring coordinator object
const scoringCoordinator = {
    // ── Boilerplate Scrubbing ────────────────────────────────────────
    scrubBoilerplate(text) {
        if (!text) return '';
        
        // 1. Unescape HTML entities (basic client-side version)
        let clean = text
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#039;/g, "'")
            .replace(/&nbsp;/g, ' ');
            
        // 2. Extract body content if HTML doc
        const bodyMatch = BODY_RE.exec(clean);
        if (bodyMatch) {
            clean = bodyMatch[1];
        }
        
        // 3. Guard against enormous payloads
        if (clean.length > 20000) {
            clean = clean.substring(0, 20000);
        }
        
        // 4. Truncate at first compliance or marketing phrase
        const truncateMatch = TRUNCATE_PATTERN.exec(clean);
        if (truncateMatch) {
            clean = clean.substring(0, truncateMatch.index);
        }
        
        // 5. Strip HTML tags
        clean = clean.replace(HTML_TAG_RE, ' ');
        
        // 6. Standardize whitespace
        clean = clean.replace(WHITESPACE_RE, ' ').trim();
        
        return clean;
    },

    // ── Location Type Classification ──────────────────────────────────
    classifyLocationType(desc, loc) {
        const combined = `${desc} ${loc}`.toLowerCase();
        
        const remoteRe = /\bremote\b|work from home|fully distributed|\bwfh\b|100%\s*remote/i;
        const hybridRe = /\bhybrid\b|days in office|partial remote|flexible location/i;
        const onsiteRe = /on.?site|in.?office required|must be local|in person/i;
        
        if (remoteRe.test(combined)) return 'remote';
        if (hybridRe.test(combined)) return 'hybrid';
        if (onsiteRe.test(combined)) return 'on_site';
        return 'unknown';
    },

    // ── Salary Parsing ────────────────────────────────────────────────
    parseSalary(desc) {
        // Matches $55,000 - $75,000 or $55k - $75k
        const salAnnualRe = /\$\s*([\d,]+)\s*(?:k|K)?\s*(?:–|-|to)\s*\$\s*([\d,]+)\s*(?:k|K)?/i;
        // Matches $18.50 per hour
        const salHourlyRe = /\$\s*([\d.]+)\s*(?:per\s+hour|\/\s*hr|\/\s*hour)/i;
        // Matches starting at / up to / from $75k / $60,000
        const salSingleRe = /(?:up\s+to|starting\s+at|from)\s+\$\s*([\d,]+)\s*(k|K)?/i;
        
        const parseNum = s => parseFloat(s.replace(/,/g, '')) || 0.0;
        
        // Annual range
        let m = salAnnualRe.exec(desc);
        if (m) {
            let lo = parseNum(m[1]);
            let hi = parseNum(m[2]);
            const textMatch = m[0].toLowerCase();
            if (textMatch.includes('k')) {
                if (lo < 1000) lo *= 1000;
                if (hi < 1000) hi *= 1000;
            }
            if (lo > 0 || hi > 0) return { min: lo, max: hi, parseable: true };
        }
        
        // Hourly
        m = salHourlyRe.exec(desc);
        if (m) {
            const hourly = parseFloat(m[1]) || 0;
            const annual = Math.round(hourly * 2080 * 100) / 100;
            return { min: annual, max: annual, parseable: true };
        }
        
        // Single value
        m = salSingleRe.exec(desc);
        if (m) {
            let val = parseNum(m[1]);
            const isK = m[2] && m[2].toLowerCase() === 'k';
            if (isK && val < 1000) val *= 1000;
            return { min: 0.0, max: val, parseable: true };
        }
        
        return { min: 0.0, max: 0.0, parseable: false };
    },

    // ── Recency Multiplier ────────────────────────────────────────────
    getRecencyMultiplier(days, locationType) {
        if (locationType === 'on_site' || locationType === 'hybrid') {
            if (days <= 7) return { mult: 1.0, isStale: false };
            if (days <= 14) return { mult: 0.85, isStale: false };
            if (days <= 21) return { mult: 0.75, isStale: false };
            return { mult: 0.40, isStale: true };
        } else {
            if (days <= 7) return { mult: 1.0, isStale: false };
            if (days <= 14) return { mult: 0.80, isStale: false };
            if (days <= 21) return { mult: 0.55, isStale: false };
            return { mult: 0.25, isStale: true };
        }
    },

    // ── Seniority Detection ───────────────────────────────────────────
    detectSeniority(title, desc) {
        const combined = `${title} ${desc.substring(0, 300)}`.toLowerCase();
        
        const directorRe = /\bdirector\b|\bvp\b|vice president|head of/i;
        const managerRe  = /\bmanager\b|\blead\b|\bsupervisor\b/i;
        const seniorRe   = /\bsenior\b|\bsr\.\b|\bprincipal\b/i;
        const entryRe    = /\bcoordinator\b|\bspecialist\b|\brepresentative\b|\bassociate\b/i;
        
        if (directorRe.test(combined)) return 'director';
        if (managerRe.test(combined)) return 'manager';
        if (seniorRe.test(combined)) return 'senior';
        if (entryRe.test(combined)) return 'entry';
        return 'unspecified';
    },

    // ── Apply Type Detection ──────────────────────────────────────────
    detectApplyType(url, desc) {
        const urlLower = (url || '').toLowerCase();
        const easyApplyRe = /easy\s*apply|quick\s*apply|one.click\s*apply/i;
        
        if (urlLower.includes('linkedin.com/easy') || urlLower.includes('indeed.com/viewjob')) {
            return 'easy_apply';
        }
        if (easyApplyRe.test(desc || '')) {
            return 'easy_apply';
        }
        
        const extDomains = [
            "greenhouse.io", "workday.com", "lever.co", "taleo.net",
            "icims.com", "bamboohr.com", "jobvite.com", "smartrecruiters.com"
        ];
        for (const dom of extDomains) {
            if (urlLower.includes(dom)) return 'external_ats';
        }
        
        return 'unknown';
    },

    // ── ATS Alignment Calculation ─────────────────────────────────────
    computeATSAlignmentScore(desc, customResumeText = '') {
        if (!desc) return 0;
        
        let keywordPatterns = COMPILED_DEFAULT_RESUME;
        
        // Dynamically build keyword patterns if a custom resume was uploaded
        if (customResumeText && customResumeText.trim() !== '') {
            // Find unique words/phrases from the custom resume
            // We can match camelCase or capitalized phrases from resume as keywords
            const regex = /\b[A-Za-z]{3,15}\b/g;
            const words = customResumeText.match(regex) || [];
            const uniqueWords = Array.from(new Set(words))
                .filter(w => !['the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'were'].includes(w.toLowerCase()));
            
            keywordPatterns = uniqueWords.slice(0, 40).map(word => {
                const escaped = escapeRegExp(word);
                return new RegExp(`\\b${escaped}\\b`, 'i');
            });
        }
        
        if (keywordPatterns.length === 0) return 0;
        
        let matched = 0;
        for (const pattern of keywordPatterns) {
            if (pattern.test(desc)) matched++;
        }
        
        return Math.round((matched / keywordPatterns.length) * 100);
    },

    // ── Pipeline Orchestrator ──────────────────────────────────────────
    async scoreAndClassifyJob(job, userProfile, blacklistNames = []) {
        const descFull = job.description_full || '';
        
        // 1. Kill Switch
        const elig = window.eligibilityEvaluator.evaluateEligibility(descFull);
        if (!elig.isEligible) {
            return {
                ...job,
                is_eligible: false,
                discard_reason: elig.discardReason,
                target_status: 'Tier 4 / Low Match'
            };
        }
        
        // 2. Remote check (moved to multipliers)
        const locationType = this.classifyLocationType(descFull, job.job_location || '');
        
        // 3. Salary check
        const sal = this.parseSalary(descFull);
        const salaryFloor = userProfile.salaryFloor || 40000;
        if (sal.parseable && sal.max < salaryFloor) {
            return {
                ...job,
                location_type: locationType,
                salary_min: sal.min,
                salary_max: sal.max,
                salary_parseable: sal.parseable,
                is_eligible: false,
                discard_reason: 'Salary-Floor-Discard',
                target_status: 'Tier 4 / Low Match'
            };
        }
        
        // 4. Blacklist check
        const companyClean = job.company_name.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
        for (const blackName of blacklistNames) {
            const cleanBlack = blackName.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
            // Exact or fuzzy substring check
            if (companyClean.includes(cleanBlack) || cleanBlack.includes(companyClean)) {
                return {
                    ...job,
                    location_type: locationType,
                    is_eligible: false,
                    discard_reason: 'Blacklisted-Company',
                    target_status: 'Tier 4 / Low Match'
                };
            }
        }
        
        // 5. Description splitting / boilerplate removal
        const descScored = this.scrubBoilerplate(descFull);
        
        // 6. Scoring
        const toxicityScore = window.cultureEvaluator.evaluate(descScored);
        const skillMatchScore = window.skillMatcher.match(descScored, job.title);
        
        // Role title score
        let roleTitleScore = 0;
        const titleLower = (job.title || '').toLowerCase();
        const roleTerms = [
            "director", "vp", "vice president", "account executive", "account manager", 
            "business development", "sales operations", "revenue operations", 
            "operations manager", "sales manager"
        ];
        for (const term of roleTerms) {
            if (titleLower.includes(term)) {
                roleTitleScore = 5;
                break;
            }
        }
        
        const leverageRatio = Math.round(((skillMatchScore + roleTitleScore) / Math.max(1, toxicityScore)) * 100) / 100;
        
        // 7. Recency multiplier
        const days = job.days_since_posted || 0;
        const { mult, isStale } = this.getRecencyMultiplier(days, locationType);
        const finalLeverageRatio = Math.round(leverageRatio * mult * 100) / 100;
        
        // 8. Classification
        const seniority = this.detectSeniority(job.title, descFull);
        const industry = window.industryClassifier.classify(descFull);
        const atsScore = this.computeATSAlignmentScore(descFull, userProfile.resumeText);
        const applyType = this.detectApplyType(job.apply_url, descFull);
        
        // 9. Ghost job check
        const ghostPhrasesRe = /we are always looking|pipeline of candidates|future opportunities|talent community/i;
        const isGhost = (
            days >= 30 &&
            !sal.parseable &&
            ghostPhrasesRe.test(descFull)
        );
        
        return {
            ...job,
            description_scored: descScored,
            toxicity_score: toxicityScore,
            skill_match_score: skillMatchScore,
            role_title_score: roleTitleScore,
            leverage_ratio: leverageRatio,
            final_leverage_ratio: finalLeverageRatio,
            recency_multiplier: mult,
            is_stale: isStale,
            location_type: locationType,
            seniority_level: seniority,
            industry: industry,
            ats_alignment_score: atsScore,
            apply_type: applyType,
            salary_min: sal.min,
            salary_max: sal.max,
            salary_parseable: sal.parseable,
            is_ghost_job: isGhost,
            is_eligible: true,
            discard_reason: null
        };
    },

    // ── Recalculate percentiles for a batch of jobs ─────────────────
    recalculatePercentiles(jobsList) {
        const eligibleJobs = jobsList.filter(j => j.is_eligible === true);
        if (eligibleJobs.length === 0) return jobsList;
        
        const scores = eligibleJobs.map(j => j.final_leverage_ratio || 0.0);
        
        // Linear interpolation percentiles (mirroring python logic)
        const sortedScores = Array.from(new Set(scores)).sort((a, b) => a - b);
        const scoreToPct = {};
        
        sortedScores.forEach((s, idx) => {
            let pct = 100;
            if (sortedScores.length > 1) {
                pct = Math.round((idx / (sortedScores.length - 1)) * 100);
            }
            scoreToPct[s] = pct;
        });
        
        // Map percentiles and set target_status
        return jobsList.map(job => {
            if (job.is_eligible !== true) return job;
            
            const score = job.final_leverage_ratio || 0.0;
            const pct = scoreToPct[score] !== undefined ? scoreToPct[score] : 100;
            
            let tier = 'Tier 4 / Low Match';
            if (pct >= 80) tier = 'Tier 1 / Top Match';
            else if (pct >= 50) tier = 'Tier 2 / Strong Match';
            else if (pct >= 20) tier = 'Tier 3 / Moderate Match';
            
            return {
                ...job,
                match_percentile: pct,
                target_status: tier
            };
        });
    }
};

window.scoringCoordinator = scoringCoordinator; // Export globally
