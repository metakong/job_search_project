// =====================================================================
// Global Configuration — config.js
// =====================================================================

const CONFIG = {
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
