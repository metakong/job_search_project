// =====================================================================
// In-Browser Kill Switch Evaluator — evaluator.js
// =====================================================================

const eligibilityEvaluator = {
    evaluateJob(job, userProfile) {
        const desc = (job.description_full || '').toLowerCase();
        let passLogistics = true;
        let toxicityScore = 0;
        let infernoCircle = null;

        // Logistical Gate (V_L)
        if (job.location_type === 'remote') {
            if (/\bmust be local\b|\bin office\b|\bhybrid\b/i.test(desc)) {
                passLogistics = false;
            }
        }

        // Toxicity Gate (V_T) & The 9 Circles
        const days = job.days_since_posted || 0;

        // Using if/else if to pick highest priority or just check sequentially
        // Will check in descending order of toxicity to ensure the highest score is kept if we use if/else if.
        // Actually, we can check all and keep the highest.
        
        let highestToxic = 0;
        let highestCircle = null;

        if (/\b100% commission\b|\bdoor-to-door\b|\bbe your own boss\b/i.test(desc)) {
            if (100 > highestToxic) { highestToxic = 100; highestCircle = "Circle 8: Fraud"; }
        }
        
        if (/\bwe're a family\b|\bwhatever it takes\b/i.test(desc)) {
            if (95 > highestToxic) { highestToxic = 95; highestCircle = "Circle 9: Treachery"; }
        }
        
        if (/\bunpaid trial\b|\btake-home assignment\b/i.test(desc)) {
            if (90 > highestToxic) { highestToxic = 90; highestCircle = "Circle 4: Greed"; }
        }
        
        if (/\bfast-paced\b|\bwear many hats\b|\bunder pressure\b/i.test(desc)) {
            if (85 > highestToxic) { highestToxic = 85; highestCircle = "Circle 5: Anger"; }
        }
        
        if (days > 30 && /always taking applications/i.test(desc)) {
            if (80 > highestToxic) { highestToxic = 80; highestCircle = "Circle 1: Limbo"; }
        }
        
        const lustMatch = desc.match(/\b(rockstar|ninja|guru)\b/ig);
        if (lustMatch && lustMatch.length >= 3) {
            if (80 > highestToxic) { highestToxic = 80; highestCircle = "Circle 2: Lust"; }
        }
        
        toxicityScore = highestToxic;
        infernoCircle = highestToxic > 75 ? highestCircle : null;

        return {
            passLogistics,
            toxicityScore,
            infernoCircle
        };
    }
};

window.eligibilityEvaluator = eligibilityEvaluator; // Export globally
