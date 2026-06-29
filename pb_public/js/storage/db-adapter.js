// =====================================================================
// Storage Abstraction Layer — db-adapter.js
// =====================================================================

const dbAdapter = {
    // ── User Profile & API Keys ──────────────────────────────────────────
    async getUserProfile() {
        try {
            const profile = await window.localDB.user_profile.get('default');
            return profile || {
                id: 'default',
                location: 'Springfield, MO',
                radius: 30,
                salaryFloor: 40000,
                categories: ['sales', 'operations', 'tech'],
                resumeText: '',
                apiKeyCerebras: '',
                apiKeyGroq: '',
                apiKeyGemini: '',
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

    // ── Job Listings CRUD & Queries ──────────────────────────────────────
    async getJobs(filters = {}, page = 1, perPage = 50) {
        try {
            let collection = window.localDB.job_listings;
            
            // Fetch all records into memory for filtering, sorting and paging
            // Since client-side IndexedDB can scale up to 10k+ records, in-memory sorting is fast.
            let items = await collection.toArray();

            // 1. Filter out duplicates or non-eligible unless specified
            items = items.filter(item => item.is_eligible !== false);

            // 1b. Zone filter
            if (filters.zone && filters.zone !== 'all') {
                items = items.filter(item => {
                    // If the job lacks a computed_zone, treat it as a 'strike' default so it isn't invisible
                    const jobZone = item.computed_zone || 'strike';
                    return jobZone === filters.zone;
                });
            }

            // 3. Application status filter
            if (filters.appStatus && filters.appStatus !== 'ALL') {
                items = items.filter(item => item.application_status === filters.appStatus);
            }

            // 4. Location filter
            if (filters.location && filters.location !== 'ALL') {
                if (filters.location === 'remote') {
                    items = items.filter(item => item.location_type === 'remote' && item.days_since_posted <= 14);
                } else {
                    items = items.filter(item => item.location_type === filters.location);
                }
            }

            // 5. Industry filter
            if (filters.industry && filters.industry !== 'ALL') {
                items = items.filter(item => item.industry === filters.industry);
            }

            // 6. Ghost job filter
            if (filters.hideGhost === true) {
                items = items.filter(item => item.is_ghost_job !== true);
            }

            // 7. Salary range filter
            if (filters.salaryMin !== undefined && filters.salaryMin !== '') {
                const sMin = parseFloat(filters.salaryMin);
                if (!isNaN(sMin)) {
                    items = items.filter(item => !item.salary_parseable || item.salary_max >= sMin);
                }
            }
            if (filters.salaryMax !== undefined && filters.salaryMax !== '') {
                const sMax = parseFloat(filters.salaryMax);
                if (!isNaN(sMax)) {
                    items = items.filter(item => !item.salary_parseable || item.salary_min <= sMax);
                }
            }

            // 8. Recency window filter
            if (filters.recencyDays && filters.recencyDays < 9999) {
                // If location is remote, it is already capped at 14 days
                items = items.filter(item => {
                    if (item.location_type === 'remote') return item.days_since_posted <= 14;
                    return item.days_since_posted <= filters.recencyDays;
                });
            }

            // 9. Search string filter (title or company)
            if (filters.search && filters.search.trim() !== '') {
                const q = filters.search.toLowerCase().trim();
                items = items.filter(item => 
                    (item.title && item.title.toLowerCase().includes(q)) || 
                    (item.company_name && item.company_name.toLowerCase().includes(q))
                );
            }

            // 10. Sorting
            const sortField = filters.sort || '-final_leverage_ratio';
            items.sort((a, b) => {
                let valA, valB;
                let descending = true;

                if (sortField.startsWith('-')) {
                    descending = true;
                    const field = sortField.substring(1);
                    valA = a[field];
                    valB = b[field];
                } else {
                    descending = false;
                    valA = a[sortField];
                    valB = b[sortField];
                }

                if (valA === undefined || valA === null) valA = descending ? -Infinity : Infinity;
                if (valB === undefined || valB === null) valB = descending ? -Infinity : Infinity;

                if (valA < valB) return descending ? 1 : -1;
                if (valA > valB) return descending ? -1 : 1;
                return 0;
            });

            // 11. Pagination
            const totalItems = items.length;
            const totalPages = Math.ceil(totalItems / perPage);
            const startIndex = (page - 1) * perPage;
            const paginatedItems = items.slice(startIndex, startIndex + perPage);

            return {
                items: paginatedItems,
                page,
                perPage,
                totalItems,
                totalPages
            };
        } catch (err) {
            console.error('[DB Adapter] Failed to fetch jobs:', err);
            return { items: [], page: 1, perPage, totalItems: 0, totalPages: 0 };
        }
    },

    async getJobDetail(id) {
        try {
            return await window.localDB.job_listings.get(id);
        } catch (err) {
            console.error('[DB Adapter] Failed to get job details:', err);
            return null;
        }
    },

    async saveJobStatus(id, status) {
        try {
            await window.localDB.job_listings.update(id, { application_status: status });
            return true;
        } catch (err) {
            console.error('[DB Adapter] Failed to update job status:', err);
            return false;
        }
    },

    async saveJobsBulk(jobsList) {
        try {
            let newInserts = 0;
            let duplicates = 0;
            
            // Load existing hashes for fast O(1) deduplication
            const existingListings = await window.localDB.job_listings.toArray();
            const existingHashes = new Set(existingListings.map(j => j.payload_hash));

            for (const job of jobsList) {
                if (existingHashes.has(job.payload_hash)) {
                    duplicates++;
                    continue;
                }
                
                // Generate a random pocketbase-like ID if not present
                if (!job.id) {
                    job.id = Math.random().toString(36).substring(2, 17);
                }
                
                await window.localDB.job_listings.put(job);
                existingHashes.add(job.payload_hash);
                newInserts++;
            }
            console.log(`[DB Adapter] Ingested: ${newInserts} new jobs, skipped ${duplicates} duplicates.`);
            return { newInserts, duplicates };
        } catch (err) {
            console.error('[DB Adapter] Failed to save jobs bulk:', err);
            return { newInserts: 0, duplicates: 0 };
        }
    },

    // ── Company Blacklist ────────────────────────────────────────────────
    async getBlacklist() {
        try {
            return await window.localDB.blacklisted_companies.toArray();
        } catch (err) {
            console.error('[DB Adapter] Failed to load blacklist:', err);
            return [];
        }
    },

    async addBlacklist(name, reason = '') {
        try {
            const id = Math.random().toString(36).substring(2, 17);
            const dateStr = new Date().toISOString().slice(0, 10);
            const newRecord = { id, name, reason, date_added: dateStr };
            await window.localDB.blacklisted_companies.put(newRecord);
            return newRecord;
        } catch (err) {
            console.error('[DB Adapter] Failed to add blacklist:', err);
            return null;
        }
    },

    async removeBlacklist(id) {
        try {
            await window.localDB.blacklisted_companies.delete(id);
            return true;
        } catch (err) {
            console.error('[DB Adapter] Failed to remove blacklist:', err);
            return false;
        }
    },

    // ── Filter Profiles ──────────────────────────────────────────────────
    async getFilterProfiles() {
        try {
            return await window.localDB.filter_profiles.toArray();
        } catch (err) {
            console.error('[DB Adapter] Failed to fetch filter profiles:', err);
            return [];
        }
    },

    async saveFilterProfile(profileName, filterState) {
        try {
            const id = Math.random().toString(36).substring(2, 17);
            const newProfile = { id, profile_name: profileName, filter_state_json: filterState };
            await window.localDB.filter_profiles.put(newProfile);
            return newProfile;
        } catch (err) {
            console.error('[DB Adapter] Failed to save filter profile:', err);
            return null;
        }
    },

    // ── ATS Watchlist ────────────────────────────────────────────────────
    async getATSWatchlist() {
        try {
            return await window.localDB.ats_watchlist.toArray();
        } catch (err) {
            console.error('[DB Adapter] Failed to get ATS Watchlist:', err);
            return [];
        }
    },

    async saveATSWatchlistEntry(company_name, ats_type, company_slug, active = true) {
        try {
            // Find existing slug entry
            const watchlist = await this.getATSWatchlist();
            const existing = watchlist.find(item => item.company_name === company_name || (item.company_slug === company_slug && item.ats_type === ats_type));
            const id = existing ? existing.id : Math.random().toString(36).substring(2, 17);
            const entry = { id, company_name, ats_type, company_slug, active };
            await window.localDB.ats_watchlist.put(entry);
            return entry;
        } catch (err) {
            console.error('[DB Adapter] Failed to save ATS watchlist entry:', err);
            return null;
        }
    },

    async deleteATSWatchlistEntry(id) {
        try {
            await window.localDB.ats_watchlist.delete(id);
            return true;
        } catch (err) {
            console.error('[DB Adapter] Failed to delete ATS watchlist entry:', err);
            return false;
        }
    }
};

window.dbAdapter = dbAdapter; // Export globally
