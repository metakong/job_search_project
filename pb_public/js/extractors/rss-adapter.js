// =====================================================================
// Indeed RSS Feed Extractor — rss-adapter.js
// =====================================================================

const rssAdapter = {
    async fetchJobs(query, location = 'Springfield, MO', maxPages = 5) {
        console.log(`[Indeed RSS] Starting sweep for query: "${query}" in "${location}"`);
        const results = [];
        
        // Indeed RSS pagination offset is usually in increments of 10 or 20.
        // We will fetch offsets 0, 10, 20, 30, 40 to get up to 5 pages.
        for (let page = 0; page < maxPages; page++) {
            const start = page * 10;
            // Build Indeed RSS URL. Standard format is:
            // https://www.indeed.com/rss?q=QUERY&l=LOCATION&start=START
            const url = `https://www.indeed.com/rss?q=${encodeURIComponent(query)}&l=${encodeURIComponent(location)}&start=${start}`;
            
            try {
                const response = await window.fetchWithCORS(url);
                const xmlText = await response.text();
                
                const parser = new DOMParser();
                const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
                
                // Check if parse error
                const parserError = xmlDoc.querySelector('parsererror');
                if (parserError) {
                    console.error(`[Indeed RSS] XML Parse Error on page ${page}:`, parserError.textContent);
                    break;
                }
                
                const items = xmlDoc.querySelectorAll('item');
                if (items.length === 0) {
                    console.log(`[Indeed RSS] No more items found on page ${page}. Ending pagination.`);
                    break;
                }
                
                console.log(`[Indeed RSS] Page ${page + 1}: Found ${items.length} items.`);
                
                for (const item of items) {
                    const rawTitle = item.querySelector('title')?.textContent || '';
                    const link = item.querySelector('link')?.textContent || '';
                    const description = item.querySelector('description')?.textContent || '';
                    const pubDateStr = item.querySelector('pubDate')?.textContent || '';
                    const source = item.querySelector('source')?.textContent || '';
                    
                    // Parse Company and Title from Title String: "Job Title - Company - Location"
                    let title = rawTitle;
                    let company = source || 'Unknown Company';
                    let jobLocation = location;
                    
                    if (rawTitle.includes(' - ')) {
                        const parts = rawTitle.split(' - ').map(p => p.trim());
                        if (parts.length >= 3) {
                            title = parts[0];
                            company = parts[1];
                            jobLocation = parts[2];
                        } else if (parts.length === 2) {
                            title = parts[0];
                            company = parts[1];
                        }
                    }
                    
                    // Parse dates
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
                            console.warn('[Indeed RSS] Failed to parse pubDate:', pubDateStr);
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
                        source_platform: 'Indeed RSS',
                        payload_hash: compositeHash,
                        application_status: 'unseen',
                        is_eligible: null // Handled in scoring pass
                    });
                }
                
                // Brief pause between requests to prevent hitting rate limits
                await new Promise(resolve => setTimeout(resolve, 1000));
                
            } catch (err) {
                console.error(`[Indeed RSS] Error fetching page ${page}:`, err);
                break; // Stop paginating if request fails
            }
        }
        
        return results;
    }
};

window.rssAdapter = rssAdapter; // Export globally
