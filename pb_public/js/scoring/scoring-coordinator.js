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
        
        const companyClean = (job.company_name || '').toLowerCase().trim().replace(/[^a-z0-9]/g, '');
        let isBlacklisted = false;
        for (const blackName of blacklistNames) {
            const cleanBlack = blackName.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
            if (companyClean.includes(cleanBlack) || cleanBlack.includes(companyClean)) {
                isBlacklisted = true;
                break;
            }
        }

        job.location_type = this.classifyLocationType(descFull, job.job_location || '');
        const sal = this.parseSalary(descFull);
        job.salary_min = sal.min;
        job.salary_max = sal.max;
        job.salary_parseable = sal.parseable;
        job.salary_mid = sal.parseable ? (sal.min + sal.max) / 2 : 0;
        
        const descScored = this.scrubBoilerplate(descFull);
        const skillMatchScore = window.skillMatcher.match(descScored, job.title);
        job.skill_match_score = skillMatchScore;
        job.seniority_level = this.detectSeniority(job.title, descFull);
        job.ats_alignment_score = this.computeATSAlignmentScore(descFull, userProfile.resumeText);
        job.apply_type = this.detectApplyType(job.apply_url, descFull);
        job.industry = window.industryClassifier.classify(descFull);
        job.is_eligible = !isBlacklisted;
        job.discard_reason = isBlacklisted ? 'Blacklisted-Company' : null;
        
        const strategy = parseInt(userProfile.strategyDial || 2);
        let matrixState = ''; // Holds the exact 1-of-36 category
        
        // 1. GATES ($V_L$ and $V_T$)
        const evalData = window.eligibilityEvaluator.evaluateJob(job, userProfile);
        job.toxicity_score = evalData.toxicityScore;

        if (!evalData.passLogistics) {
            job.computed_zone = 'noise';
            job.matrix_state = `strategy_${strategy}_noise_logistics_failed`;
            return job;
        }
        if (evalData.toxicityScore > 75) {
            job.computed_zone = 'inferno';
            job.inferno_circle = evalData.infernoCircle;
            job.matrix_state = `strategy_${strategy}_inferno_circle_${evalData.infernoCircle.split(':')[0].replace(/ /g, '')}`;
            return job;
        }

        // 2. SEMANTIC VECTOR ($V_S$) [0 to 1 scale]
        // Normalize keyword match, subtract penalty for missing hard constraints
        let vS = Math.min(1.0, (skillMatchScore || 0) / 5.0);
        if (vS < 0.15) { 
            job.computed_zone = 'noise'; 
            job.matrix_state = `strategy_${strategy}_noise_low_semantic`;
            return job; 
        }

        // 3. TRAJECTORY DELTA ($\Delta T$)
        const senMap = { 'director': 4, 'manager': 3, 'senior': 2, 'entry': 1, 'unspecified': 2 };
        const jobSenVal = senMap[job.seniority_level] || 2;
        const userSenVal = userProfile.baselineSeniority || 2;
        const deltaT = jobSenVal - userSenVal;

        // 4. ECONOMIC VECTOR ($V_E$) & CULTURE VECTOR ($V_P$) [0 to 1 scale]
        // Fallback to 0.5 (neutral) if API data is missing salary or culture flags
        let vE = 0.5; 
        if (job.salary_mid && userProfile.salaryFloor) {
            vE = Math.min(1.2, job.salary_mid / userProfile.salaryFloor);
        }
        let vP = 0.5; // Placeholder for culture alignment
        
        // 5. CORE SCORE (C) [0 to 100]
        // Weighted: 50% Skill, 25% Money, 25% Culture
        const coreScore = Math.round(((vS * 0.50) + (vE * 0.25) + (vP * 0.25)) * 100);
        job.match_score = coreScore; // Update UI score to the new Core Score

        // STEP 3: THE STRATEGY DIAL ROUTER (36-STATE LOGIC)
        let computedZone = 'noise';
        
        if (strategy === 1) { 
            // SURVIVAL MODE (Desperate: Accepts massive step-downs, lower score thresholds)
            if (coreScore > 65 && deltaT < 0) { computedZone = 'safety'; }
            else if (coreScore > 50 && deltaT >= 0) { computedZone = 'strike'; }
            else if (coreScore > 40 && deltaT > 0) { computedZone = 'moonshot'; }
        } 
        else if (strategy === 3) { 
            // AGGRESSIVE MODE (Confident: Pushes lateral moves to safety, demands high growth)
            if (coreScore > 85 && deltaT <= 0) { computedZone = 'safety'; }
            else if (coreScore > 75 && deltaT === 1) { computedZone = 'strike'; }
            else if (coreScore > 50 && deltaT > 0) { computedZone = 'moonshot'; }
        } 
        else { 
            // BALANCED MODE (Standard: Strict Strike Zone, distinct safety/moonshot bounds)
            if (coreScore > 80 && deltaT < 0) { computedZone = 'safety'; }
            else if (coreScore > 70 && deltaT >= 0 && deltaT <= 1) { computedZone = 'strike'; }
            else if (coreScore > 60 && deltaT > 1) { computedZone = 'moonshot'; }
        }

        job.computed_zone = computedZone;
        job.matrix_state = `strategy_${strategy}_zone_${computedZone}`;
        job.delta_x = vS;
        job.delta_y = deltaT;

        return job;
    },

    // ── Recalculate percentiles for a batch of jobs ─────────────────
    recalculatePercentiles(jobsList, strategyDialVal = 2) {
        const eligibleJobs = jobsList.filter(j => j.is_eligible === true);
        if (eligibleJobs.length === 0) return jobsList;
        
        const scores = eligibleJobs.map(j => j.match_score || 0);
        const sortedScores = Array.from(new Set(scores)).sort((a, b) => a - b);
        const scoreToPct = {};
        
        sortedScores.forEach((s, idx) => {
            let pct = 100;
            if (sortedScores.length > 1) {
                pct = Math.round((idx / (sortedScores.length - 1)) * 100);
            }
            scoreToPct[s] = pct;
        });
        
        // Map percentiles, apply strategy-based zone allocation
        return jobsList.map(job => {
            if (job.is_eligible !== true) return job;
            
            const score = job.match_score || 0;
            const pct = scoreToPct[score] !== undefined ? scoreToPct[score] : 100;
            
            let tier = 'Tier 3 / Moderate Match';
            if (pct >= 80) tier = 'Tier 1 / Top Match';
            else if (pct >= 50) tier = 'Tier 2 / Strong Match';
            else if (pct >= 20) tier = 'Tier 3 / Moderate Match';
            else tier = 'Tier 4 / Low Match';

            // Reset matches to base zone unless classified as inferno or noise
            let finalZone = job.computed_zone;
            const strategy = parseInt(strategyDialVal || 2);

            if (finalZone !== "inferno" && finalZone !== "noise" && job.matrix_state && !job.matrix_state.includes('noise_logistics_failed') && !job.matrix_state.includes('noise_low_semantic')) {
                // Apply Strategy Dial Modifiers via 36-State Logic
                const coreScore = job.match_score || 0;
                const deltaT = job.delta_y || 0;
                
                if (strategy === 1) { 
                    if (coreScore > 65 && deltaT < 0) { finalZone = 'safety'; }
                    else if (coreScore > 50 && deltaT >= 0) { finalZone = 'strike'; }
                    else if (coreScore > 40 && deltaT > 0) { finalZone = 'moonshot'; }
                    else { finalZone = 'noise'; }
                } 
                else if (strategy === 3) { 
                    if (coreScore > 85 && deltaT <= 0) { finalZone = 'safety'; }
                    else if (coreScore > 75 && deltaT === 1) { finalZone = 'strike'; }
                    else if (coreScore > 50 && deltaT > 0) { finalZone = 'moonshot'; }
                    else { finalZone = 'noise'; }
                } 
                else { 
                    if (coreScore > 80 && deltaT < 0) { finalZone = 'safety'; }
                    else if (coreScore > 70 && deltaT >= 0 && deltaT <= 1) { finalZone = 'strike'; }
                    else if (coreScore > 60 && deltaT > 1) { finalZone = 'moonshot'; }
                    else { finalZone = 'noise'; }
                }
                job.matrix_state = `strategy_${strategy}_zone_${finalZone}`;
            }
            
            return {
                ...job,
                match_percentile: pct,
                target_status: tier,
                computed_zone: finalZone
            };
        });
    }
};

window.scoringCoordinator = scoringCoordinator; // Export globally
