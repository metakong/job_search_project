// =====================================================================
// Global Configuration — config.js
// =====================================================================

const CONFIG = {
    VERSION: '13.7.0',
    SCORING_CHUNK_SIZE: 25,
    FETCH_THROTTLE_MS: 500,
    FETCH_TIMEOUT_MS: 8000,      // per-attempt CORS fetch timeout (AbortController); keeps a fully-blocked sweep responsive
    WORKER_TIMEOUT_MS: 10000,

    // Indeed discontinued its public RSS feed years ago; the endpoint returns an
    // HTML/error page (never job XML) and is WAF/CORS-blocked on every proxy. It
    // only spammed the console with ~200 red errors and cost ~16s per sweep, so it
    // is OFF by default. A Phase-2 technical user with a working private proxy can
    // flip this back on.
    ENABLE_INDEED_RSS: false,

    // Salaries whose whole range tops out below this (annual, USD) are treated as
    // unparseable — almost always hourly-misreads or foreign-currency figures, not
    // real pay. (A separate absolute floor also rejects sub-$7k lower bounds.)
    SALARY_MIN_PLAUSIBLE_ANNUAL: 18000,

    // ── Distribution / zoning (Phase 13.4) ──────────────────────────────
    // Zones are defined by the two candidate-relative axes — résumé fit
    // (Delta-X) and trajectory (Delta-Y) — NOT by forced score percentiles.
    // Absolute fit gates below stop a starved/irrelevant pool from
    // "promoting the best of the worst" into Strike/Moonshot.
    INFERNO_TOXICITY_THRESHOLD: 50,  // matches evaluator.js INFERNO_THRESHOLD (calibrated)
    INFERNO_MAX_FRACTION: 0.40,      // safety cap: Inferno can never be the majority pile
    NOISE_FIT_FLOOR: 0.18,           // Delta-X below this = irrelevant → hidden (unless pool is all-weak)
    STRIKE_FIT_MIN: 0.40,            // Delta-X needed for the Strike Zone (well-aligned)
    MOONSHOT_FIT_MIN: 0.30,          // Delta-X needed to call a reach-up a Moonshot (not noise)
    LOW_VOLUME_THRESHOLD: 24,        // per-zone: below this, disable 1/3 slicing & show whole bucket

    STRATEGY_TIERS: { SURVIVAL: 1, BALANCED: 2, AGGRESSIVE: 3 },

    DEFAULT_CORS_PROXY: "https://corsproxy.io/?url=",

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
