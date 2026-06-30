// =====================================================================
// The Muse JSON API Extractor — themuse-api.js
// =====================================================================
// A key-free, CORS-friendly, US-centric aggregator. Chosen for Phase 13.4 to
// relieve data starvation when heavily-guarded feeds (Indeed) are WAF-blocked,
// WITHOUT adding a backend or a mandatory API key (North Star: zero bloat).
//
// Bonus: The Muse exposes an explicit `levels` array, so we can pass a TRUSTED
// seniority through `source_seniority` (honored by scoring-coordinator over the
// title heuristic) — directly strengthening the Delta-Y trajectory axis.
//
// The public endpoint works with no key (rate-limited). An optional key can be
// supplied via profile.museApiKey purely to raise the rate limit; never required.
// =====================================================================

const themuseApi = {
    // Map The Muse's level vocabulary → our seniority ladder. Only UNAMBIGUOUS
    // levels are mapped; "Mid Level" stays undefined and falls back to the title.
    _LEVEL_MAP: {
        'internship': 'entry',
        'entry level': 'entry',
        'senior level': 'senior',
        'management': 'manager',
    },

    async fetchJobs(location = '', categories = [], maxPages = 2, apiKey = '') {
        console.log(`[The Muse] Fetching jobs near "${location}" (categories: ${JSON.stringify(categories)})`);
        const results = [];

        for (let page = 0; page < maxPages; page++) {
            const params = new URLSearchParams();
            params.set('page', String(page));
            params.set('descending', 'true');
            if (location && location.trim()) params.set('location', location.trim());
            // The Muse accepts repeated `category` params; pass any the caller mapped.
            for (const c of (categories || [])) if (c) params.append('category', c);
            if (apiKey && apiKey.trim()) params.set('api_key', apiKey.trim());

            const url = `https://www.themuse.com/api/public/jobs?${params.toString()}`;

            try {
                const response = await window.fetchWithCORS(url);
                const data = await response.json();
                const jobs = Array.isArray(data.results) ? data.results : [];
                console.log(`[The Muse] Page ${page + 1}: ${jobs.length} results.`);
                if (jobs.length === 0) break; // no more pages

                for (const job of jobs) {
                    const title = job.name || 'Unknown Title';
                    const company = (job.company && job.company.name) || 'Unknown Company';
                    const jobLocation = (job.locations && job.locations[0] && job.locations[0].name) || location || 'Unknown';
                    const description = job.contents || '';            // HTML; scrubbed downstream
                    const link = (job.refs && job.refs.landing_page) || '';
                    const pubDateStr = job.publication_date || '';

                    // Trusted seniority from the first recognised level.
                    let sourceSeniority = null;
                    for (const lvl of (job.levels || [])) {
                        const key = String(lvl.name || '').toLowerCase().trim();
                        if (this._LEVEL_MAP[key]) { sourceSeniority = this._LEVEL_MAP[key]; break; }
                    }

                    let daysSincePosted = 0;
                    let postedIso = new Date().toISOString();
                    if (pubDateStr) {
                        try {
                            const pubDate = new Date(pubDateStr);
                            if (!isNaN(pubDate.getTime())) {
                                postedIso = pubDate.toISOString();
                                daysSincePosted = Math.floor(Math.abs(new Date() - pubDate) / (1000 * 60 * 60 * 24));
                            }
                        } catch (e) { /* keep defaults */ }
                    }

                    const compositeHash = await window.generateSHA256(company, title, jobLocation);

                    const record = {
                        title,
                        company_name: company,
                        job_location: jobLocation,
                        description_full: description,
                        apply_url: link,
                        posted_at: postedIso,
                        days_since_posted: daysSincePosted,
                        source_platform: 'The Muse',
                        payload_hash: compositeHash,
                        application_status: 'unseen',
                        is_eligible: null
                    };
                    if (sourceSeniority) record.source_seniority = sourceSeniority;
                    results.push(record);
                }

                await new Promise(resolve => setTimeout(resolve, 600)); // gentle throttle
            } catch (err) {
                console.error(`[The Muse] Fetch failed on page ${page}:`, err);
                break;
            }
        }

        // Deduplicate by composite hash.
        const unique = new Map();
        for (const r of results) unique.set(r.payload_hash, r);
        return Array.from(unique.values());
    }
};

window.themuseApi = themuseApi; // Export globally
