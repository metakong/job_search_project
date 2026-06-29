// =====================================================================
// Corporate Culture Evaluator (Toxicity Scorer) — culture-evaluator.js
// =====================================================================

const DICT_CHAOS_BURNOUT = [
    ["high-intensity", 1], ["wear many hats", 1], ["under pressure", 1], ["total ambiguity", 1]
];

const DICT_EXPLOITATION_BOUNDARIES = [
    ["we're a family", 3], ["like family", 3], ["work hard, play hard", 3], ["selfless", 3], 
    ["whatever it takes", 3], ["extra mile", 3], ["flexible schedule required", 3]
];

const DICT_PUFFERY_IMMATURITY = [
    ["ninja", 1], ["rockstar", 1], ["guru", 1], ["wizard", 1], ["hustle", 1], 
    ["grind", 1], ["leave your ego", 1]
];

const DICT_BUREAUCRACY_RED_TAPE = [
    ["matrixed organization", 1], ["consensus-driven", 1], ["committee approval", 1], 
    ["strict adherence", 1], ["immutable", 1], ["reporting-heavy", 1]
];

const ALL_CULTURE_PHRASES = [
    ...DICT_CHAOS_BURNOUT,
    ...DICT_EXPLOITATION_BOUNDARIES,
    ...DICT_PUFFERY_IMMATURITY,
    ...DICT_BUREAUCRACY_RED_TAPE
];

// Helper to escape regex special chars
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Precompile regexes
const COMPILED_CULTURE_PHRASES = ALL_CULTURE_PHRASES.map(([phrase, weight]) => {
    const escaped = escapeRegExp(phrase);
    const sb = /^[A-Za-z0-9]/.test(phrase) ? '\\b' : '';
    const eb = /[A-Za-z0-9]$/.test(phrase) ? '\\b' : '';
    return {
        pattern: new RegExp(`${sb}${escaped}${eb}`, 'i'),
        weight,
        phrase
    };
});

const cultureEvaluator = {
    evaluate(text) {
        if (!text || text.trim() === '') return 0;
        
        let toxicityScore = 0;
        for (const { pattern, weight } of COMPILED_CULTURE_PHRASES) {
            if (pattern.test(text)) {
                toxicityScore += weight;
            }
        }
        
        return toxicityScore;
    }
};

window.cultureEvaluator = cultureEvaluator; // Export globally
