(function () {
    'use strict';

    const CATEGORY_MARKERS = {
        executive: /\b(director|vp|president|chief|head of|strategy|p[\&]?l|stakeholder|board|cross-functional|transformation)\b/gi,
        technical: /\b(engineer|developer|architect|python|java|react|api|cloud|aws|sql|system|deployment|infrastructure|backend|frontend)\b/gi,
        sales: /\b(quota|territory|commission|ae|account executive|closing|inbound|outbound|prospecting|arr|mrr|sales)\b/gi,
        operations: /\b(logistics|supply chain|sop|compliance|procurement|inventory|facility|vendor|operations)\b/gi,
        marketing: /\b(seo|campaign|content|brand|marketing|social media|hubspot|growth|acquisition)\b/gi
    };

    function computeAmbiguity(text) {
        if (!text || typeof text !== 'string') return 0;
        
        let counts = {};
        let totalHits = 0;

        for (const [category, regex] of Object.entries(CATEGORY_MARKERS)) {
            const matches = text.match(regex);
            const count = matches ? matches.length : 0;
            counts[category] = count;
            totalHits += count;
        }

        if (totalHits === 0) return 0;

        let entropy = 0;
        for (const count of Object.values(counts)) {
            if (count > 0) {
                const p = count / totalHits;
                entropy -= p * Math.log(p);
            }
        }

        const maxEntropy = Math.log(Object.keys(CATEGORY_MARKERS).length);
        return maxEntropy > 0 ? (entropy / maxEntropy) : 0;
    }

    window.ambiguityIndex = { compute: computeAmbiguity };
})();
