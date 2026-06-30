// =====================================================================
// Global Configuration — config.js
// =====================================================================

const CONFIG = {
    VERSION: '13.0.0',
    SCORING_CHUNK_SIZE: 25,
    FETCH_THROTTLE_MS: 500,
    WORKER_TIMEOUT_MS: 10000,
    MIN_TOXICITY_FLOOR: 75.0,
    INFERNO_PERCENTILE: 84,
    MIN_CLEAN_POOL_FOR_DISTRIBUTION: 9,
    STRATEGY_TIERS: { SURVIVAL: 1, BALANCED: 2, AGGRESSIVE: 3 },

    DEFAULT_CORS_PROXY: "https://corsproxy.io/?",
    
    async getCORSProxy() {
        try {
            if (window.dbAdapter) {
                const profile = await window.dbAdapter.getUserProfile();
                if (profile && profile.corsProxyOverride && profile.corsProxyOverride.trim() !== '') {
                    return profile.corsProxyOverride.trim();
                }
            }
        } catch (e) {
            console.warn('[Config] Failed to read user profile for CORS proxy, using default.', e);
        }
        return this.DEFAULT_CORS_PROXY;
    },
    
    DEFAULT_SEARCH_QUERIES: [
        '"Business Development" OR "Revenue Operations" OR "Sales Director" OR "Consultative Sales"',
        '"Operations Manager" OR "Process Improvement" OR "Turnaround" OR "Strategy"',
        '"AI Evaluator" OR "Systems Architecture" OR "Data Operations"'
    ]
};

window.CONFIG = CONFIG;
