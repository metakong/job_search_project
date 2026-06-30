// =====================================================================
// Toxicity & Red-Flag Engine — evaluator.js
// =====================================================================
// Calibrated, additive, weighted detection of *genuinely* hazardous job
// postings. Design principles (grounded in 2024–2026 hiring red-flag
// research: FTC business-opportunity/MLM guidance, wage-theft / unpaid-work
// illegality, pay-transparency norms, and recruiting-community data):
//
//   1. A SINGLE weak cliché (e.g. "fast-paced") must NEVER banish a job to
//      Inferno. Weak signals only matter when they ACCUMULATE.
//   2. Strong scam / exploitation / illegal signals (unpaid trials, "wire
//      transfer", "purchase your own inventory") carry enough weight to
//      trigger alone or in pairs.
//   3. Inferno is reserved for a calibrated MINORITY of postings. The
//      threshold is validated by simulation (see scratch tests).
//
// evaluateJob() returns an additive toxicityScore (0–100), whether it crosses
// the Inferno threshold, the dominant "circle" (cause), and the matched
// signals (for transparent in-UI explanation).
// =====================================================================

(function () {
    'use strict';

    // Total weighted toxicity at/above which a posting is routed to Inferno.
    const INFERNO_THRESHOLD = 50;

    // Each signal: [regex, weight]. Grouped by Circle for dominant-cause attribution.
    const CIRCLES = [
        { name: "Circle 1: Limbo (Ghost Posting)", signals: [
            [/always (?:accepting|taking) applications/i, 15],
            [/building a (?:pipeline|pool|bench) of (?:candidates|talent|applicants)/i, 18],
            [/for future (?:opportunities|openings|consideration)/i, 14],
            [/we(?:'re| are) always hiring/i, 14],
            [/evergreen (?:role|req|requisition|position)/i, 16],
        ]},
        { name: "Circle 2: Lust (Puffery)", signals: [
            [/\brock\s?stars?\b/i, 7],
            [/\bninjas?\b/i, 7],
            [/\bgurus?\b/i, 6],
            [/\bwizards?\b/i, 6],
            [/\bsuperstars?\b/i, 6],
            [/\bunicorns?\b/i, 6],
            [/\bhustle\b/i, 8],
            [/\bgrind(?:ing)?\b/i, 8],
        ]},
        { name: "Circle 3: Gluttony (Overwork)", signals: [
            [/\b24\/7\b/i, 18],
            [/around the clock/i, 18],
            [/(?:evenings?|nights?) and weekends/i, 22],
            [/no clock.?watch/i, 20],
            [/we don'?t count (?:hours|the hours)/i, 22],
            [/whenever (?:the job|business) (?:requires|demands|needs)/i, 18],
            [/\bon.?call\b/i, 11],
        ]},
        { name: "Circle 4: Greed (Uncompensated Labor)", signals: [
            [/unpaid (?:trial|training|internship|work|labor)/i, 50],
            [/pay for your own (?:training|equipment|certification|background)/i, 50],
            [/(?:purchase|buy)(?: your own)? (?:inventory|starter kit|materials|product)/i, 52],
            [/100\s*%\s*commission/i, 32],
            [/commission.?only/i, 32],
            [/no base salary/i, 30],
            [/competitive (?:salary|pay|compensation)\b/i, 8],
        ]},
        { name: "Circle 5: Anger (Chaos & Pressure)", signals: [
            [/fast.?paced/i, 6],
            [/high.?pressure/i, 16],
            [/thrive under pressure/i, 16],
            [/wear(?:ing)? (?:many|multiple|several) hats/i, 15],
            [/(?:total|constant|comfortable with) ambiguity/i, 14],
            [/sink or swim/i, 24],
            [/trial by fire/i, 22],
            [/hit the ground running/i, 9],
        ]},
        { name: "Circle 6: Heresy (Cult Culture)", signals: [
            [/we(?:'re| are) (?:a |like a |one big )?family/i, 22],
            [/work family/i, 18],
            [/drink the kool.?aid/i, 22],
            [/work hard,? play hard/i, 14],
            [/passion(?:ate)? (?:over|before|instead of) (?:pay|money|salary)/i, 26],
            [/labor of love/i, 16],
            [/(?:more than a job|not just a job)[,;:]? (?:it'?s )?a (?:lifestyle|calling|mission)/i, 20],
        ]},
        { name: "Circle 7: Violence (Discrimination)", signals: [
            [/young and energetic/i, 32],
            [/recent grad(?:uate)?s? only/i, 30],
            [/digital native/i, 28],
            [/thick skin/i, 16],
            [/not for the faint of heart/i, 14],
        ]},
        { name: "Circle 8: Fraud (MLM / Biz-Opp)", signals: [
            [/be your own boss/i, 40],
            [/unlimited (?:income|earning potential|earnings)/i, 42],
            [/financial freedom/i, 30],
            [/ground[- ]floor opportunity/i, 36],
            [/door.?to.?door/i, 22],
            [/recruit (?:others|your own|new members|a team)/i, 38],
            [/build your (?:own )?(?:team|downline|organization)/i, 24],
            [/residual income/i, 34],
            [/no experience (?:necessary|required|needed)/i, 12],
            [/\$\s?\d{3,}(?:,\d{3})?\s?k?\s*(?:per|a|\/)\s*week/i, 28],
        ]},
        { name: "Circle 9: Treachery (Outright Scam)", signals: [
            [/wire transfer/i, 50],
            [/cashier'?s check/i, 55],
            [/send (?:money|payment|gift cards?|funds)/i, 58],
            [/this is not a scam/i, 50],
            [/bait.?and.?switch/i, 30],
            [/\bstarter kit\b/i, 35],
            [/(?:processing|application|onboarding) fee/i, 38],
        ]},
    ];

    const eligibilityEvaluator = {
        INFERNO_THRESHOLD,

        // job: a normalized listing (uses description_full, falls back to description).
        evaluateJob(job) {
            const desc = ((job && (job.description_full || job.description)) || '').toString();

            let total = 0;
            let bestCircle = null;
            let bestCircleScore = 0;
            const signals = [];

            for (const circle of CIRCLES) {
                let circleScore = 0;
                for (const [re, w] of circle.signals) {
                    if (re.test(desc)) {
                        circleScore += w;
                        total += w;
                        signals.push({ circle: circle.name, weight: w });
                    }
                }
                if (circleScore > bestCircleScore) {
                    bestCircleScore = circleScore;
                    bestCircle = circle.name;
                }
            }

            const toxicityScore = Math.min(100, total);
            const isInferno = toxicityScore >= INFERNO_THRESHOLD;

            return {
                toxicityScore,
                isInferno,
                infernoCircle: isInferno ? bestCircle : null,
                signals,
                passLogistics: true, // retained for backward compatibility
            };
        }
    };

    window.eligibilityEvaluator = eligibilityEvaluator; // Export globally
})();
