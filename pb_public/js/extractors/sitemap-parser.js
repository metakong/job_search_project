// =====================================================================
// Sitemap & JSON-LD Schema Crawler — sitemap-parser.js
// =====================================================================

const sitemapParser = {
    // ── Helper: Concurrency Limiter worker pool ───────────────────────
    async _mapLimit(items, limit, asyncFn) {
        const results = [];
        const queue = [...items];
        
        const workers = Array(Math.min(limit, items.length)).fill(null).map(async () => {
            while (queue.length > 0) {
                const item = queue.shift();
                try {
                    const res = await asyncFn(item);
                    if (res) {
                        if (Array.isArray(res)) {
                            results.push(...res);
                        } else {
                            results.push(res);
                        }
                    }
                } catch (err) {
                    console.error('[Sitemap Crawler] Worker task error:', err);
                }
            }
        });
        
        await Promise.all(workers);
        return results;
    },

    // ── Main Entrypoint ──────────────────────────────────────────────
    async crawlDomainForJobs(domainUrl, maxJobs = 20) {
        console.log(`[Sitemap Crawler] Starting crawl for: ${domainUrl}`);
        
        // Ensure domain ends properly
        let cleanDomain = domainUrl.trim();
        if (!cleanDomain.startsWith('http')) {
            cleanDomain = 'https://' + cleanDomain;
        }
        
        const sitemaps = [];
        
        // 1. Fetch robots.txt
        try {
            const robotsUrl = `${cleanDomain}/robots.txt`;
            const resp = await window.fetchWithCORS(robotsUrl);
            const text = await resp.text();
            
            // Look for Sitemap lines
            const lines = text.split('\n');
            for (const line of lines) {
                if (line.toLowerCase().startsWith('sitemap:')) {
                    const smUrl = line.substring(8).trim();
                    if (smUrl) sitemaps.push(smUrl);
                }
            }
        } catch (e) {
            console.log(`[Sitemap Crawler] Could not retrieve robots.txt from ${cleanDomain}, falling back to sitemap.xml guess.`);
        }
        
        // Fallback: Guess sitemap location if none found in robots.txt
        if (sitemaps.length === 0) {
            sitemaps.push(`${cleanDomain}/sitemap.xml`);
        }
        
        // 2. Fetch and parse sitemap XML files
        let jobUrls = [];
        for (const smUrl of sitemaps) {
            try {
                console.log(`[Sitemap Crawler] Fetching sitemap: ${smUrl}`);
                const resp = await window.fetchWithCORS(smUrl);
                const text = await resp.text();
                
                const parser = new DOMParser();
                const xmlDoc = parser.parseFromString(text, 'text/xml');
                
                // If it's a sitemap index, extract nested sitemaps
                const nestedSitemaps = Array.from(xmlDoc.querySelectorAll('sitemap loc')).map(node => node.textContent);
                if (nestedSitemaps.length > 0) {
                    console.log(`[Sitemap Crawler] Sitemap index found. Expanding ${nestedSitemaps.length} nested sitemaps.`);
                    for (const nSm of nestedSitemaps.slice(0, 3)) { // Cap to avoid endless recursion
                        try {
                            const nResp = await window.fetchWithCORS(nSm);
                            const nText = await nResp.text();
                            const nDoc = parser.parseFromString(nText, 'text/xml');
                            const locs = Array.from(nDoc.querySelectorAll('url loc')).map(node => node.textContent);
                            jobUrls.push(...locs);
                        } catch (err) {
                            console.warn('[Sitemap Crawler] Nested sitemap fetch failed:', nSm);
                        }
                    }
                } else {
                    const locs = Array.from(xmlDoc.querySelectorAll('url loc')).map(node => node.textContent);
                    jobUrls.push(...locs);
                }
            } catch (err) {
                console.error('[Sitemap Crawler] Failed to retrieve sitemap:', smUrl, err);
            }
        }
        
        // 3. Filter job page URLs
        jobUrls = Array.from(new Set(jobUrls)); // Deduplicate sitemap URLs
        console.log(`[Sitemap Crawler] Discovered ${jobUrls.length} total URLs in sitemaps.`);
        
        // Filter by common job URL keywords
        let candidateJobUrls = jobUrls.filter(url => {
            const path = url.toLowerCase();
            return path.includes('/job/') || path.includes('/jobs/') || path.includes('/careers/') || path.includes('/career/') || path.includes('posting') || path.includes('-job-');
        });
        
        if (candidateJobUrls.length === 0) {
            console.log('[Sitemap Crawler] No explicit job-like paths found. Attempting to crawl first 30 URLs.');
            candidateJobUrls = jobUrls.slice(0, 30);
        } else {
            console.log(`[Sitemap Crawler] Filtered down to ${candidateJobUrls.length} candidate job URLs.`);
        }
        
        // Cap sitemap crawl size to protect rate limits
        const targetUrls = candidateJobUrls.slice(0, maxJobs);
        console.log(`[Sitemap Crawler] Crawling ${targetUrls.length} job pages with concurrency limit of 3.`);
        
        // 4. Fetch details in parallel with limit = 3
        const results = await this._mapLimit(targetUrls, 3, async (url) => {
            try {
                // Fetch page HTML
                const resp = await window.fetchWithCORS(url);
                const htmlText = await resp.text();
                
                const parser = new DOMParser();
                const doc = parser.parseFromString(htmlText, 'text/html');
                
                // Extract Schema.org JSON-LD scripts
                const jsonLdScripts = doc.querySelectorAll('script[type="application/ld+json"]');
                const parsedJobs = [];
                
                for (const script of jsonLdScripts) {
                    try {
                        const json = JSON.parse(script.textContent);
                        
                        // Handle single objects or graphs
                        const parseBlock = async (obj) => {
                            if (obj && (obj['@type'] === 'JobPosting' || obj['@type']?.includes('JobPosting'))) {
                                return await this._normalizeSchemaJob(obj, url);
                            }
                            return null;
                        };
                        
                        if (Array.isArray(json)) {
                            for (const obj of json) {
                                const normalized = await parseBlock(obj);
                                if (normalized) parsedJobs.push(normalized);
                            }
                        } else if (json['@graph'] && Array.isArray(json['@graph'])) {
                            for (const obj of json['@graph']) {
                                const normalized = await parseBlock(obj);
                                if (normalized) parsedJobs.push(normalized);
                            }
                        } else {
                            const normalized = await parseBlock(json);
                            if (normalized) parsedJobs.push(normalized);
                        }
                    } catch (e) {
                        // Skip malformed JSON blocks
                    }
                }
                
                // Add rate-limiting delay between fetches
                await new Promise(resolve => setTimeout(resolve, 800));
                return parsedJobs;
                
            } catch (err) {
                console.warn(`[Sitemap Crawler] Failed to crawl URL: ${url}`, err);
                return null;
            }
        });
        
        console.log(`[Sitemap Crawler] Ingestion sweep completed. Extracted ${results.length} valid jobs.`);
        return results;
    },

    // ── Helper: Map JSON-LD object to pocketbase schema ──────────────
    async _normalizeSchemaJob(schema, pageUrl) {
        const title = schema.title || 'Unknown Title';
        const company = schema.hiringOrganization?.name || 'Unknown Company';
        
        let jobLocation = 'Unknown';
        if (schema.jobLocation) {
            if (typeof schema.jobLocation === 'string') {
                jobLocation = schema.jobLocation;
            } else if (schema.jobLocation.address) {
                const addr = schema.jobLocation.address;
                jobLocation = addr.addressLocality 
                    ? `${addr.addressLocality}, ${addr.addressRegion || ''}` 
                    : addr.streetAddress || 'Remote';
            }
        }
        
        const description = schema.description || '';
        const applyUrl = schema.url || pageUrl;
        const postedRaw = schema.datePosted || '';
        
        let daysSincePosted = 0;
        let postedIso = new Date().toISOString();
        if (postedRaw) {
            try {
                const pubDate = new Date(postedRaw);
                if (!isNaN(pubDate.getTime())) {
                    postedIso = pubDate.toISOString();
                    const diffTime = Math.abs(new Date() - pubDate);
                    daysSincePosted = Math.floor(diffTime / (1000 * 60 * 60 * 24));
                }
            } catch (e) {}
        }
        
        // Extract salary if available in schema
        let salaryMin = 0;
        let salaryMax = 0;
        let salaryParseable = false;
        
        const sal = schema.baseSalary?.value;
        if (sal) {
            if (typeof sal === 'number') {
                salaryMin = sal;
                salaryMax = sal;
                salaryParseable = true;
            } else if (sal.value) {
                salaryMin = parseFloat(sal.value) || 0;
                salaryMax = parseFloat(sal.value) || 0;
                salaryParseable = salaryMin > 0;
            } else if (sal.minValue || sal.maxValue) {
                salaryMin = parseFloat(sal.minValue) || 0;
                salaryMax = parseFloat(sal.maxValue) || 0;
                salaryParseable = salaryMin > 0 || salaryMax > 0;
            }
        }
        
        // Check for remote tags in sitemap address details
        let locType = 'unknown';
        const combinedText = `${description} ${jobLocation}`.toLowerCase();
        if (combinedText.includes('remote') || combinedText.includes('work from home') || combinedText.includes('wfh')) {
            locType = 'remote';
        } else if (combinedText.includes('hybrid')) {
            locType = 'hybrid';
        } else if (combinedText.includes('on-site') || combinedText.includes('in-office') || combinedText.includes('onsite')) {
            locType = 'on_site';
        }
        
        // Generate composite hash
        const compositeHash = await window.generateSHA256(company, title, jobLocation);
        
        return {
            title: title,
            company_name: company,
            job_location: jobLocation,
            description_full: description,
            apply_url: applyUrl,
            posted_at: postedIso,
            days_since_posted: daysSincePosted,
            salary_min: salaryMin,
            salary_max: salaryMax,
            salary_parseable: salaryParseable,
            location_type: locType,
            employment_type: schema.employmentType || '',
            source_platform: 'Sitemap Crawl',
            payload_hash: compositeHash,
            application_status: 'unseen',
            is_eligible: null
        };
    }
};

window.sitemapParser = sitemapParser; // Export globally
