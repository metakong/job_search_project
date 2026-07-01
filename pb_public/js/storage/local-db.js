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
});

// v3 — add new indexed fields for dynamic probabilistic scoring
db.version(3).stores({
    job_listings: 'id, title, company_name, application_status, computed_zone, location_type, industry, is_ghost_job, is_eligible, days_since_posted, match_score, match_percentile, payload_hash, posted_at, ambiguity_index, transition_friction, strategy_tier, zone_rank'
}).upgrade(() => {
    console.log('[Storage] Migrated JobSearchDB schema to v3.');
    localStorage.setItem('requires_rescore_v13', 'true');
});

// v4 — Phase 13.4 changed the zoning/seniority LOGIC (no new fields). Re-declare
// the same store and flag a background re-score so existing listings are re-routed
// by the new trajectory-primary engine (fixes stale "best of the worst" zones).
db.version(4).stores({
    job_listings: 'id, title, company_name, application_status, computed_zone, location_type, industry, is_ghost_job, is_eligible, days_since_posted, match_score, match_percentile, payload_hash, posted_at, ambiguity_index, transition_friction, strategy_tier, zone_rank'
}).upgrade(() => {
    console.log('[Storage] Migrated JobSearchDB schema to v4 (Phase 13.4 re-score).');
    localStorage.setItem('requires_rescore_v13', 'true');
});

// v5 — Phase 13.6 dual-baseline anchor + salary/zone LOGIC change (no new fields).
// Force a re-score so existing listings re-route off the corrected effective
// trajectory (fixes the empty-Moonshot / Safety-Net-as-trash-can drift).
db.version(5).stores({
    job_listings: 'id, title, company_name, application_status, computed_zone, location_type, industry, is_ghost_job, is_eligible, days_since_posted, match_score, match_percentile, payload_hash, posted_at, ambiguity_index, transition_friction, strategy_tier, zone_rank'
}).upgrade(() => {
    console.log('[Storage] Migrated JobSearchDB schema to v5 (Phase 13.6 dual-baseline re-score).');
    localStorage.setItem('requires_rescore_v13', 'true');
});

// v6 — Phase 13.7 domain-competency Delta-X gate (no new fields). Re-score so
// out-of-domain roles (e.g. software engineering for a sales/ops candidate) are
// crushed off the board instead of false-matching on shared buzzwords.
db.version(6).stores({
    job_listings: 'id, title, company_name, application_status, computed_zone, location_type, industry, is_ghost_job, is_eligible, days_since_posted, match_score, match_percentile, payload_hash, posted_at, ambiguity_index, transition_friction, strategy_tier, zone_rank'
}).upgrade(() => {
    console.log('[Storage] Migrated JobSearchDB schema to v6 (Phase 13.7 domain-competency re-score).');
    localStorage.setItem('requires_rescore_v13', 'true');
});

console.log('[Storage] Dexie IndexedDB initialized.');
window.localDB = db; // Export to window for global availability
