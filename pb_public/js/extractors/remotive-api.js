// =====================================================================
// Remotive JSON API Extractor — remotive-api.js
// =====================================================================

const remotiveApi = {
    async fetchJobs(queries) {
        if (!Array.isArray(queries)) queries = [queries];
        console.log(`[Remotive API] Fetching jobs for queries: ${JSON.stringify(queries)}`);
        const results = [];
        
        for (const query of queries) {
            // Remotive API search format: https://remotive.com/api/remote-jobs?search=QUERY
            // We will fetch through CORS proxy
            const url = `https://remotive.com/api/remote-jobs?search=${encodeURIComponent(query)}`;
            
            try {
            const response = await window.fetchWithCORS(url);
            const data = await response.json();
            
            const jobs = data.jobs || [];
            console.log(`[Remotive API] Found ${jobs.length} raw results.`);
            
            for (const job of jobs) {
                const title = job.title || 'Unknown Title';
                const company = job.company_name || 'Unknown Company';
                const jobLocation = job.candidate_required_location || 'Remote';
                const description = job.description || '';
                const link = job.url || '';
                const pubDateStr = job.publication_date || '';
                
                // Parse date
                let daysSincePosted = 0;
                let postedIso = new Date().toISOString();
                if (pubDateStr) {
                    try {
                        const pubDate = new Date(pubDateStr);
                        if (!isNaN(pubDate.getTime())) {
                            postedIso = pubDate.toISOString();
                            const diffTime = Math.abs(new Date() - pubDate);
                            daysSincePosted = Math.floor(diffTime / (1000 * 60 * 60 * 24));
                        }
                    } catch (e) {
                        console.warn('[Remotive API] Failed to parse publication date:', pubDateStr);
                    }
                }
                
                // Extract salary from salary field if present (remotive sometimes provides a string)
                let salaryMin = 0;
                let salaryMax = 0;
                let salaryParseable = false;
                if (job.salary) {
                    // Try parsing salary ranges like "$80k - $100k" or "$50,000 - $70,000"
                    const salClean = String(job.salary).replace(/,/g, '');
                    const rangeMatch = salClean.match(/\$?(\d+)\s*(?:k|K)?\s*(?:-|–|to)\s*\$?(\d+)\s*(?:k|K)?/);
                    if (rangeMatch) {
                        let minVal = parseFloat(rangeMatch[1]);
                        let maxVal = parseFloat(rangeMatch[2]);
                        
                        // Handle 'k' multiplier
                        if (salClean.toLowerCase().includes('k')) {
                            if (minVal < 1000) minVal *= 1000;
                            if (maxVal < 1000) maxVal *= 1000;
                        }
                        
                        salaryMin = minVal;
                        salaryMax = maxVal;
                        salaryParseable = true;
                    }
                }
                
                // Generate composite hash
                const compositeHash = await window.generateSHA256(company, title, jobLocation);
                
                results.push({
                    title: title,
                    company_name: company,
                    job_location: jobLocation,
                    description_full: description,
                    apply_url: link,
                    posted_at: postedIso,
                    days_since_posted: daysSincePosted,
                    salary_min: salaryMin,
                    salary_max: salaryMax,
                    salary_parseable: salaryParseable,
                    location_type: 'remote', // Remotive is remote by definition
                    source_platform: 'Remotive',
                    payload_hash: compositeHash,
                    application_status: 'unseen',
                    is_eligible: null
                });
            }
            
        } catch (err) {
            console.error(`[Remotive API] Fetch failed for query "${query}":`, err);
        }
        
        // Brief pause between requests
        await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        // Deduplicate using a Map
        const uniqueResults = new Map();
        for (const r of results) {
            uniqueResults.set(r.payload_hash, r);
        }
        
        return Array.from(uniqueResults.values());
    }
};

window.remotiveApi = remotiveApi; // Export globally
