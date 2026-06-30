// =====================================================================
// Skill / Résumé Matcher — skill-matcher.js
// =====================================================================
// The PRIMARY matching signal is candidate-driven: how much of the
// candidate's own résumé vocabulary (or, if no résumé, their chosen search
// terms) appears in a job. The built-in skill list is only a supplement so the
// tool still works (weakly) before a résumé is uploaded. This is what lets the
// platform serve ANY candidate rather than one hardcoded persona.
// =====================================================================

(function () {
    'use strict';

    // Supplementary high-signal skills (cross-domain, weighted). Used mainly when
    // no résumé is present; a small boost otherwise.
    const WEIGHT_3_SKILLS = [
        "Salesforce", "HubSpot", "Revenue Operations", "RevOps", "Sales Operations",
        "Business Development", "Account Executive", "Project Management", "Product Management",
        "Data Analysis", "Software Engineering", "Customer Success", "Operations Management",
        "Process Improvement", "Go-to-Market", "Financial Analysis", "Supply Chain",
        "Marketing Strategy", "Program Management", "Engineering", "Accounting"
    ];

    const WEIGHT_1_SKILLS = [
        "CRM", "B2B", "B2C", "Logistics", "Procurement", "SOP", "Quota", "Territory",
        "Contract Negotiation", "Forecasting", "KPI", "OKR", "Python", "SQL", "Excel",
        "Tableau", "Power BI", "Zapier", "Cold Outreach", "Account Management",
        "Vendor Management", "Stakeholder Management", "Budgeting", "Recruiting",
        "Customer Service", "E-commerce", "Compliance", "Onboarding"
    ];

    // Common English + résumé/job-posting filler that carries no matching signal.
    const STOPWORDS = new Set([
        "the","and","for","with","that","this","from","have","were","are","you","your",
        "our","will","has","was","who","all","any","can","not","but","they","their","them",
        "his","her","its","out","use","using","used","one","two","new","may","per","via",
        "work","working","experience","experienced","team","teams","role","roles","job","jobs",
        "ability","able","skill","skills","strong","excellent","including","include","includes",
        "looking","seeking","ideal","candidate","candidates","responsibilities","requirements",
        "required","preferred","plus","etc","years","year","based","help","make","made","across",
        "within","while","into","also","such","each","more","most","than","then","over","under",
        "company","companies","business","businesses","customer","customers","client","clients",
        "must","should","would","could","need","needs","want","like","well","good","great"
    ]);

    function escapeRegExp(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // Compile supplementary skill patterns.
    const COMPILED_SKILLS = [];
    [...WEIGHT_3_SKILLS.map(s => [s, 3]), ...WEIGHT_1_SKILLS.map(s => [s, 1])].forEach(([skill, weight]) => {
        const escaped = escapeRegExp(skill);
        const sb = /^[A-Za-z0-9]/.test(skill) ? '\\b' : '';
        const eb = /[A-Za-z0-9]$/.test(skill) ? '\\b' : '';
        COMPILED_SKILLS.push({ pattern: new RegExp(`${sb}${escaped}${eb}`, 'i'), weight });
    });

    const PIPELINE_RE = /\bpipeline\b/ig;
    const PIPELINE_CONTEXT_RE = /\b(sales|revenue|deal|crm|account|quota|data|ci\/cd|deploy)\b/i;

    function tokenize(text) {
        return ((text || '').toLowerCase().match(/[a-z][a-z+#.]{2,}/g)) || [];
    }

    const skillMatcher = {
        // Built-in weighted supplementary score (integer). Not normalized.
        match(text, jobTitle = '') {
            if (!text || text.trim() === '') return 0;
            let score = 0;

            for (const { pattern, weight } of COMPILED_SKILLS) {
                if (pattern.test(text)) score += weight;
            }

            // Proximity-gate the noisy word "pipeline" so it only counts in a relevant context.
            PIPELINE_RE.lastIndex = 0;
            let m;
            while ((m = PIPELINE_RE.exec(text)) !== null) {
                const win = text.substring(Math.max(0, m.index - 60), m.index + m[0].length + 60);
                if (PIPELINE_CONTEXT_RE.test(win)) { score += 2; break; }
            }

            if (jobTitle && /\b(director|head|vp|chief)\b/i.test(jobTitle)) score += 1;
            return score;
        },

        // Extract a candidate's signature keywords (top N by frequency) from text.
        // Works on résumé text OR on a blob of the user's search queries.
        extractKeywords(text, maxKeywords = 60) {
            const freq = new Map();
            for (const tok of tokenize(text)) {
                if (tok.length < 4 || STOPWORDS.has(tok)) continue;
                freq.set(tok, (freq.get(tok) || 0) + 1);
            }
            return Array.from(freq.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, maxKeywords)
                .map(([w]) => w);
        },

        // Asymmetric overlap (0..1): fraction of the candidate's signature keywords
        // that appear in the job text. Substring match acts as lightweight stemming
        // (e.g. "manage" matches "management").
        overlapRatio(jobText, keywords) {
            if (!keywords || keywords.length === 0) return 0;
            const hay = (jobText || '').toLowerCase();
            if (!hay) return 0;
            let hits = 0;
            for (const kw of keywords) {
                if (hay.includes(kw)) hits++;
            }
            return hits / keywords.length;
        },
        
        computeATSScore(jobText, hardKeywords) {
            return this.overlapRatio(jobText, hardKeywords);
        },

        computeWeightedOverlap(resumeSkills, softSkills, jobText, ambiguityIndex) {
            const hardOverlap = this.overlapRatio(jobText, resumeSkills);
            const softOverlap = this.overlapRatio(jobText, softSkills);
            const AI = ambiguityIndex || 0;
            return (1 - 0.3 * AI) * hardOverlap + (0.3 * AI) * softOverlap;
        }
    };

    window.skillMatcher = skillMatcher; // Export globally
})();
