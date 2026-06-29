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
        
        // 1. Kill Switch - We soft-evaluate. Even if toxic, is_eligible remains true but zone = inferno.
        const elig = window.eligibilityEvaluator.evaluateEligibility(descFull);
        let toxicReason = elig.discardReason;
        let isToxic = elig.isToxic || false;
        
        const locationType = this.classifyLocationType(descFull, job.job_location || '');
        const sal = this.parseSalary(descFull);
        const salaryFloor = userProfile.salaryFloor || 40000;
        
        // 2. Blacklist check - soft flag or hard drop? The prompt says "Dismantle the Hard Drop Switch: Do not let evaluator.js drop records from the data stream. Instead, re-target its regex arrays to classify toxic listings directly into the 9 Circles".
        // Let's keep company blacklist drops as hard drops or soft flags? Standard practice is company blacklist remains hard drop unless specified, but let's check. Wait! Blacklisted companies can be categorized or dropped. Let's keep the user's explicit blacklisted companies as is.
        const companyClean = job.company_name.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
        let isBlacklisted = false;
        for (const blackName of blacklistNames) {
            const cleanBlack = blackName.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
            if (companyClean.includes(cleanBlack) || cleanBlack.includes(companyClean)) {
                isBlacklisted = true;
                break;
            }
        }
        
        const descScored = this.scrubBoilerplate(descFull);
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
        
        // Recency multiplier
        const days = job.days_since_posted || 0;
        const { mult, isStale } = this.getRecencyMultiplier(days, locationType);
        const finalLeverageRatio = Math.round(leverageRatio * mult * 100) / 100;
        
        // Classification
        const seniority = this.detectSeniority(job.title, descFull);
        const industry = window.industryClassifier.classify(descFull);
        const atsScore = this.computeATSAlignmentScore(descFull, userProfile.resumeText);
        const applyType = this.detectApplyType(job.apply_url, descFull);
        
        // Ghost job check
        const ghostPhrasesRe = /we are always looking|pipeline of candidates|future opportunities|talent community/i;
        const isGhost = (
            days >= 30 &&
            !sal.parseable &&
            ghostPhrasesRe.test(descFull)
        );

        // --- Dante's 9 Circles Banishment Logic ---
        let computedZone = "strike"; // Default zone
        let infernoCircle = null; // Metadata for circle of hell

        // Define seniorities
        const seniorityMap = { director: 4, manager: 3, senior: 2, entry: 1, unspecified: 1 };
        const jobSeniorityInt = seniorityMap[seniority];
        const userSeniorityInt = userProfile.user_baseline_seniority || 1;

        // Triggers for Circles of Hell
        // Circle 1: Limbo (Ghost Jobs)
        if (days >= 30 && !sal.parseable && ghostPhrasesRe.test(descFull)) {
            computedZone = "inferno";
            infernoCircle = "Circle 1: Limbo (The Ghost Jobs) - Unfunded resume collection pipeline";
        }
        // Circle 2: Lust (Rockstar Illusion)
        else if ((descFull.match(/\b(ninja|rockstar|guru|wizard|hustle|grind)\b/ig) || []).length >= 3) {
            computedZone = "inferno";
            infernoCircle = "Circle 2: Lust (The 'Rockstar' Illusion) - Excessive puffery and exploitation keywords";
        }
        // Circle 3: Gluttony (Bait-and-Switch Remote)
        else if (locationType === 'remote' && /\bmust be local\b|\bin office required\b|\bdays in office\b/i.test(descFull)) {
            computedZone = "inferno";
            infernoCircle = "Circle 3: Gluttony (The Bait-and-Switch Remote) - Advertised remote requires local presence";
        }
        // Circle 4: Greed (Endless Assessment)
        else if (/\btake-home assignment\b|\b5-part project\b|\btechnical trial\b|\bunpaid test\b/i.test(descFull)) {
            computedZone = "inferno";
            infernoCircle = "Circle 4: Greed (The Endless Assessment) - Demands unpaid custom spec work";
        }
        // Circle 5: Anger (Burnout Boiler Room)
        else if (/\bhigh-intensity\b|\bwear many hats\b|\bunder pressure\b|\btotal ambiguity\b/i.test(descFull)) {
            computedZone = "inferno";
            infernoCircle = "Circle 5: Anger (The Burnout Boiler Room) - Confirmed chaos and structural overwork";
        }
        // Circle 6: Heresy (Entry-Level Paradox)
        else if ((titleLower.includes("entry level") || titleLower.includes("junior")) && /\b3-5 years experience\b|\bbachelor's degree required\b|\bdegree required\b/i.test(descFull)) {
            computedZone = "inferno";
            infernoCircle = "Circle 6: Heresy (The Entry-Level Paradox) - Entry-level title requiring senior parameters";
        }
        // Circle 7: Violence (Bureaucratic Grind)
        else if (/\bmatrixed organization\b|\bconsensus-driven\b|\bcommittee approval\b|\bstrict adherence\b/i.test(descFull)) {
            computedZone = "inferno";
            infernoCircle = "Circle 7: Violence (The Bureaucratic Grind) - Paralyzing red tape and corporate matrix locks";
        }
        // Circle 8: Fraud (MLM Pyramid)
        else if (/\b100% commission\b|\bdoor-to-door\b|\bimmediate hire\b|\bno experience necessary\b/i.test(descFull)) {
            computedZone = "inferno";
            infernoCircle = "Circle 8: Fraud (The MLM Pyramid) - Predatory sales structure masquerading as stable career path";
        }
        // Circle 9: Treachery (Family Trap)
        else if (/\bwe're a family\b|\blike family\b|\bselfless dedication\b|\bwhatever it takes\b/i.test(descFull)) {
            computedZone = "inferno";
            infernoCircle = "Circle 9: Treachery (The 'We're a Family' Trap) - Emotional boundary manipulation and overwork";
        }
        // General fallback if evaluateEligibility flagged it as toxic but no specific circle hit
        else if (isToxic) {
            computedZone = "inferno";
            infernoCircle = `Inferno: Category ${toxicReason || "Toxicity Red Flags"}`;
        }

        // --- Relative Delta Math for non-inferno listings ---
        const isInferno = (computedZone === 'inferno');

        // 1. Establish Numeric Seniority Values
        const senMap = { 'director': 4, 'manager': 3, 'senior': 2, 'entry': 1, 'unspecified': 2 };
        const jobSenVal = senMap[seniority] || 2;
        const userSenVal = userProfile.baselineSeniority || 2;
        
        // 2. Calculate Deltas
        let deltaY = jobSenVal - userSenVal; // Positive = Step up, Negative = Step down
        // Normalize Skill Match: 5+ matches = 100% (1.0)
        let deltaX = Math.min(1.0, (skillMatchScore || 0) / 5.0); 

        // 3. Apply Strategy Categorization
        const strategy = parseInt(userProfile.strategyDial || 2);
        
        if (strategy === 1) { // Survival Mode
            if (deltaY < 0 && deltaX >= 0.4) computedZone = 'safety';
            else if (deltaY > 0) computedZone = 'moonshot';
            else computedZone = 'strike';
        } else if (strategy === 3) { // Aggressive Growth
            if (deltaY > 0 || deltaX < 0.6) computedZone = 'moonshot';
            else if (deltaY < 0 && deltaX >= 0.8) computedZone = 'safety';
            else computedZone = 'strike';
        } else { // Balanced Mode
            if (deltaY < 0 && deltaX >= 0.8) computedZone = 'safety';
            else if (deltaY > 0 || deltaX < 0.4) computedZone = 'moonshot';
            else computedZone = 'strike';
        }
        
        // 4. Dante's Inferno Override (Must supersede all above logic)
        if (isInferno) { computedZone = 'inferno'; }

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
            is_eligible: !isBlacklisted, // Hard drop only on company blacklist
            discard_reason: isBlacklisted ? 'Blacklisted-Company' : null,
            computed_zone: computedZone,
            inferno_circle: infernoCircle,
            delta_x: deltaX,
            delta_y: deltaY
        };
    },

    // ── Recalculate percentiles for a batch of jobs ─────────────────
    recalculatePercentiles(jobsList, strategyDialVal = 2) {
        const eligibleJobs = jobsList.filter(j => j.is_eligible === true);
        if (eligibleJobs.length === 0) return jobsList;
        
        const scores = eligibleJobs.map(j => j.final_leverage_ratio || 0.0);
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
            
            const score = job.final_leverage_ratio || 0.0;
            const pct = scoreToPct[score] !== undefined ? scoreToPct[score] : 100;
            
            let tier = 'Tier 3 / Moderate Match';
            if (pct >= 80) tier = 'Tier 1 / Top Match';
            else if (pct >= 50) tier = 'Tier 2 / Strong Match';
            else if (pct >= 20) tier = 'Tier 3 / Moderate Match';
            else tier = 'Tier 4 / Low Match';

            // Reset matches to base zone unless classified as inferno
            let finalZone = job.computed_zone;
            if (finalZone !== "inferno") {
                // Apply Strategy Dial Modifiers
                const strategy = parseInt(strategyDialVal || 2);
                const dY = job.delta_y || 0;
                const dX = job.delta_x || 0;
                
                if (strategy === 1) { // Survival Mode
                    if (dY < 0 && dX >= 0.4) finalZone = 'safety';
                    else if (dY > 0) finalZone = 'moonshot';
                    else finalZone = 'strike';
                } else if (strategy === 3) { // Aggressive Growth
                    if (dY > 0 || dX < 0.6) finalZone = 'moonshot';
                    else if (dY < 0 && dX >= 0.8) finalZone = 'safety';
                    else finalZone = 'strike';
                } else { // Balanced Mode
                    if (dY < 0 && dX >= 0.8) finalZone = 'safety';
                    else if (dY > 0 || dX < 0.4) finalZone = 'moonshot';
                    else finalZone = 'strike';
                }
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
