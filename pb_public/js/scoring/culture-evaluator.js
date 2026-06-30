// =====================================================================
// Corporate Culture Vector — culture-evaluator.js
// =====================================================================
// Returns a culture score in [0, 1] where 1 = healthy/green and 0 = hostile.
// This feeds the Core Score's culture component directly (it is no longer a
// hardcoded placeholder). It deliberately REWARDS candidate-positive signals —
// pay transparency above all — rather than only punishing red flags. Heavy
// toxicity (scams, exploitation) is handled separately by evaluator.js; here we
// only nudge culture for the milder "yellow flags".
// =====================================================================

(function () {
    'use strict';

    // Green flags RAISE the score. Explicit salary ranges are weighted most
    // heavily: pay transparency is the strongest candidate-positive signal and
    // is legally mandated in a growing number of jurisdictions.
    const GREEN = [
        [/\$\s?\d{2,3}(?:,?\d{3})?\s?k?\s*(?:-|–|—|to)\s*\$?\s?\d{2,3}(?:,?\d{3})?\s?k?/i, 0.25],
        [/work.?life balance/i, 0.12],
        [/(?:flexible|flex)\s+(?:hours|schedule|work|working)/i, 0.10],
        [/4.?day work\s?week/i, 0.15],
        [/(?:professional|career)\s+(?:development|growth|advancement)/i, 0.08],
        [/mentor(?:ship|ing)/i, 0.07],
        [/parental leave|maternity|paternity/i, 0.10],
        [/mental health/i, 0.10],
        [/(?:health|dental|vision)\s+(?:insurance|coverage|benefits)/i, 0.06],
        [/\bequity\b|stock options|\brsus?\b/i, 0.07],
        [/paid (?:time off|vacation|holidays)/i, 0.05],
        [/\bremote(?:[- ](?:first|friendly))?\b/i, 0.05],
    ];

    // Yellow flags LOWER the score (mild; the heavy stuff lives in evaluator.js).
    const YELLOW = [
        [/fast.?paced/i, -0.06],
        [/wear(?:ing)? (?:many|multiple) hats/i, -0.10],
        [/we(?:'re| are) (?:a |like a |one big )?family/i, -0.12],
        [/\brock\s?stars?\b|\bninjas?\b|\bgurus?\b/i, -0.05],
        [/\bhustle\b|\bgrind\b/i, -0.07],
        [/high.?pressure|thrive under pressure/i, -0.10],
        [/competitive (?:salary|pay|compensation)/i, -0.05],
        [/self.?starter/i, -0.04],
    ];

    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

    const cultureEvaluator = {
        // Returns { cultureScore: 0..1, greenFlags: [], yellowFlags: [] }.
        evaluate(text) {
            const desc = (text || '').toString();
            if (!desc.trim()) return { cultureScore: 0.5, greenFlags: [], yellowFlags: [] };

            let score = 0.5; // neutral baseline
            const greenFlags = [];
            const yellowFlags = [];

            for (const [re, delta] of GREEN) {
                if (re.test(desc)) { score += delta; greenFlags.push(re.source); }
            }
            for (const [re, delta] of YELLOW) {
                if (re.test(desc)) { score += delta; yellowFlags.push(re.source); }
            }

            return { cultureScore: clamp(score, 0, 1), greenFlags, yellowFlags };
        }
    };

    window.cultureEvaluator = cultureEvaluator; // Export globally
})();
