// =====================================================================
// Industry Classifier — industry-classifier.js
// =====================================================================

const INDUSTRY_TAXONOMY = [
    ["saas_tech", [
        "saas", "software platform", "\\bapi\\b", "cloud software",
        "tech startup", "b2b software"
    ]],
    ["telecom", [
        "wireless", "carrier", "telecom", "cell tower",
        "spectrum", "infrastructure"
    ]],
    ["logistics_supply_chain", [
        "supply chain", "freight", "distribution", "\\b3pl\\b",
        "\\bfleet\\b", "shipping", "fulfillment"
    ]],
    ["finance_fintech", [
        "fintech", "financial services", "lending", "payments",
        "banking", "insurance"
    ]],
    ["real_estate", [
        "commercial real estate", "property management",
        "\\breit\\b", "brokerage", "leasing"
    ]],
    ["healthcare_tech", [
        "health tech", "digital health", "\\bemr\\b", "healthcare software"
    ]],
    ["manufacturing", [
        "manufacturing", "industrial", "plant operations",
        "production", "fabrication"
    ]],
    ["retail_e_commerce", [
        "retail", "e-commerce", "\\bdtc\\b", "marketplace", "consumer goods"
    ]],
    ["staffing_hr", [
        "staffing", "recruiting", "talent acquisition",
        "\\bhr\\b", "human resources"
    ]],
    ["ai_tech", [
        "artificial intelligence", "machine learning", "\\bllm\\b",
        "ai platform", "automation platform"
    ]]
];

// Helper to escape regex special chars
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Precompile regexes: first match wins
const COMPILED_INDUSTRIES = INDUSTRY_TAXONOMY.map(([tag, keywords]) => {
    const parts = keywords.map(kw => {
        if (kw.startsWith('\\b') || kw.startsWith('(')) {
            return kw;
        } else {
            const escaped = escapeRegExp(kw);
            const sb = /^[A-Za-z0-9]/.test(kw) ? '\\b' : '';
            const eb = /[A-Za-z0-9]$/.test(kw) ? '\\b' : '';
            return `${sb}${escaped}${eb}`;
        }
    });
    return {
        tag,
        pattern: new RegExp(parts.join('|'), 'i')
    };
});

const industryClassifier = {
    classify(descriptionFull) {
        if (!descriptionFull || descriptionFull.trim() === '') return 'other';
        
        for (const { tag, pattern } of COMPILED_INDUSTRIES) {
            if (pattern.test(descriptionFull)) {
                return tag;
            }
        }
        
        return 'other';
    }
};

window.industryClassifier = industryClassifier; // Export globally
