// =====================================================================
// In-Browser Kill Switch Evaluator — evaluator.js
// =====================================================================

const EXCLUSION_LIST = {
    "MLM/Predatory": [
        "100% commission", "no experience necessary", "immediate hire",
        "door-to-door", "event marketing", "brand ambassador"
    ],
    "Regulated/Non-Relevant": [
        "cpa", "rn", "java developer", "unity developer", ".net"
    ],
    "Trades/Labor": [
        "cdl", "forklift", "hvac", "welder"
    ],
    "Clinical": [
        "phlebotomy", "lpn", "dental hygienist", "medical assistant"
    ]
};

// Helper to escape regex special chars
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Pre-compile patterns
const EXCLUSION_PATTERNS = {};

for (const [category, terms] of Object.entries(EXCLUSION_LIST)) {
    const parts = terms.map(term => {
        const escaped = escapeRegExp(term);
        const sb = /^[A-Za-z0-9]/.test(term) ? '\\b' : '';
        const eb = /[A-Za-z0-9]$/.test(term) ? '\\b' : '';
        return `${sb}${escaped}${eb}`;
    });
    EXCLUSION_PATTERNS[category] = new RegExp(parts.join('|'), 'i');
}

// Add complex trades patterns
const TRADES_COMPLEX_PATTERNS = [
    "\\bassembly\\s+(?:line|technician|worker|operator|floor)\\b",
    "\\bassembler\\b",
    "\\bwarehouse\\s+(?:worker|associate|staff|operator|picker|packer)\\b"
];
EXCLUSION_PATTERNS["Trades/Labor_Complex"] = new RegExp(TRADES_COMPLEX_PATTERNS.join('|'), 'i');

// Add Hard-Personal-Disqualifiers
const HARD_PERSONAL_PATTERNS = [
    // — Degree mandate —
    "bachelor'?s\\s+degree\\s+required",
    "\\bdegree\\s+required\\b",
    "\\bmust\\s+have\\s+a\\s+degree\\b",
    "\\bb\\.?s\\.?\\s+required\\b",
    "\\bb\\.?a\\.?\\s+required\\b",
    "\\b4.year\\s+degree\\b",
    "\\bcollege\\s+degree\\s+required\\b",
    "\\bminimum.*degree\\b",
    "\\bdegree.*required\\b",

    // — Travel requirement —
    "\\btravel\\s+required\\b",
    "\\btravel\\s+up\\s+to\\b",
    "\\bmust\\s+be\\s+willing\\s+to\\s+travel\\b",
    "\\bfrequent\\s+travel\\b",
    "\\b\\d{2,3}%\\s*travel\\b",
    "\\btravel\\s+regularly\\b",
    "\\bextensive\\s+travel\\b",
    "\\btravel\\s+is\\s+required\\b",

    // — Government / public sector —
    "\\bgovernment\\s+contractor\\b",
    "\\bfederal\\s+agency\\b",
    "\\bdod\\b",
    "\\bdepartment\\s+of\\s+homeland\\b",
    "\\bsecurity\\s+clearance\\b",
    "\\btop\\s+secret\\b",
    "\\bpublic\\s+sector\\b",
    "\\bmunicipal\\b",
    "\\bcounty\\s+government\\b",
    "\\bstate\\s+agency\\b",
    "\\bgsa\\s+schedule\\b"
];
EXCLUSION_PATTERNS["Hard-Personal-Disqualifier"] = new RegExp(HARD_PERSONAL_PATTERNS.join('|'), 'i');

const eligibilityEvaluator = {
    evaluateEligibility(text) {
        if (!text || text.trim() === '') {
            return { isEligible: false, discardReason: 'Empty Description' };
        }

        for (const [category, pattern] of Object.entries(EXCLUSION_PATTERNS)) {
            if (pattern.test(text)) {
                let displayCategory = category;
                if (category === 'Trades/Labor_Complex') displayCategory = 'Trades/Labor';
                return { isEligible: true, isToxic: true, discardReason: displayCategory };
            }
        }

        return { isEligible: true, isToxic: false, discardReason: null };
    }
};

window.eligibilityEvaluator = eligibilityEvaluator; // Export globally
