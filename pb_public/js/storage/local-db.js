// =====================================================================
// Local Dexie.js Database Initialization — local-db.js
// =====================================================================

// Load Dexie from global window namespace
const db = new Dexie('JobSearchDB');

// Define database schema
db.version(1).stores({
    job_listings: 'id, title, company_name, target_status, application_status, location_type, industry, is_ghost_job, is_duplicate, is_stale, days_since_posted, final_leverage_ratio, match_percentile, payload_hash, is_eligible, posted_at',
    blacklisted_companies: 'id, name, date_added',
    filter_profiles: 'id, profile_name',
    ats_watchlist: 'id, company_name, ats_type, active',
    source_health: 'id, source, status, last_checked',
    user_profile: 'id',
    embeddings: 'id, job_id'
});

console.log('[Storage] Dexie IndexedDB initialized.');
window.localDB = db; // Export to window for global availability
