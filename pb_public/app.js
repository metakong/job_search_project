// =====================================================================
// Job Search Intelligence Platform — app.js
// =====================================================================
// Dashboard controller. Holds the full listing set in an in-memory cache and
// filters/sorts/paginates against it (IndexedDB is read once per data change,
// not per keystroke). Scoring & zone assignment are persisted; this layer only
// renders and filters — it never re-routes zones at view time.
// =====================================================================

// ── State ─────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const updateLoadingText = (text) => { if (loader) loader.querySelector('span').textContent = text; };

let isScraping         = false;
let allJobsCache       = [];     // full listing snapshot (source of truth for the view)
let jobListings        = [];     // current rendered page(s)
let currentPage        = 1;
let hasMore            = true;
let currentRecencyDays = 9999;   // default: show all ages (granular control)
let blacklistData      = [];
let fuseBlacklist      = null;
let currentModalJobId  = null;
let currentActiveDescription = "";
let currentActiveZone  = "strike";

// ── DOM References ────────────────────────────────────────────────────
const loader            = document.getElementById('loader');
const noResults         = document.getElementById('no-results');
const jobsGrid          = document.getElementById('jobs-grid');
const loadMoreBtn       = document.getElementById('load-more-btn');
const searchInput       = document.getElementById('search-input');
const zoneTabs          = document.getElementById('zone-tabs');
const strategyDial      = document.getElementById('strategy-dial');
const strategyLabel     = document.getElementById('strategy-label');
const sortSelect        = document.getElementById('sort-select');
const appStatusFilter   = document.getElementById('app-status-filter');
const locationFilter    = document.getElementById('location-filter');
const industryFilter    = document.getElementById('industry-filter');
const salaryMin         = document.getElementById('salary-min');
const salaryMax         = document.getElementById('salary-max');
const hideGhostJobs     = document.getElementById('hide-ghost-jobs');
const recencyToggle     = document.getElementById('recency-toggle');

const connectionIndicator  = document.getElementById('connection-indicator');
const connectionStatusText = document.getElementById('connection-status-text');
const statTotalJobs     = document.getElementById('stat-total-jobs');
const statTier1         = document.getElementById('stat-tier1');
const statTier2         = document.getElementById('stat-tier2');
const statAvgCore       = document.getElementById('stat-avg-core');

const detailsModal      = document.getElementById('details-modal');
const modalJobTitle     = document.getElementById('modal-job-title');
const modalJobCompany   = document.getElementById('modal-job-company');
const modalStatusBadge  = document.getElementById('modal-status-badge');
const modalCoreScore    = document.getElementById('modal-core-score');
const modalFitScore     = document.getElementById('modal-fit-score');
const modalToxicityScore = document.getElementById('modal-toxicity-score');
const modalCultureScore = document.getElementById('modal-culture-score');
const modalAtsScore     = document.getElementById('modal-ats-score');

const modalSalary       = document.getElementById('modal-salary');
const modalIndustry     = document.getElementById('modal-industry');
const modalSeniority    = document.getElementById('modal-seniority');
const modalLocation     = document.getElementById('modal-location');
const modalApplyType    = document.getElementById('modal-apply-type');
const modalPercentile   = document.getElementById('modal-percentile');
const modalTrajectory   = document.getElementById('modal-trajectory');
const modalPostedDate   = document.getElementById('modal-posted-date');
const modalDaysSince    = document.getElementById('modal-days-since');
const modalSourcePlatform = document.getElementById('modal-source-platform');
const modalApplyBtn     = document.getElementById('modal-apply-btn');

const modalDescContent  = document.getElementById('modal-description-content');
const modalCopyBtn      = document.getElementById('modal-copy-btn');
const copyBtnText       = document.getElementById('copy-btn-text');
const closeModalBtn     = document.getElementById('close-modal-btn');
const modalAppStatusSel = document.getElementById('modal-app-status-select');
const modalSaveStatusBtn = document.getElementById('modal-save-status-btn');
const exportCsvBtn      = document.getElementById('export-csv-btn');
const saveFilterBtn     = document.getElementById('save-filter-btn');
const profileSelect     = document.getElementById('profile-select');
const settingsToggleBtn = document.getElementById('settings-toggle-btn');
const blacklistPanel    = document.getElementById('blacklist-panel');
const blacklistInput    = document.getElementById('blacklist-input');
const blacklistReason   = document.getElementById('blacklist-reason');
const blacklistAddBtn   = document.getElementById('blacklist-add-btn');
const blacklistList     = document.getElementById('blacklist-list');

const ingestSweepBtn    = document.getElementById('ingest-sweep-btn');
const wizardReopenBtn   = document.getElementById('wizard-reopen-btn');
const exportDbBtn       = document.getElementById('export-db-btn');
const importDbTriggerBtn = document.getElementById('import-db-trigger-btn');
const importDbFile      = document.getElementById('import-db-file');

// ── Init ──────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    if ('serviceWorker' in navigator) {
        try { await navigator.serviceWorker.register('./sw.js'); }
        catch (err) { console.error('[PWA] Service Worker registration failed:', err); }
    }

    setupEventListeners();
    setConnectionStatus(true);

    await window.setupWizard.init();
    await window.dataPortability.checkExportReminder();
    await loadBlacklist();
    await loadFilterProfiles();

    // Sync the dial UI to the stored strategy.
    const profile = await window.dbAdapter.getUserProfile();
    if (strategyDial && profile && profile.strategyDial) {
        strategyDial.value = profile.strategyDial;
        if (strategyLabel) strategyLabel.textContent = { 1: 'Survival', 2: 'Balanced', 3: 'Aggressive' }[profile.strategyDial] || 'Balanced';
    }

    await loadAllJobs();
    fetchData(1, false);

    if (localStorage.getItem('requires_rescore_v13') === 'true') {
        localStorage.removeItem('requires_rescore_v13');
        runBackgroundRescore();
    }
});

// ── In-memory cache ─────────────────────────────────────────────────────
async function loadAllJobs() {
    allJobsCache = await window.dbAdapter.getAllJobs();
}

// =====================================================================
// Direct In-Browser Ingestion Sweep
// =====================================================================
async function runIngestionSweep() {
    if (isScraping) return;
    isScraping = true;
    try {
        ingestSweepBtn.disabled = true;
        ingestSweepBtn.textContent = '⏳ Scraping…';
        loader.style.display = 'flex';
        updateLoadingText('Ingesting direct RSS & API streams…');

        const profile = await window.dbAdapter.getUserProfile();
        const queries = (profile.search_queries && profile.search_queries.length > 0)
            ? profile.search_queries : window.CONFIG.DEFAULT_SEARCH_QUERIES;
        const location = profile.location || 'Springfield, MO';

        let rawJobs = [];

        // Fetch sequentially to prevent proxy overloading
        for (const query of queries) {
            updateLoadingText(`Fetching jobs for: ${query}...`);
            
            // 1. Fetch RSS
            try { 
                const rssJobs = await window.rssAdapter.fetchJobs(query, location);
                rawJobs.push(...rssJobs);
            }
            catch (err) { console.error(`[Ingest] Indeed RSS "${query}" failed:`, err); }
            await sleep(1000); // 1-second throttle
            
            // 2. Fetch Remotive
            try { 
                const remotiveJobs = await window.remotiveApi.fetchJobs([query]);
                rawJobs.push(...remotiveJobs);
            } 
            catch (err) { console.error(`[Ingest] Remotive "${query}" failed:`, err); }
            await sleep(1000); // 1-second throttle
        }

        updateLoadingText('Polling ATS watchlists…');
        // 3. ATS direct watchlists (Greenhouse / Lever) + optional sitemap careers pages.
        try { rawJobs.push(...await pollWatchlist()); }
        catch (err) { console.error('[Ingest] Watchlist poll failed:', err); }

        console.log(`[Ingest] Collected ${rawJobs.length} raw postings.`);

        // 4. Score & classify.
        updateLoadingText('Scoring and classifying targets…');
        const keywords = window.scoringCoordinator.buildProfileKeywords(profile);
        const blacklistNames = await window.dbAdapter.getBlacklistNames();

        // Optional opt-in semantic boost (off by default; degrades gracefully).
        if (profile.enableSemanticMatching) await applySemanticSimilarity(rawJobs, profile);

        const scored = [];
        for (const job of rawJobs) {
            try { scored.push(window.scoringCoordinator.scoreAndClassifyJob(job, profile, blacklistNames, keywords)); }
            catch (err) { console.error('[Ingest] Scoring failed for', job.title, err); }
        }
        window.scoringCoordinator.flagDuplicates(scored);

        // 5. Persist new listings, then recompute global percentiles across the whole DB.
        updateLoadingText('Saving results to local database…');
        const { newInserts, duplicates } = await window.dbAdapter.saveJobsBulk(scored);
        await loadAllJobs();
        window.scoringCoordinator.distributeAndRank(allJobsCache);
        await window.dbAdapter.persistJobs(allJobsCache);

        const ineligible = scored.filter(j => j.is_eligible === false || j.computed_zone === 'noise').length;
        setStat('stat-raw-ingested', rawJobs.length);
        setStat('stat-discarded', ineligible + duplicates);

        alert(`Sweep complete! ${newInserts} new listings added, ${duplicates} duplicates skipped.`);
        fetchData(1, false);
    } catch (err) {
        console.error('[Ingest] Core extraction failure:', err.stack || err);
        alert(`Ingest sweep partial failure: ${err.message}`);
    } finally {
        isScraping = false;
        ingestSweepBtn.disabled = false;
        ingestSweepBtn.textContent = '↻ Ingest Sweep';
        loader.style.display = 'none';
        updateLoadingText('Loading…');
    }
}

// Poll Greenhouse/Lever ATS feeds and optional sitemap careers pages.
async function pollWatchlist() {
    const watchlist = (await window.dbAdapter.getATSWatchlist()).filter(it => it.active);
    const out = [];
    for (const entry of watchlist) {
        try {
            if (entry.ats_type === 'greenhouse') {
                const resp = await window.fetchWithCORS(`https://boards-api.greenhouse.io/v1/boards/${entry.company_slug}/jobs?content=true`);
                for (const j of ((await resp.json()).jobs || [])) {
                    out.push(await normalizeAts(entry.company_name, j.title, j.location?.name || 'Remote', j.content || '', j.absolute_url || '', j.updated_at, 'ats_direct_greenhouse'));
                }
            } else if (entry.ats_type === 'lever') {
                const resp = await window.fetchWithCORS(`https://api.lever.co/v0/postings/${entry.company_slug}?mode=json`);
                for (const j of (await resp.json())) {
                    out.push(await normalizeAts(entry.company_name, j.text, j.categories?.location || 'Remote', j.descriptionPlain || '', j.hostedUrl || '', j.createdAt, 'ats_direct_lever'));
                }
            } else if (entry.ats_type === 'sitemap' && window.sitemapParser) {
                out.push(...await window.sitemapParser.crawlDomainForJobs(entry.company_slug));
            }
        } catch (err) { console.error(`[Ingest] Watchlist ${entry.company_name} failed:`, err); }
    }
    return out;
}

async function normalizeAts(company, title, loc, desc, url, posted, platform) {
    return {
        title: title || 'Unknown Title', company_name: company, job_location: loc,
        description_full: desc, apply_url: url,
        posted_at: posted ? new Date(posted).toISOString() : new Date().toISOString(),
        days_since_posted: 0, source_platform: platform,
        payload_hash: await window.generateSHA256(company, title, loc),
        application_status: 'unseen', is_eligible: null
    };
}

// Optional semantic similarity (opt-in). Best-effort; never blocks scoring.
async function applySemanticSimilarity(jobs, profile) {
    try {
        if (!window.transformersEngine || !profile.resumeText) return;
        loader.querySelector('span').textContent = 'Computing semantic match (AI)…';
        await window.transformersEngine.init();
        const resumeVec = await window.transformersEngine.getEmbedding(profile.resumeText.slice(0, 2000));
        for (const job of jobs) {
            try {
                const text = (job.description_full || '').slice(0, 2000);
                if (!text) continue;
                const vec = await window.transformersEngine.getEmbedding(text);
                job.semantic_similarity = Math.max(0, window.transformersEngine.calculateSimilarity(resumeVec, vec));
            } catch (e) { /* skip this job */ }
        }
    } catch (err) {
        console.warn('[Semantic] Disabled (model unavailable); using keyword matching.', err);
    }
}

// =====================================================================
// Core Fetch (against the in-memory cache)
// =====================================================================
async function fetchData(page = 1, append = false) {
    try {
        if (!append) { loader.style.display = 'flex'; jobsGrid.innerHTML = ''; jobListings = []; }
        noResults.style.display = 'none';
        loadMoreBtn.style.display = 'none';

        const workspace = document.querySelector('main.container') || document.body;
        workspace.classList.toggle('inferno-mode', currentActiveZone === 'inferno');

        const strategyVal = parseInt(strategyDial?.value || 2);
        
        // Count non-noise, non-inferno jobs in the active bucket
        const activeBucketJobs = allJobsCache.filter(j => 
            j.is_eligible !== false && 
            j.computed_zone !== 'noise' && 
            j.computed_zone !== 'inferno' && 
            (currentActiveZone === 'all' || !currentActiveZone || j.computed_zone === currentActiveZone)
        );
        const bucketSize = activeBucketJobs.length;
        
        // Dynamic Strategy Slicing
        let preloaded = allJobsCache;
        if (bucketSize < 50) {
            // Additive Slicing (Low Volume)
            preloaded = preloaded.filter(j => !j.strategy_tier || j.strategy_tier <= strategyVal);
        } else {
            // Exclusive Slicing (High Volume)
            preloaded = preloaded.filter(j => !j.strategy_tier || j.strategy_tier === strategyVal);
        }

        const filters = {
            search: searchInput.value, sort: sortSelect.value,
            appStatus: appStatusFilter.value, location: locationFilter.value,
            recencyDays: currentRecencyDays, industry: industryFilter.value,
            salaryMin: salaryMin.value, salaryMax: salaryMax.value,
            hideGhost: hideGhostJobs.checked, zone: currentActiveZone
            // strategy_tier is handled via preloaded array to support additive slicing
        };

        const result = await window.dbAdapter.getJobs(filters, page, 50, preloaded);
        let listings = result.items.map(mapJob);

        // Client-side fuzzy blacklist (safety net for names added since last score).
        if (fuseBlacklist && blacklistData.length > 0) {
            listings = listings.filter(j => fuseBlacklist.search(j.company).length === 0);
        }

        jobListings = append ? [...jobListings, ...listings] : listings;
        currentPage = page;
        hasMore = result.page < result.totalPages;

        calculateStats();
        renderCards();
        if (hasMore) loadMoreBtn.style.display = 'inline-block';
    } catch (err) {
        console.error('Fetch error:', err);
        setConnectionStatus(false, err.message);
    } finally {
        if (!append) loader.style.display = 'none';
    }
}

function mapJob(r) {
    return {
        id: r.id,
        title: r.title || 'Unknown Title',
        company: r.company_name || 'Unknown Company',
        match_score: r.match_score ?? 0,
        fit_score: r.fit_score ?? Math.round((r.delta_x || 0) * 100),
        culture_score: r.culture_score ?? 0,
        toxicity_score: r.toxicity_score ?? 0,
        ats_alignment_score: r.ats_alignment_score ?? 0,
        skill_match_score: r.skill_match_score ?? 0,
        match_percentile: r.match_percentile,
        target_status: r.target_status || 'Pending',
        salary_min: r.salary_min || 0,
        salary_max: r.salary_max || 0,
        salary_parseable: r.salary_parseable || false,
        apply_url: safeUrl(r.apply_url),
        posted_at: r.posted_at || '',
        days_since_posted: r.days_since_posted ?? 0,
        location_type: r.location_type || 'unknown',
        seniority_level: r.seniority_level || 'unspecified',
        industry: r.industry || '',
        application_status: r.application_status || 'unseen',
        apply_type: r.apply_type || 'unknown',
        is_ghost_job: r.is_ghost_job || false,
        is_duplicate: r.is_duplicate || false,
        is_stale: r.is_stale || false,
        source_platform: r.source_platform || '',
        computed_zone: r.computed_zone || 'strike',
        inferno_circle: r.inferno_circle || null,
        delta_x: r.delta_x ?? 0,
        delta_y: r.trajectory_recent !== undefined ? r.trajectory_recent : (r.delta_y ?? null)
    };
}

// =====================================================================
// Stats (computed over the whole eligible cache, not just the page)
// =====================================================================
function calculateStats() {
    const ranked = allJobsCache.filter(j => j.is_eligible !== false && ['strike', 'moonshot', 'safety'].includes(j.computed_zone));
    statTotalJobs.textContent = ranked.length;
    statTier1.textContent = ranked.filter(j => (j.target_status || '').includes('Tier 1')).length;
    statTier2.textContent = ranked.filter(j => (j.target_status || '').includes('Tier 2')).length;
    if (statAvgCore) {
        statAvgCore.textContent = ranked.length
            ? Math.round(ranked.reduce((s, j) => s + (j.match_score || 0), 0) / ranked.length)
            : '0';
    }
}

// =====================================================================
// Card Rendering
// =====================================================================
function renderCards() {
    jobsGrid.innerHTML = '';
    if (jobListings.length === 0) { noResults.style.display = 'block'; return; }

    jobListings.forEach(job => {
        const card = document.createElement('div');
        card.id = 'job-card-' + job.id;
        const isInferno = job.computed_zone === 'inferno';
        card.className = `job-card ${getTierCardClass(job.target_status)} ${job.is_stale ? 'card-stale' : ''} ${isInferno ? 'inferno-card' : ''}`;

        card.innerHTML = `
            ${isInferno && job.inferno_circle ? `<div class="inferno-banner">🔥 ${escapeHtml(job.inferno_circle)} · Toxicity ${job.toxicity_score}</div>` : ''}
            <div class="job-card-header">
                <div class="job-card-title-row">
                    <h4 class="job-card-title">${escapeHtml(job.title)}</h4>
                    <span class="days-badge">${getDaysLabel(job.days_since_posted)}</span>
                </div>
                <div class="job-card-company">
                    ${escapeHtml(job.company)}
                    ${job.is_ghost_job ? '<span class="badge pill-ghost" style="margin-left:0.5rem;">👻 GHOST</span>' : ''}
                </div>
            </div>
            <div class="pill-row">${buildPillRow(job)}</div>
            <div class="job-card-body">
                <div class="job-metrics-row">
                    <div class="metric-item" title="Core Score (0-100): 55% fit · 25% pay · 20% culture">
                        <div class="metric-val" style="color:var(--color-standard)">${job.match_score}/100</div>
                        <div class="metric-lbl">Core Score</div>
                    </div>
                    <div class="metric-item" title="Résumé fit (Delta-X)">
                        <div class="metric-val" style="color:${job.fit_score >= 50 ? 'var(--color-tier1)' : 'var(--text-secondary)'}">${job.fit_score}%</div>
                        <div class="metric-lbl">Fit</div>
                    </div>
                    <div class="metric-item" title="Culture health (green flags vs. yellow flags)">
                        <div class="metric-val" style="color:${job.culture_score >= 60 ? 'var(--color-tier1)' : job.culture_score <= 35 ? 'var(--color-tier4)' : 'var(--text-secondary)'}">${job.culture_score}%</div>
                        <div class="metric-lbl">Culture</div>
                    </div>
                    <div class="metric-item" title="Toxicity (red-flag weight)">
                        <div class="metric-val" style="color:${job.toxicity_score > 25 ? 'var(--color-tier4)' : 'var(--text-primary)'}">${job.toxicity_score}</div>
                        <div class="metric-lbl">Toxicity</div>
                    </div>
                </div>
                <div class="delta-row">
                    <span>Delta-X (Fit): <strong>${(job.delta_x || 0).toFixed(2)}</strong></span>
                    <span>Delta-Y (Trajectory): <strong>${job.delta_y === null || job.delta_y === undefined ? 'Unknown Trajectory' : `${job.delta_y >= 0 ? '+' : ''}${job.delta_y} ${trajectoryLabel(job.delta_y)}`}</strong></span>
                </div>
            </div>
            <div class="job-card-footer">
                <button class="view-btn" data-id="${job.id}">Details</button>
                ${job.apply_url ? `<a href="${escapeHtml(job.apply_url)}" target="_blank" rel="noopener noreferrer" class="apply-link">Apply ↗</a>` : ''}
                <button class="blacklist-card-btn" data-company="${escapeHtml(job.company)}" title="Blacklist this company">🚫</button>
            </div>
        `;

        card.querySelector('.view-btn').addEventListener('click', () => openModal(job));
        card.querySelector('.blacklist-card-btn').addEventListener('click', e => { e.stopPropagation(); quickBlacklist(job.company); });
        jobsGrid.appendChild(card);
    });
}

function trajectoryLabel(dy) {
    if (dy >= 2) return '⤴ reach';
    if (dy === 1) return '↗ step up';
    if (dy === 0) return '→ lateral';
    if (dy === -1) return '↘ step down';
    return '⤵ fallback';
}

function buildPillRow(job) {
    const pills = [];
    pills.push(buildTierPill(job.target_status, job.match_percentile));
    if (job.seniority_level && job.seniority_level !== 'unspecified') pills.push(`<span class="pill pill-seniority">◈ ${formatSeniority(job.seniority_level)}</span>`);
    if (job.salary_parseable && (job.salary_min > 0 || job.salary_max > 0)) {
        const lo = job.salary_min > 0 ? `$${Math.round(job.salary_min / 1000)}k` : '';
        const hi = job.salary_max > 0 ? `$${Math.round(job.salary_max / 1000)}k` : '';
        pills.push(`<span class="pill pill-salary">💰 ${lo && hi ? `${lo}–${hi}` : (hi || lo)}</span>`);
    } else {
        pills.push(`<span class="pill pill-salary-na">Salary N/A</span>`);
    }
    pills.push(buildLocationPill(job.location_type));
    pills.push(buildDaysPill(job.days_since_posted, job.is_stale));
    if (job.industry && job.industry !== 'other') pills.push(`<span class="pill pill-industry">⬡ ${formatIndustry(job.industry)}</span>`);
    pills.push(buildAppStatusPill(job.application_status));
    pills.push(buildApplyTypePill(job.apply_type));
    if (job.is_duplicate) pills.push(`<span class="pill pill-duplicate">⊘ Dupe</span>`);
    return pills.join('');
}

function buildTierPill(target_status, match_percentile) {
    let cls = 'pill-tier3', label = target_status || 'Unranked';
    if (target_status?.includes('Tier 1')) cls = 'pill-tier1';
    else if (target_status?.includes('Tier 2')) cls = 'pill-tier2';
    else if (target_status?.includes('Tier 3')) cls = 'pill-tier3';
    else if (target_status?.includes('Tier 4')) cls = 'pill-tier4';
    const pct = match_percentile != null ? ` · P${match_percentile}` : '';
    return `<span class="pill ${cls}">▲ ${label}${pct}</span>`;
}

function buildLocationPill(t) {
    const map = { remote: ['pill-remote', '⚡ Remote'], hybrid: ['pill-hybrid', '⇆ Hybrid'], on_site: ['pill-on_site', '⌂ On-Site'], unknown: ['pill-unknown', '? Location'] };
    const [cls, label] = map[t] || map.unknown;
    return `<span class="pill ${cls}">${label}</span>`;
}

function buildDaysPill(days, is_stale) {
    let cls = 'pill-days-ok';
    if (is_stale || days >= 22) cls = 'pill-days-stale';
    else if (days >= 15) cls = 'pill-days-warn';
    return `<span class="pill ${cls}">⏱ ${days}d</span>`;
}

function buildAppStatusPill(status) {
    const icons = { unseen: '◌', bookmarked: '★', applied: '✉', interviewing: '💬', offered: '🏆', rejected: '✕', passed: '—' };
    return `<span class="pill pill-app-${status || 'unseen'}">${icons[status] || '◌'} ${capitalize(status || 'unseen')}</span>`;
}

function buildApplyTypePill(t) {
    if (t === 'easy_apply') return `<span class="pill pill-easy-apply">⚡ Easy Apply</span>`;
    if (t === 'external_ats') return `<span class="pill pill-external-ats">⤴ ATS</span>`;
    return `<span class="pill pill-apply-unknown">? Apply</span>`;
}

function getTierCardClass(s) {
    if (!s) return '';
    if (s.includes('Tier 1')) return 'card-tier1';
    if (s.includes('Tier 2')) return 'card-tier2';
    if (s.includes('Tier 3')) return 'card-tier3';
    if (s.includes('Tier 4')) return 'card-tier4';
    return '';
}
function getStatusBadgeClass(s) {
    if (!s) return 'standard';
    if (s.includes('Tier 1')) return 'tier1';
    if (s.includes('Tier 2')) return 'tier2';
    if (s.includes('Tier 3')) return 'tier3';
    if (s.includes('Tier 4')) return 'tier4';
    return 'standard';
}
function getDaysLabel(days) { return (!days && days !== 0) ? '?' : (days === 1 ? '1d' : `${days}d`); }
function formatSeniority(s) { return ({ director: 'Director', manager: 'Manager', senior: 'Senior', entry: 'Entry', unspecified: '' })[s] || capitalize(s); }
function formatIndustry(s) {
    if (!s) return '';
    return ({ saas_tech: 'SaaS/Tech', telecom: 'Telecom', logistics_supply_chain: 'Logistics', finance_fintech: 'FinTech', real_estate: 'Real Estate', healthcare_tech: 'Health Tech', manufacturing: 'Manufacturing', retail_e_commerce: 'Retail/eCom', staffing_hr: 'Staffing/HR', ai_tech: 'AI/Tech', other: '' })[s] || capitalize(s.replace(/_/g, ' '));
}
function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

// =====================================================================
// Modal
// =====================================================================
async function openModal(job) {
    currentModalJobId = job.id;
    modalJobTitle.textContent = job.title;
    modalJobCompany.textContent = job.company;

    modalStatusBadge.className = `badge ${getStatusBadgeClass(job.target_status)}`;
    modalStatusBadge.textContent = job.computed_zone === 'inferno' ? '🔥 ' + (job.inferno_circle || 'Inferno') : (job.target_status || 'Pending');

    modalCoreScore.textContent = `${job.match_score}/100`;
    modalFitScore.textContent = `${job.fit_score}%`;
    modalToxicityScore.textContent = job.toxicity_score;
    modalCultureScore.textContent = `${job.culture_score}%`;
    modalAtsScore.textContent = job.ats_alignment_score ?? '—';

    modalSalary.textContent = (job.salary_parseable && (job.salary_min > 0 || job.salary_max > 0))
        ? `$${job.salary_min.toLocaleString()} – $${job.salary_max.toLocaleString()}` : 'Undisclosed';
    modalIndustry.textContent = formatIndustry(job.industry) || 'Unknown';
    modalSeniority.textContent = formatSeniority(job.seniority_level) || 'Unknown';
    modalLocation.textContent = capitalize(job.location_type) || 'Unknown';
    modalApplyType.textContent = capitalize((job.apply_type || '').replace('_', ' ')) || 'Unknown';
    modalPercentile.textContent = job.match_percentile != null ? `Top ${Math.max(1, 100 - job.match_percentile)}%` : '—';
    if (modalTrajectory) modalTrajectory.textContent = (job.delta_y === null || job.delta_y === undefined) ? 'Unknown Trajectory' : `${job.delta_y >= 0 ? '+' : ''}${job.delta_y} ${trajectoryLabel(job.delta_y)}`;

    const dateObj = new Date(job.posted_at);
    modalPostedDate.textContent = isNaN(dateObj) ? 'Unknown' : dateObj.toLocaleDateString();
    modalDaysSince.textContent = job.days_since_posted === 0 ? 'TODAY' : `${job.days_since_posted} days ago`;
    modalSourcePlatform.textContent = job.source_platform || 'Unknown';

    if (job.apply_url) { modalApplyBtn.style.display = 'inline-flex'; modalApplyBtn.dataset.url = job.apply_url; }
    else { modalApplyBtn.style.display = 'none'; modalApplyBtn.dataset.url = ''; }

    modalAppStatusSel.value = job.application_status || 'unseen';
    modalDescContent.innerHTML = 'Loading description…';
    detailsModal.showModal();
    copyBtnText.textContent = 'Copy to Clipboard';
    modalCopyBtn.classList.remove('copied');

    try {
        const record = await window.dbAdapter.getJobDetail(job.id);
        currentActiveDescription = record.description_full || record.description_clean || 'No description available.';
        modalDescContent.innerHTML = renderMarkdownSafe(currentActiveDescription);
    } catch (err) {
        console.error('Modal load error:', err);
        modalDescContent.textContent = 'Error loading description.';
        currentActiveDescription = '';
    }
}

async function saveModalStatus() {
    if (!currentModalJobId) return;
    const newStatus = modalAppStatusSel.value;
    try {
        await window.dbAdapter.saveJobStatus(currentModalJobId, newStatus);
        modalSaveStatusBtn.textContent = '✓ Saved';
        setTimeout(() => { modalSaveStatusBtn.textContent = 'Save'; }, 1800);
        const cached = allJobsCache.find(j => j.id === currentModalJobId);
        if (cached) cached.application_status = newStatus;
        const shown = jobListings.find(j => j.id === currentModalJobId);
        if (shown) shown.application_status = newStatus;
        
        const card = document.getElementById('job-card-' + currentModalJobId);
        if (card && shown) {
            const pillRow = card.querySelector('.pill-row');
            if (pillRow) pillRow.innerHTML = buildPillRow(shown);
        }
    } catch (err) {
        console.error('Status save error:', err);
        modalSaveStatusBtn.textContent = 'Error';
        setTimeout(() => { modalSaveStatusBtn.textContent = 'Save'; }, 2000);
    }
}

async function copyDescriptionToClipboard() {
    if (!currentActiveDescription) return;
    try {
        await navigator.clipboard.writeText(currentActiveDescription);
        copyBtnText.textContent = 'Copied!';
        modalCopyBtn.classList.add('copied');
        setTimeout(() => { copyBtnText.textContent = 'Copy to Clipboard'; modalCopyBtn.classList.remove('copied'); }, 2000);
    } catch (err) { alert('Failed to copy to clipboard.'); }
}

// =====================================================================
// CSV Export (with formula-injection guard)
// =====================================================================
async function exportCsv() {
    if (jobListings.length === 0) { alert('No jobs to export.'); return; }
    const headers = ['Title', 'Company', 'Zone', 'Target Status', 'Match Percentile', 'Core Score', 'Fit %', 'Culture %', 'Toxicity', 'ATS Alignment', 'Salary Min', 'Salary Max', 'Location Type', 'Seniority', 'Industry', 'Days Since Posted', 'Apply Type', 'App Status', 'Is Ghost', 'Is Duplicate', 'Is Stale', 'Apply URL', 'Source Platform', 'Description'];

    const rows = await Promise.all(jobListings.map(async job => {
        let desc = '';
        try { desc = (await window.dbAdapter.getJobDetail(job.id))?.description_full || ''; } catch { /* skip */ }
        return [job.title, job.company, job.computed_zone, job.target_status, job.match_percentile, job.match_score, job.fit_score, job.culture_score, job.toxicity_score, job.ats_alignment_score, job.salary_min, job.salary_max, job.location_type, job.seniority_level, job.industry, job.days_since_posted, job.apply_type, job.application_status, job.is_ghost_job, job.is_duplicate, job.is_stale, job.apply_url, job.source_platform, desc].map(csvCell);
    }));

    const csv = [headers.map(csvCell).join(','), ...rows.map(r => r.join(','))].join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `job_export_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// =====================================================================
// Filter Profiles
// =====================================================================
function getFilterState() {
    return { search: searchInput.value, sort: sortSelect.value, appStatus: appStatusFilter.value, location: locationFilter.value, recencyDays: currentRecencyDays, industry: industryFilter.value, salaryMin: salaryMin.value, salaryMax: salaryMax.value, hideGhost: hideGhostJobs.checked };
}
function applyFilterState(state) {
    if (!state) return;
    searchInput.value = state.search || '';
    sortSelect.value = state.sort || '-match_score';
    appStatusFilter.value = state.appStatus || 'ALL';
    locationFilter.value = state.location || 'ALL';
    setRecencyDays(state.recencyDays || 9999);
    industryFilter.value = state.industry || 'ALL';
    salaryMin.value = state.salaryMin || '';
    salaryMax.value = state.salaryMax || '';
    if (state.hideGhost !== undefined) hideGhostJobs.checked = state.hideGhost;
    fetchData(1, false);
}
function setRecencyDays(days) {
    currentRecencyDays = days;
    document.querySelectorAll('.recency-btn').forEach(btn => btn.classList.toggle('active', parseInt(btn.dataset.days) === days));
}
async function saveFilterProfile() {
    const name = prompt('Enter a profile name:');
    if (!name || !name.trim()) return;
    try { await window.dbAdapter.saveFilterProfile(name.trim(), getFilterState()); await loadFilterProfiles(); }
    catch (err) { console.error('Profile save error:', err); alert('Failed to save profile.'); }
}
async function loadFilterProfiles() {
    try {
        const list = await window.dbAdapter.getFilterProfiles();
        profileSelect.innerHTML = '<option value="">Load Profile…</option>';
        list.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id; opt.textContent = p.profile_name;
            opt.dataset.state = JSON.stringify(p.filter_state_json);
            profileSelect.appendChild(opt);
        });
    } catch { /* none */ }
}

// =====================================================================
// Company Blacklist
// =====================================================================
async function loadBlacklist() {
    try {
        const list = await window.dbAdapter.getBlacklist();
        blacklistData = list.map(i => ({ id: i.id, name: i.name }));
        renderBlacklistChips();
        rebuildFuse();
    } catch { /* empty */ }
}
function rebuildFuse() {
    fuseBlacklist = blacklistData.length === 0 ? null : new Fuse(blacklistData, { keys: ['name'], threshold: 0.35, includeScore: true });
}
function renderBlacklistChips() {
    blacklistList.innerHTML = blacklistData.length === 0 ? '<span style="color:var(--text-muted);font-size:0.8rem;">No companies blacklisted yet.</span>' : '';
    blacklistData.forEach(item => {
        const chip = document.createElement('span');
        chip.className = 'blacklist-chip';
        chip.innerHTML = `${escapeHtml(item.name)} <button title="Remove">×</button>`;
        chip.querySelector('button').addEventListener('click', () => removeBlacklist(item.id));
        blacklistList.appendChild(chip);
    });
}
async function addBlacklist(name, reason) {
    if (!name || !name.trim()) return;
    try {
        const rec = await window.dbAdapter.addBlacklist(name.trim(), reason);
        blacklistData.push({ id: rec.id, name: rec.name });
        renderBlacklistChips(); rebuildFuse(); fetchData(1, false);
    } catch (err) { console.error('Blacklist add error:', err); }
}
async function removeBlacklist(id) {
    try {
        await window.dbAdapter.removeBlacklist(id);
        blacklistData = blacklistData.filter(i => i.id !== id);
        renderBlacklistChips(); rebuildFuse(); fetchData(1, false);
    } catch (err) { console.error('Blacklist remove error:', err); }
}
async function quickBlacklist(companyName) {
    if (!confirm(`Blacklist "${companyName}"? It will be hidden from future views.`)) return;
    await addBlacklist(companyName, 'Quick blacklist from card');
    if (blacklistPanel.style.display === 'none') blacklistPanel.style.display = 'block';
}

// =====================================================================
// Strategy Dial — UI Filter (Exclusive Slicing)
// =====================================================================
let strategyDebounce;
async function onStrategyChange(val) {
    if (strategyLabel) strategyLabel.textContent = { 1: 'Survival', 2: 'Balanced', 3: 'Aggressive' }[val] || 'Balanced';
    await window.dbAdapter.saveUserProfile({ strategyDial: val });
    clearTimeout(strategyDebounce);
    strategyDebounce = setTimeout(() => {
        // Just re-render. dbAdapter handles the exclusive filtering based on strategy_tier.
        fetchData(1, false);
    }, 150);
}

// =====================================================================
// Background Re-score (Triggered on Schema Migration)
// =====================================================================
async function runBackgroundRescore() {
    try {
        console.log('[App] Starting v13 background rescore...');
        const toast = document.createElement('div');
        toast.className = 'migration-toast';
        toast.innerHTML = '⚙️ Upgrading scoring engine... your jobs are being re-evaluated.';
        toast.style.cssText = 'position:fixed; bottom:20px; right:20px; background:var(--color-tier2); color:#fff; padding:12px 20px; border-radius:8px; z-index:9999; box-shadow:0 4px 12px rgba(0,0,0,0.5); font-weight:600; font-size:0.9rem; transition: opacity 0.5s;';
        document.body.appendChild(toast);

        // Put grid in pending state
        document.querySelectorAll('.job-card').forEach(c => c.classList.add('card--pending'));
        
        await sleep(100);

        const profile = await window.dbAdapter.getUserProfile();
        const keywords = window.scoringCoordinator.buildProfileKeywords(profile);
        const blacklistNames = await window.dbAdapter.getBlacklistNames();
        const all = allJobsCache.length > 0 ? allJobsCache : await window.dbAdapter.getAllJobs();

        // Chunked processing to avoid blocking main thread
        const chunkSize = window.CONFIG?.SCORING_CHUNK_SIZE || 25;
        for (let i = 0; i < all.length; i += chunkSize) {
            const chunk = all.slice(i, i + chunkSize);
            for (const job of chunk) {
                try { window.scoringCoordinator.scoreAndClassifyJob(job, profile, blacklistNames, keywords); }
                catch (e) { console.error('Background re-score failed for', job.title, e); }
            }
            // Yield to main thread
            await sleep(10);
        }

        window.scoringCoordinator.distributeAndRank(all);
        await window.dbAdapter.persistJobs(all);
        allJobsCache = all;
        
        toast.innerHTML = '✅ Scoring upgrade complete.';
        toast.style.background = 'var(--color-tier1)';
        
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 500);
        }, 3000);

        fetchData(1, false);
    } catch (err) {
        console.error('Background rescore failed:', err);
    }
}

// =====================================================================
// Event Listeners
// =====================================================================
function setupEventListeners() {
    let debounce;
    searchInput.addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(() => fetchData(1, false), 300); });

    if (strategyDial) strategyDial.addEventListener('input', e => onStrategyChange(parseInt(e.target.value)));

    if (zoneTabs) {
        zoneTabs.querySelectorAll('.zone-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                zoneTabs.querySelectorAll('.zone-tab').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentActiveZone = btn.dataset.zone || 'strike';
                document.body.classList.toggle('inferno-mode', currentActiveZone === 'inferno');
                fetchData(1, false);
            });
        });
    }

    sortSelect.addEventListener('change', () => fetchData(1, false));
    appStatusFilter.addEventListener('change', () => fetchData(1, false));
    locationFilter.addEventListener('change', () => fetchData(1, false));
    industryFilter.addEventListener('change', () => fetchData(1, false));
    hideGhostJobs.addEventListener('change', () => fetchData(1, false));

    let salaryDebounce;
    const onSalary = () => { clearTimeout(salaryDebounce); salaryDebounce = setTimeout(() => fetchData(1, false), 500); };
    salaryMin.addEventListener('input', onSalary);
    salaryMax.addEventListener('input', onSalary);

    recencyToggle.querySelectorAll('.recency-btn').forEach(btn => btn.addEventListener('click', () => { setRecencyDays(parseInt(btn.dataset.days)); fetchData(1, false); }));

    loadMoreBtn.addEventListener('click', () => {
        if (!hasMore) return;
        loadMoreBtn.textContent = 'Loading…'; loadMoreBtn.disabled = true;
        fetchData(currentPage + 1, true).then(() => { loadMoreBtn.textContent = 'Load More Targets'; loadMoreBtn.disabled = false; });
    });

    closeModalBtn.addEventListener('click', () => detailsModal.close());
    detailsModal.addEventListener('click', e => { if (e.target === detailsModal) detailsModal.close(); });
    modalCopyBtn.addEventListener('click', copyDescriptionToClipboard);
    modalSaveStatusBtn.addEventListener('click', saveModalStatus);

    exportCsvBtn.addEventListener('click', exportCsv);
    saveFilterBtn.addEventListener('click', saveFilterProfile);
    profileSelect.addEventListener('change', () => {
        const opt = profileSelect.selectedOptions[0];
        if (opt && opt.dataset.state) { try { applyFilterState(JSON.parse(opt.dataset.state)); } catch { /* malformed */ } }
    });

    settingsToggleBtn.addEventListener('click', () => { blacklistPanel.style.display = blacklistPanel.style.display === 'none' ? 'block' : 'none'; });
    blacklistAddBtn.addEventListener('click', () => { addBlacklist(blacklistInput.value, blacklistReason.value); blacklistInput.value = ''; blacklistReason.value = ''; });
    blacklistInput.addEventListener('keydown', e => { if (e.key === 'Enter') blacklistAddBtn.click(); });

    ingestSweepBtn.addEventListener('click', runIngestionSweep);
    wizardReopenBtn.addEventListener('click', async () => { window.setupWizard.showWizardModal(await window.dbAdapter.getUserProfile()); });
    exportDbBtn.addEventListener('click', () => window.dataPortability.exportData());
    importDbTriggerBtn.addEventListener('click', () => importDbFile.click());
    importDbFile.addEventListener('change', async e => {
        const file = e.target.files[0];
        if (!file) return;
        if (confirm('Importing a backup will merge into your existing data. Proceed?')) {
            try { await window.dataPortability.importData(file); await loadAllJobs(); alert('Backup imported.'); fetchData(1, false); }
            catch (err) { alert(`Import failed: ${err.message}`); }
        }
        importDbFile.value = '';
    });
}

// =====================================================================
// Connection Status
// =====================================================================
function setConnectionStatus(connected, message) {
    if (connected) {
        connectionIndicator.style.backgroundColor = 'var(--color-tier1)';
        connectionIndicator.style.boxShadow = '0 0 8px var(--color-tier1)';
        connectionStatusText.textContent = 'IndexedDB Connected';
    } else {
        connectionIndicator.style.backgroundColor = 'var(--color-tier4)';
        connectionIndicator.style.boxShadow = '0 0 8px var(--color-tier4)';
        connectionStatusText.textContent = 'DB Connection Error';
        if (loader) loader.innerHTML = `<span style="color:var(--color-tier4)">Failed: ${escapeHtml(message || 'Unknown error')}</span>`;
    }
}

// =====================================================================
// Utilities
// =====================================================================
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// Only allow http(s) apply links (defuses javascript:/data: URLs from feeds).
function safeUrl(url) {
    if (!url) return '';
    try { const u = new URL(url, location.href); return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : ''; }
    catch { return ''; }
}

// Render untrusted job-description markdown → sanitized HTML.
function renderMarkdownSafe(text) {
    const md = (typeof marked !== 'undefined') ? marked.parse(text || '') : escapeHtml(text || '');
    if (typeof DOMPurify !== 'undefined') return DOMPurify.sanitize(md, { ALLOWED_ATTR: ['href', 'target', 'rel', 'class'], ADD_ATTR: ['target'] });
    // No sanitizer available → fall back to plain escaped text (never raw HTML).
    return escapeHtml(text || '');
}

// CSV cell with formula-injection guard.
function csvCell(v) {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return `"${s.replace(/"/g, '""')}"`;
}

function setStat(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }

// Global hook for the wizard to trigger the first sweep.
window.appInitSweep = runIngestionSweep;
