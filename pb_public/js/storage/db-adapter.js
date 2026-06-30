// =====================================================================
// Storage Abstraction Layer — db-adapter.js
// =====================================================================

const dbAdapter = {
    // ── User Profile ─────────────────────────────────────────────────────
    async getUserProfile() {
        try {
            const profile = await window.localDB.user_profile.get('default');
            return profile || {
                id: 'default',
                location: 'Springfield, MO',
                radius: 30,
                salaryFloor: 40000,
                baselineSeniority: 2,
                strategyDial: 2,
                categories: ['sales', 'operations', 'tech'],
                search_queries: [],
                resumeText: '',
                enableSemanticMatching: false,
                corsProxyOverride: ''
            };
        } catch (err) {
            console.error('[DB Adapter] Failed to get user profile:', err);
            return null;
        }
    },

    async saveUserProfile(profileData) {
        try {
            const current = await this.getUserProfile();
            const updated = { ...current, ...profileData, id: 'default' };
            await window.localDB.user_profile.put(updated);
            return updated;
        } catch (err) {
            console.error('[DB Adapter] Failed to save user profile:', err);
            return null;
        }
    },

    // ── Job Listings ─────────────────────────────────────────────────────

    // Full table snapshot (used by the in-memory cache and full re-scores).
    async getAllJobs() {
        try { return await window.localDB.job_listings.toArray(); }
        catch (err) { console.error('[DB Adapter] Failed to load all jobs:', err); return []; }
    },

    // Filter + sort + paginate. Pass `preloaded` (the cached array) to avoid
    // re-querying IndexedDB on every keystroke; falls back to a fresh read.
    async getJobs(filters = {}, page = 1, perPage = 50, preloaded = null) {
        try {
            let items = preloaded || await window.localDB.job_listings.toArray();

            // Base: hide blacklisted/ineligible and the hidden "noise" floor.
            items = items.filter(it => it.is_eligible !== false && it.computed_zone !== 'noise');

            if (filters.zone && filters.zone !== 'all') {
                items = items.filter(it => (it.computed_zone || 'strike') === filters.zone);
            }
            if (filters.appStatus && filters.appStatus !== 'ALL') {
                items = items.filter(it => (it.application_status || 'unseen') === filters.appStatus);
            }
            if (filters.location && filters.location !== 'ALL') {
                items = items.filter(it => it.location_type === filters.location);
            }
            if (filters.industry && filters.industry !== 'ALL') {
                items = items.filter(it => it.industry === filters.industry);
            }
            if (filters.hideGhost === true) {
                items = items.filter(it => it.is_ghost_job !== true);
            }
            if (filters.salaryMin !== undefined && filters.salaryMin !== '') {
                const sMin = parseFloat(filters.salaryMin);
                if (!isNaN(sMin)) items = items.filter(it => !it.salary_parseable || (it.salary_max || 0) >= sMin);
            }
            if (filters.salaryMax !== undefined && filters.salaryMax !== '') {
                const sMax = parseFloat(filters.salaryMax);
                if (!isNaN(sMax)) items = items.filter(it => !it.salary_parseable || (it.salary_min || 0) <= sMax);
            }
            if (filters.recencyDays && filters.recencyDays < 9999) {
                items = items.filter(it => (it.days_since_posted ?? 0) <= filters.recencyDays);
            }
            if (filters.search && filters.search.trim() !== '') {
                const q = filters.search.toLowerCase().trim();
                items = items.filter(it =>
                    (it.title && it.title.toLowerCase().includes(q)) ||
                    (it.company_name && it.company_name.toLowerCase().includes(q)));
            }

            // Sorting (default: Core Score, high → low).
            const sortField = filters.sort || '-match_score';
            const desc = sortField.startsWith('-');
            const field = desc ? sortField.substring(1) : sortField;
            items.sort((a, b) => {
                let va = a[field], vb = b[field];
                if (va === undefined || va === null) va = desc ? -Infinity : Infinity;
                if (vb === undefined || vb === null) vb = desc ? -Infinity : Infinity;
                if (va < vb) return desc ? 1 : -1;
                if (va > vb) return desc ? -1 : 1;
                return 0;
            });

            const totalItems = items.length;
            const totalPages = Math.ceil(totalItems / perPage) || 1;
            const start = (page - 1) * perPage;
            return { items: items.slice(start, start + perPage), page, perPage, totalItems, totalPages };
        } catch (err) {
            console.error('[DB Adapter] Failed to fetch jobs:', err);
            return { items: [], page: 1, perPage, totalItems: 0, totalPages: 0 };
        }
    },

    async getJobDetail(id) {
        try { return await window.localDB.job_listings.get(id); }
        catch (err) { console.error('[DB Adapter] Failed to get job details:', err); return null; }
    },

    async saveJobStatus(id, status) {
        try { await window.localDB.job_listings.update(id, { application_status: status }); return true; }
        catch (err) { console.error('[DB Adapter] Failed to update job status:', err); return false; }
    },

    // Insert only genuinely new listings (dedup by payload_hash).
    async saveJobsBulk(jobsList) {
        try {
            let newInserts = 0, duplicates = 0;
            const existing = await window.localDB.job_listings.toArray();
            const existingHashes = new Set(existing.map(j => j.payload_hash).filter(Boolean));
            const toInsert = [];

            for (const job of jobsList) {
                if (job.payload_hash && existingHashes.has(job.payload_hash)) { duplicates++; continue; }
                if (!job.id) job.id = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
                if (job.payload_hash) existingHashes.add(job.payload_hash);
                toInsert.push(job);
                newInserts++;
            }
            if (toInsert.length) await window.localDB.job_listings.bulkPut(toInsert);
            console.log(`[DB Adapter] Ingested ${newInserts} new, skipped ${duplicates} duplicates.`);
            return { newInserts, duplicates };
        } catch (err) {
            console.error('[DB Adapter] Failed to save jobs bulk:', err);
            return { newInserts: 0, duplicates: 0 };
        }
    },

    // Persist re-scored jobs (used after a Strategy Dial change / global re-score).
    async persistJobs(jobsList) {
        try { await window.localDB.job_listings.bulkPut(jobsList); return true; }
        catch (err) { console.error('[DB Adapter] Failed to persist jobs:', err); return false; }
    },

    // ── Company Blacklist ────────────────────────────────────────────────
    async getBlacklist() {
        try { return await window.localDB.blacklisted_companies.toArray(); }
        catch (err) { console.error('[DB Adapter] Failed to load blacklist:', err); return []; }
    },

    // Convenience: just the names (used by the scoring re-score path).
    async getBlacklistNames() {
        try { return (await this.getBlacklist()).map(b => b.name).filter(Boolean); }
        catch (err) { console.error('[DB Adapter] Failed to load blacklist names:', err); return []; }
    },

    async addBlacklist(name, reason = '') {
        try {
            const id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
            const newRecord = { id, name, reason, date_added: new Date().toISOString().slice(0, 10) };
            await window.localDB.blacklisted_companies.put(newRecord);
            return newRecord;
        } catch (err) { console.error('[DB Adapter] Failed to add blacklist:', err); return null; }
    },

    async removeBlacklist(id) {
        try { await window.localDB.blacklisted_companies.delete(id); return true; }
        catch (err) { console.error('[DB Adapter] Failed to remove blacklist:', err); return false; }
    },

    // ── Filter Profiles ──────────────────────────────────────────────────
    async getFilterProfiles() {
        try { return await window.localDB.filter_profiles.toArray(); }
        catch (err) { console.error('[DB Adapter] Failed to fetch filter profiles:', err); return []; }
    },

    async saveFilterProfile(profileName, filterState) {
        try {
            const id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
            const newProfile = { id, profile_name: profileName, filter_state_json: filterState };
            await window.localDB.filter_profiles.put(newProfile);
            return newProfile;
        } catch (err) { console.error('[DB Adapter] Failed to save filter profile:', err); return null; }
    },

    // ── ATS Watchlist ────────────────────────────────────────────────────
    async getATSWatchlist() {
        try { return await window.localDB.ats_watchlist.toArray(); }
        catch (err) { console.error('[DB Adapter] Failed to get ATS Watchlist:', err); return []; }
    },

    async saveATSWatchlistEntry(company_name, ats_type, company_slug, active = true) {
        try {
            const watchlist = await this.getATSWatchlist();
            const existing = watchlist.find(it => it.company_name === company_name || (it.company_slug === company_slug && it.ats_type === ats_type));
            const id = existing ? existing.id : (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
            const entry = { id, company_name, ats_type, company_slug, active };
            await window.localDB.ats_watchlist.put(entry);
            return entry;
        } catch (err) { console.error('[DB Adapter] Failed to save ATS watchlist entry:', err); return null; }
    },

    async deleteATSWatchlistEntry(id) {
        try { await window.localDB.ats_watchlist.delete(id); return true; }
        catch (err) { console.error('[DB Adapter] Failed to delete ATS watchlist entry:', err); return false; }
    }
};

window.dbAdapter = dbAdapter; // Export globally
