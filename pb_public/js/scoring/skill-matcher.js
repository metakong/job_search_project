// =====================================================================
// Technical Skill Matcher — skill-matcher.js
// =====================================================================

const WEIGHT_3_SKILLS = [
    "Salesforce", "Zoho", "HubSpot", "Revenue Operations", "RevOps",
    "Sales Operations", "Business Development", "CRM", "P&L",
    "Process Improvement", "Lead Generation", "B2B", "Go-to-Market",
    "Turnaround", "Workflow Automation", "Account Manager", "Account Executive",
    "Revenue Growth", "Revenue Generation", "Client Development", "Account Growth",
    "Sales Strategy", "Territory Management"
];

const WEIGHT_1_SKILLS = [
    "B2C", "Logistics", "Procurement", "SOP", "Quota", "Territory",
    "Contract Negotiation", "Enterprise", "Cold Calling", "Mentor",
    "Forecasting", "Data Quality", "Competitive Intelligence",
    "Microsoft Dynamics", "Power Automate", "Zapier", "Copywriting",
    "Operations Manager", "Event Management", "E-commerce",
    "Vendor Management", "Workforce Management",
    "KPI", "OKR", "Quota Attainment", "Nimble", "Pipedrive", 
    "Monday CRM", "Cold Outreach", "Account Retention"
];

// Helper to escape regex special chars
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Compile skill patterns
const COMPILED_SKILLS = [];

[...WEIGHT_3_SKILLS.map(s => [s, 3]), ...WEIGHT_1_SKILLS.map(s => [s, 1])].forEach(([skill, weight]) => {
    const escaped = escapeRegExp(skill);
    const sb = /^[A-Za-z0-9]/.test(skill) ? '\\b' : '';
    const eb = /[A-Za-z0-9]$/.test(skill) ? '\\b' : '';
    const pattern = new RegExp(`${sb}${escaped}${eb}`, 'i');
    COMPILED_SKILLS.push({ pattern, weight, skill });
});

const PIPELINE_RE = /\bpipeline\b/ig;
const PIPELINE_CONTEXT_RE = /\b(sales|revenue|deal|crm|account|quota)\b/i;

const skillMatcher = {
    match(text, jobTitle = '') {
        if (!text || text.trim() === '') return 0;
        
        let score = 0;
        
        // 1. Keyword scans (set-based matching: counts at most once)
        for (const { pattern, weight } of COMPILED_SKILLS) {
            if (pattern.test(text)) {
                score += weight;
            }
        }
        
        // 2. Proximity-gating for "pipeline"
        // Find all occurrences of "pipeline"
        PIPELINE_RE.lastIndex = 0; // Reset regex
        let match;
        while ((match = PIPELINE_RE.exec(text)) !== null) {
            const startIdx = Math.max(0, match.index - 60);
            const endIdx = Math.min(text.length, match.index + match[0].length + 60);
            const windowText = text.substring(startIdx, endIdx);
            
            if (PIPELINE_CONTEXT_RE.test(windowText)) {
                score += 3;
                break; // Limit to adding 3 points at most once
            }
        }
        
        // 3. Job title director check
        if (jobTitle && /\bdirector\b/i.test(jobTitle)) {
            score += 1;
        }
        
        return score;
    }
};

window.skillMatcher = skillMatcher; // Export globally
