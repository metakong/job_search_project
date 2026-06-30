// =====================================================================
// Local Dexie.js Database Initialization — local-db.js
// =====================================================================

const db = new Dexie('JobSearchDB');

// v1 — original schema (kept so existing users migrate cleanly).
db.version(1).stores({
    job_listings: 'id, title, company_name, target_status, application_status, location_type, industry, is_ghost_job, is_duplicate, is_stale, days_since_posted, final_leverage_ratio, match_percentile, payload_hash, is_eligible, posted_at',
    blacklisted_companies: 'id, name, date_added',
    filter_profiles: 'id, profile_name',
    ats_watchlist: 'id, company_name, ats_type, active',
    source_health: 'id, source, status, last_checked',
    user_profile: 'id',
    embeddings: 'id, job_id'
});

// v2 — index the fields actually queried/sorted today; drop the unused
// source_health store and the dead final_leverage_ratio index. Dexie preserves
// existing rows across this upgrade.
db.version(2).stores({
    job_listings: 'id, title, company_name, application_status, computed_zone, location_type, industry, is_ghost_job, is_eligible, days_since_posted, match_score, match_percentile, payload_hash, posted_at',
    blacklisted_companies: 'id, name, date_added',
    filter_profiles: 'id, profile_name',
    ats_watchlist: 'id, company_name, ats_type, active',
    user_profile: 'id',
    embeddings: 'id, job_id'   // optional semantic-matching cache (opt-in feature)
}).upgrade(() => {
    console.log('[Storage] Migrated JobSearchDB schema to v2.');
});

console.log('[Storage] Dexie IndexedDB initialized.');
window.localDB = db; // Export to window for global availability
