// =====================================================================
// Job Intelligence Dashboard — app.js  (Phase 1 PWA Edition)
// =====================================================================

// ── State ─────────────────────────────────────────────────────────────
let jobListings       = [];
let currentPage       = 1;
let hasMore           = true;
let currentRecencyDays = 14;
let blacklistData     = [];
let fuseBlacklist     = null;
let currentModalJobId = null;
let currentActiveDescription = "";
let currentActiveZone = "strike"; // Default zone

// ── DOM References ────────────────────────────────────────────────────
const loader            = document.getElementById('loader');
const noResults         = document.getElementById('no-results');
const jobsGrid          = document.getElementById('jobs-grid');
const loadMoreBtn       = document.getElementById('load-more-btn');
const searchInput       = document.getElementById('search-input');
const tabsGroup         = document.getElementById('tabs-group');
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

const connectionIndicator     = document.getElementById('connection-indicator');
const connectionStatusText    = document.getElementById('connection-status-text');
const statTotalJobs     = document.getElementById('stat-total-jobs');
const statTier1         = document.getElementById('stat-tier1');
const statTier2         = document.getElementById('stat-tier2');
const statAvgLeverage   = document.getElementById('stat-avg-leverage');

const detailsModal      = document.getElementById('details-modal');
const modalJobTitle     = document.getElementById('modal-job-title');
const modalJobCompany   = document.getElementById('modal-job-company');
const modalStatusBadge  = document.getElementById('modal-status-badge');
const modalSkillsCount  = document.getElementById('modal-skills-count');
const modalToxicityScore = document.getElementById('modal-toxicity-score');
const modalLeverageRatio = document.getElementById('modal-leverage-ratio');
const modalAtsScore     = document.getElementById('modal-ats-score');

const modalSalary       = document.getElementById('modal-salary');
const modalIndustry     = document.getElementById('modal-industry');
const modalSeniority    = document.getElementById('modal-seniority');
const modalLocation     = document.getElementById('modal-location');
const modalApplyType    = document.getElementById('modal-apply-type');
const modalPercentile   = document.getElementById('modal-percentile');
const modalTitleScore   = document.getElementById('modal-title-score');
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

// PWA Portability DOM refs
const ingestSweepBtn    = document.getElementById('ingest-sweep-btn');
const wizardReopenBtn   = document.getElementById('wizard-reopen-btn');
const exportDbBtn       = document.getElementById('export-db-btn');
const importDbTriggerBtn = document.getElementById('import-db-trigger-btn');
const importDbFile      = document.getElementById('import-db-file');

// ── Init ──────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    // 1. Register Service Worker for PWA
    if ('serviceWorker' in navigator) {
        try {
            const reg = await navigator.serviceWorker.register('./sw.js');
            console.log('[PWA] Service Worker registered:', reg.scope);
        } catch (err) {
            console.error('[PWA] Service Worker registration failed:', err);
        }
    }

    // 2. Setup standard event listeners
    setupEventListeners();

    // 3. Initialize Dexie DB connection UI status
    setConnectionStatus(true);

    // 4. Initialize first-run Setup Wizard
    await window.setupWizard.init();

    // 5. Load DB profiles & data portability checks
    await window.dataPortability.checkExportReminder();
    await loadBlacklist();
    await loadFilterProfiles();
    
    // 6. Fetch initial jobs
    fetchData(1, false);
});

// =====================================================================
// Direct In-Browser Ingestion Sweep
// =====================================================================
async function runIngestionSweep() {
    try {
        ingestSweepBtn.disabled = true;
        ingestSweepBtn.innerHTML = `⏳ Scraping...`;
        
        loader.style.display = 'flex';
        loader.querySelector('span').textContent = 'Ingesting Direct RSS & API streams...';

        const profile = await window.dbAdapter.getUserProfile();
        const queries = (profile.search_queries && profile.search_queries.length > 0) ? profile.search_queries : window.CONFIG.DEFAULT_SEARCH_QUERIES;
        const location = profile.location || 'Springfield, MO';
        
        let allJobs = [];

        // ── 1. Fetch Indeed RSS feeds ──
        for (const query of queries) {
            try {
                const rssJobs = await window.rssAdapter.fetchJobs(query, location);
                allJobs.push(...rssJobs);
            } catch (err) {
                console.error(`[Ingest Sweep] Indeed RSS query "${query}" failed:`, err);
            }
        }

        // ── 2. Fetch Remotive remote jobs ──
        try {
            const remotiveJobs = await window.remotiveApi.fetchJobs('sales');
            const remotiveTech = await window.remotiveApi.fetchJobs('developer');
            allJobs.push(...remotiveJobs, ...remotiveTech);
        } catch (err) {
            console.error('[Ingest Sweep] Remotive fetch failed:', err);
        }

        // ── 3. Fetch ATS direct watchlists ──
        const watchlist = await window.dbAdapter.getATSWatchlist();
        const activeAts = watchlist.filter(item => item.active);
        
        if (activeAts.length > 0) {
            console.log(`[Ingest Sweep] Polling ${activeAts.length} active ATS watchlist items...`);
            for (const entry of activeAts) {
                try {
                    let atsJobs = [];
                    if (entry.ats_type === 'greenhouse') {
                        const url = `https://boards-api.greenhouse.io/v1/boards/${entry.company_slug}/jobs?content=true`;
                        const resp = await window.fetchWithCORS(url);
                        const data = await resp.json();
                        const jobs = data.jobs || [];
                        
                        for (const j of jobs) {
                            const hash = await window.generateSHA256(entry.company_name, j.title, j.location?.name || 'Remote');
                            atsJobs.push({
                                title: j.title || 'Unknown Title',
                                company_name: entry.company_name,
                                job_location: j.location?.name || 'Remote',
                                description_full: j.content || '',
                                apply_url: j.absolute_url || '',
                                posted_at: j.updated_at || new Date().toISOString(),
                                days_since_posted: 0,
                                source_platform: 'ats_direct_greenhouse',
                                payload_hash: hash,
                                application_status: 'unseen',
                                is_eligible: null
                            });
                        }
                    } else if (entry.ats_type === 'lever') {
                        const url = `https://api.lever.co/v0/postings/${entry.company_slug}?mode=json`;
                        const resp = await window.fetchWithCORS(url);
                        const postings = await resp.json();
                        
                        for (const j of postings) {
                            const hash = await window.generateSHA256(entry.company_name, j.text, j.categories?.location || 'Remote');
                            atsJobs.push({
                                title: j.text || 'Unknown Title',
                                company_name: entry.company_name,
                                job_location: j.categories?.location || 'Remote',
                                description_full: j.descriptionPlain || '',
                                apply_url: j.hostedUrl || '',
                                posted_at: j.createdAt ? new Date(j.createdAt).toISOString() : new Date().toISOString(),
                                days_since_posted: 0,
                                source_platform: 'ats_direct_lever',
                                payload_hash: hash,
                                application_status: 'unseen',
                                is_eligible: null
                            });
                        }
                    }
                    allJobs.push(...atsJobs);
                } catch (err) {
                    console.error(`[Ingest Sweep] ATS Watchlist poll failed for ${entry.company_name}:`, err);
                }
            }
        }

        console.log(`[Ingest Sweep] Unprocessed job postings collected: ${allJobs.length}`);
        
        // ── 4. Score, classify, and filter job listings ──
        loader.querySelector('span').textContent = 'Processing and scoring acquired targets...';
        const blacklistNames = blacklistData.map(b => b.name);
        const processedJobs = [];

        for (const job of allJobs) {
            try {
                const scored = await window.scoringCoordinator.scoreAndClassifyJob(job, profile, blacklistNames);
                processedJobs.push(scored);
            } catch (err) {
                console.error('[Ingest Sweep] Scoring failed for record:', job.title, err);
            }
        }

        // ── 5. Recalculate percentiles for eligible jobs ──
        const finalJobs = window.scoringCoordinator.recalculatePercentiles(processedJobs, strategyDial ? strategyDial.value : 2);

        // ── 6. Save directly to IndexedDB ──
        loader.querySelector('span').textContent = 'Saving pipeline results to local database...';
        const { newInserts, duplicates } = await window.dbAdapter.saveJobsBulk(finalJobs);

        const raw_scraped_count = allJobs.length;
        const ineligibleCount = finalJobs.filter(j => j.is_eligible === false).length;
        const discarded_count = ineligibleCount + duplicates;
        
        const rawEl = document.getElementById('stat-raw-ingested');
        const discEl = document.getElementById('stat-discarded');
        if (rawEl) rawEl.textContent = raw_scraped_count;
        if (discEl) discEl.textContent = discarded_count;

        alert(`Sweep complete! Acquired ${newInserts} new eligible jobs. Skipped ${duplicates} duplicate entries.`);
        
        // Reload UI Grid
        fetchData(1, false);

    } catch (err) {
        console.error('[Ingest Sweep] Core extraction failure:', err);
        alert(`Ingest sweep failed: ${err.message}`);
    } finally {
        ingestSweepBtn.disabled = false;
        ingestSweepBtn.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            Ingest Sweep
        `;
        loader.style.display = 'none';
    }
}

// =====================================================================
// Core Fetch
// =====================================================================
async function fetchData(page = 1, append = false) {
    try {
        if (!append) {
            loader.style.display = 'flex';
            jobsGrid.innerHTML   = '';
            jobListings          = [];
        }
        noResults.style.display = 'none';
        loadMoreBtn.style.display = 'none';

        // Toggle .inferno-mode on body wrapper based on active zone
        const workspace = document.querySelector('main.container') || document.body;
        if (currentActiveZone === 'inferno') {
            workspace.classList.add('inferno-mode');
        } else {
            workspace.classList.remove('inferno-mode');
        }

        // Gather current filter state
        const filters = {
            search: searchInput.value,
            sort:   sortSelect.value,
            appStatus: appStatusFilter.value,
            location: locationFilter.value,
            recencyDays: currentRecencyDays,
            industry: industryFilter.value,
            salaryMin: salaryMin.value,
            salaryMax: salaryMax.value,
            hideGhost: hideGhostJobs.checked
        };

        // Query database adapter (Dexie)
        const resultList = await window.dbAdapter.getJobs(filters, page, 50);

        // Run client-side zone/percentile/strategy allocation on database results dynamically
        const processedItems = window.scoringCoordinator.recalculatePercentiles(resultList.items, strategyDial ? strategyDial.value : 2);

        const newListings = processedItems.map(r => ({
            id:                 r.id,
            title:              r.title || 'Unknown Title',
            company:            r.company_name || 'Unknown Company',
            toxicity_score:     r.toxicity_score     ?? 0,
            skill_match_score:  r.skill_match_score  ?? 0,
            role_title_score:   r.role_title_score   ?? 0,
            leverage_ratio:     r.leverage_ratio      ?? 0,
            final_leverage_ratio: r.final_leverage_ratio ?? 0,
            match_percentile:   r.match_percentile   ?? 0,
            target_status:      r.target_status      || 'Pending',
            salary_min:         r.salary_min         || 0,
            salary_max:         r.salary_max         || 0,
            salary_parseable:   r.salary_parseable   || false,
            apply_url:          r.apply_url          || '#',
            posted_at:          r.posted_at          || '',
            days_since_posted:  r.days_since_posted  ?? 0,
            location_type:      r.location_type      || 'unknown',
            seniority_level:    r.seniority_level    || 'unspecified',
            industry:           r.industry           || '',
            application_status: r.application_status || 'unseen',
            apply_type:         r.apply_type         || 'unknown',
            is_ghost_job:       r.is_ghost_job       || false,
            is_duplicate:       r.is_duplicate       || false,
            is_stale:           r.is_stale           || false,
            ats_alignment_score: r.ats_alignment_score ?? 0,
            source_platform:    r.source_platform    || '',
            computed_zone:      r.computed_zone      || 'strike',
            inferno_circle:     r.inferno_circle     || null,
            delta_x:            r.delta_x            ?? 0,
            delta_y:            r.delta_y            ?? 0
        }));

        // Filter only matches in current active tab zone
        let zoneMatched = newListings.filter(j => j.computed_zone === currentActiveZone);

        // Client-side blacklist fuzzy filter
        const filtered = fuseBlacklist && blacklistData.length > 0
            ? zoneMatched.filter(j => {
                const results = fuseBlacklist.search(j.company);
                return results.length === 0;
            })
            : zoneMatched;

        jobListings = append ? [...jobListings, ...filtered] : filtered;
        currentPage = page;
        hasMore     = resultList.page < resultList.totalPages;

        calculateStats(jobListings.length); // Use current displayed count
        renderCards();

        if (hasMore) loadMoreBtn.style.display = 'inline-block';

    } catch (err) {
        console.error('Fetch error:', err);
        setConnectionStatus(false, err.message);
    } finally {
        if (!append) loader.style.display = 'none';
    }
}

// =====================================================================
// Stats
// =====================================================================
function calculateStats(totalItems) {
    statTotalJobs.textContent = totalItems;

    const tier1 = jobListings.filter(j => j.target_status === 'Tier 1 / Top Match').length;
    const tier2 = jobListings.filter(j => j.target_status === 'Tier 2 / Strong Match').length;
    statTier1.textContent = tier1 + (hasMore ? '+' : '');
    statTier2.textContent = tier2 + (hasMore ? '+' : '');

    if (jobListings.length > 0) {
        const sum = jobListings.reduce((s, j) => s + (j.final_leverage_ratio || 0), 0);
        statAvgLeverage.textContent = (sum / jobListings.length).toFixed(2);
    } else {
        statAvgLeverage.textContent = '0.00';
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
        const isInferno = job.computed_zone === 'inferno';
        card.className = `job-card ${getTierCardClass(job.target_status)} ${job.is_stale ? 'card-stale' : ''} ${isInferno ? 'inferno-card' : ''}`;

        card.innerHTML = `
            ${isInferno && job.inferno_circle ? `<div class="inferno-banner">🔥 ${escapeHtml(job.inferno_circle)}</div>` : ''}
            <div class="job-card-header">
                <div class="job-card-title-row">
                    <h4 class="job-card-title">${escapeHtml(job.title)}</h4>
                    <span class="days-badge">${getDaysLabel(job.days_since_posted)}</span>
                </div>
                <div class="job-card-company">
                    ${escapeHtml(job.company)}
                    ${job.is_ghost_job ? '<span class="badge" style="background:var(--color-tier4); color:#fff; font-size:0.7rem; margin-left:0.5rem; padding: 0.1rem 0.4rem;">GHOST JOB WARNING</span>' : ''}
                </div>
            </div>
            <div class="pill-row">
                ${buildPillRow(job)}
            </div>
            <div class="job-card-body">
                <div class="job-metrics-row">
                    <div class="metric-item" title="Technical Skill match overlap score">
                        <div class="metric-val" style="color:var(--color-standard)">${job.skill_match_score}</div>
                        <div class="metric-lbl">Skills</div>
                    </div>
                    <div class="metric-item" title="Culture mismatch toxicity index">
                        <div class="metric-val" style="color:${job.toxicity_score > 1 ? 'var(--color-tier4)' : 'var(--text-primary)'}">${job.toxicity_score}</div>
                        <div class="metric-lbl">Toxicity</div>
                    </div>
                    <div class="metric-item" title="Scored leverage coefficient">
                        <div class="metric-val" style="color:${job.final_leverage_ratio >= 3 ? 'var(--color-tier1)' : 'var(--text-secondary)'}">${(job.final_leverage_ratio || 0).toFixed(2)}</div>
                        <div class="metric-lbl">Leverage</div>
                    </div>
                </div>
                ${!isInferno ? `
                <div style="font-size:0.72rem; color:var(--text-muted); margin-top:0.5rem; border-top:1px solid var(--border-color); padding-top:0.35rem; display:flex; justify-content:space-between;">
                    <span>Delta-X (Skills Ratio): <strong>${(job.delta_x || 0).toFixed(2)}</strong></span>
                    <span>Delta-Y (Seniority Steps): <strong>${job.delta_y >= 0 ? '+' : ''}${job.delta_y}</strong></span>
                </div>
                ` : ''}
            </div>
            <div class="job-card-footer">
                <button class="view-btn" data-id="${job.id}">Details</button>
                ${job.apply_url && job.apply_url !== '#'
                    ? `<a href="${job.apply_url}" target="_blank" rel="noopener" class="apply-link">Apply ↗</a>`
                    : ''}
                <button class="blacklist-card-btn" data-company="${escapeHtml(job.company)}" title="Blacklist this company">🚫</button>
            </div>
        `;

        card.querySelector('.view-btn').addEventListener('click', () => openModal(job));
        card.querySelector('.blacklist-card-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            quickBlacklist(job.company);
        });

        jobsGrid.appendChild(card);
    });
}

function buildPillRow(job) {
    const pills = [];

    // 1. Tier / percentile
    pills.push(buildTierPill(job.target_status, job.match_percentile));

    // 2. Seniority
    if (job.seniority_level && job.seniority_level !== 'unspecified') {
        pills.push(`<span class="pill pill-seniority">◈ ${formatSeniority(job.seniority_level)}</span>`);
    }

    // 3. Salary
    if (job.salary_parseable && (job.salary_min > 0 || job.salary_max > 0)) {
        const lo = job.salary_min > 0 ? `$${Math.round(job.salary_min/1000)}k` : '';
        const hi = job.salary_max > 0 ? `$${Math.round(job.salary_max/1000)}k` : '';
        const range = lo && hi ? `${lo}–${hi}` : (hi || lo);
        pills.push(`<span class="pill pill-salary">💰 ${range}</span>`);
    } else {
        pills.push(`<span class="pill pill-salary-na">Salary N/A</span>`);
    }

    // 4. Location type
    pills.push(buildLocationPill(job.location_type));

    // 5. Days since posted
    pills.push(buildDaysPill(job.days_since_posted, job.is_stale));

    // 6. Industry
    if (job.industry && job.industry !== 'other') {
        pills.push(`<span class="pill pill-industry">⬡ ${formatIndustry(job.industry)}</span>`);
    }

    // 7. App status
    pills.push(buildAppStatusPill(job.application_status));

    // 8. Apply type
    pills.push(buildApplyTypePill(job.apply_type));

    // Bonus flags
    if (job.is_ghost_job)   pills.push(`<span class="pill pill-ghost">👻 Ghost</span>`);
    if (job.is_duplicate)   pills.push(`<span class="pill pill-duplicate">⊘ Dupe</span>`);

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

function buildLocationPill(location_type) {
    const map = {
        remote:  ['pill-remote',  '⚡ Remote'],
        hybrid:  ['pill-hybrid',  '⇆ Hybrid'],
        on_site: ['pill-on_site', '⌂ On-Site'],
        unknown: ['pill-unknown', '? Location'],
    };
    const [cls, label] = map[location_type] || map.unknown;
    return `<span class="pill ${cls}">${label}</span>`;
}

function buildDaysPill(days, is_stale) {
    let cls = 'pill-days-ok';
    if (is_stale || days >= 22) cls = 'pill-days-stale';
    else if (days >= 15)        cls = 'pill-days-warn';
    return `<span class="pill ${cls}">⏱ ${days}d</span>`;
}

function buildAppStatusPill(status) {
    const cls = `pill-app-${status || 'unseen'}`;
    const icons = {
        unseen:       '◌', bookmarked: '★', applied:     '✉',
        interviewing: '💬', offered:   '🏆', rejected:   '✕', passed: '—'
    };
    const icon = icons[status] || '◌';
    return `<span class="pill ${cls}">${icon} ${capitalize(status || 'unseen')}</span>`;
}

function buildApplyTypePill(apply_type) {
    if (apply_type === 'easy_apply')   return `<span class="pill pill-easy-apply">⚡ Easy Apply</span>`;
    if (apply_type === 'external_ats') return `<span class="pill pill-external-ats">⤴ ATS</span>`;
    return `<span class="pill pill-apply-unknown">? Apply</span>`;
}

function getTierCardClass(target_status) {
    if (!target_status) return '';
    if (target_status.includes('Tier 1')) return 'card-tier1';
    if (target_status.includes('Tier 2')) return 'card-tier2';
    if (target_status.includes('Tier 3')) return 'card-tier3';
    if (target_status.includes('Tier 4')) return 'card-tier4';
    return '';
}

function getStatusBadgeClass(target_status) {
    if (!target_status) return 'standard';
    if (target_status.includes('Tier 1')) return 'tier1';
    if (target_status.includes('Tier 2')) return 'tier2';
    if (target_status.includes('Tier 3')) return 'tier3';
    if (target_status.includes('Tier 4')) return 'tier4';
    return 'standard';
}

function getDaysLabel(days) {
    if (!days && days !== 0) return '?';
    return days === 1 ? '1d' : `${days}d`;
}

function formatSeniority(s) {
    const m = { director: 'Director', manager: 'Manager', senior: 'Senior', entry: 'Entry', unspecified: '' };
    return m[s] || capitalize(s);
}

function formatIndustry(s) {
    if (!s) return '';
    const m = {
        saas_tech: 'SaaS/Tech', telecom: 'Telecom', logistics_supply_chain: 'Logistics',
        finance_fintech: 'FinTech', real_estate: 'Real Estate', healthcare_tech: 'Health Tech',
        manufacturing: 'Manufacturing', retail_e_commerce: 'Retail/eCom', staffing_hr: 'Staffing/HR',
        ai_tech: 'AI/Tech', other: ''
    };
    return m[s] || capitalize(s.replace(/_/g, ' '));
}

function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

// =====================================================================
// Modal
// =====================================================================
async function openModal(job) {
    currentModalJobId = job.id;
    modalJobTitle.textContent   = job.title;
    modalJobCompany.textContent = job.company;

    const badgeCls = getStatusBadgeClass(job.target_status);
    modalStatusBadge.className  = `badge ${badgeCls}`;
    modalStatusBadge.textContent = job.target_status || 'Pending';

    modalSkillsCount.textContent  = job.skill_match_score;
    modalToxicityScore.textContent = job.toxicity_score;
    modalLeverageRatio.textContent = (job.final_leverage_ratio || 0).toFixed(2);
    modalAtsScore.textContent      = job.ats_alignment_score ?? '—';
    
    modalSalary.textContent = (job.salary_parseable && (job.salary_min > 0 || job.salary_max > 0)) 
        ? `$${job.salary_min.toLocaleString()} – $${job.salary_max.toLocaleString()}` : 'Undisclosed';
    modalIndustry.textContent = formatIndustry(job.industry) || 'Unknown';
    modalSeniority.textContent = formatSeniority(job.seniority_level) || 'Unknown';
    modalLocation.textContent = capitalize(job.location_type) || 'Unknown';
    modalApplyType.textContent = capitalize(job.apply_type ? job.apply_type.replace('_', ' ') : '') || 'Unknown';
    modalPercentile.textContent = job.match_percentile ? `Top ${100 - job.match_percentile}%` : 'Unknown';
    modalTitleScore.textContent = job.role_title_score || 0;
    
    const dateObj = new Date(job.posted_at);
    modalPostedDate.textContent = isNaN(dateObj) ? 'Unknown' : dateObj.toLocaleDateString();
    modalDaysSince.textContent = job.days_since_posted === 0 ? 'TODAY' : `${job.days_since_posted} days ago`;
    modalSourcePlatform.textContent = job.source_platform || 'Unknown';

    if (job.apply_url && job.apply_url !== '#') {
        modalApplyBtn.style.display = 'inline-flex';
        modalApplyBtn.dataset.url = job.apply_url;
    } else {
        modalApplyBtn.style.display = 'none';
        modalApplyBtn.dataset.url = '';
    }

    modalAppStatusSel.value = job.application_status || 'unseen';
    modalDescContent.innerHTML = 'Loading description…';
    detailsModal.showModal();

    copyBtnText.textContent = 'Copy to Clipboard';
    modalCopyBtn.classList.remove('copied');

    try {
        const record = await window.dbAdapter.getJobDetail(job.id);
        currentActiveDescription = record.description_full || record.description_clean || 'No description available.';
        if (typeof marked !== 'undefined') {
            modalDescContent.innerHTML = marked.parse(currentActiveDescription);
        } else {
            modalDescContent.textContent = currentActiveDescription;
        }
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
        
        // Update local state
        const job = jobListings.find(j => j.id === currentModalJobId);
        if (job) job.application_status = newStatus;
        renderCards();
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
        setTimeout(() => {
            copyBtnText.textContent = 'Copy to Clipboard';
            modalCopyBtn.classList.remove('copied');
        }, 2000);
    } catch (err) {
        alert('Failed to copy to clipboard.');
    }
}

// =====================================================================
// CSV Export
// =====================================================================
async function exportCsv() {
    if (jobListings.length === 0) { alert('No jobs to export.'); return; }

    const headers = [
        'Title','Company','Target Status','Match Percentile','Skill Match',
        'Toxicity','Leverage Ratio','Final Leverage','Salary Min','Salary Max',
        'Location Type','Seniority','Industry','Days Since Posted','Apply Type',
        'App Status','Is Ghost','Is Duplicate','Is Stale','ATS Alignment',
        'Apply URL','Source Platform','Description'
    ];

    const rows = await Promise.all(jobListings.map(async job => {
        let desc = '';
        try {
            const rec = await window.dbAdapter.getJobDetail(job.id);
            desc = rec.description_full || '';
        } catch { /* skip */ }

        return [
            job.title, job.company, job.target_status, job.match_percentile,
            job.skill_match_score, job.toxicity_score, job.leverage_ratio, job.final_leverage_ratio,
            job.salary_min, job.salary_max, job.location_type, job.seniority_level,
            job.industry, job.days_since_posted, job.apply_type, job.application_status,
            job.is_ghost_job, job.is_duplicate, job.is_stale, job.ats_alignment_score,
            job.apply_url, job.source_platform, desc
        ].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`);
    }));

    const csvContent = [headers.map(h => `"${h}"`).join(','), ...rows.map(r => r.join(','))].join('\n');
    const dateStr = new Date().toISOString().slice(0, 10);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `job_export_${dateStr}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// =====================================================================
// Filter Profiles
// =====================================================================
function getFilterState() {
    return {
        search: searchInput.value,
        sort:   sortSelect.value,
        appStatus: appStatusFilter.value,
        location: locationFilter.value,
        recencyDays: currentRecencyDays,
        industry: industryFilter.value,
        salaryMin: salaryMin.value,
        salaryMax: salaryMax.value,
        hideGhost: hideGhostJobs.checked
    };
}

function applyFilterState(state) {
    if (!state) return;
    searchInput.value  = state.search  || '';
    sortSelect.value   = state.sort    || '-final_leverage_ratio';
    appStatusFilter.value = state.appStatus || 'ALL';
    locationFilter.value  = state.location  || 'ALL';
    setRecencyDays(state.recencyDays || 14);
    industryFilter.value = state.industry || 'ALL';
    salaryMin.value = state.salaryMin || '';
    salaryMax.value = state.salaryMax || '';
    if (state.hideGhost !== undefined) hideGhostJobs.checked = state.hideGhost;
    fetchData(1, false);
}

function setRecencyDays(days) {
    currentRecencyDays = days;
    document.querySelectorAll('.recency-btn').forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.dataset.days) === days);
    });
}

async function saveFilterProfile() {
    const name = prompt('Enter a profile name:');
    if (!name || !name.trim()) return;
    try {
        await window.dbAdapter.saveFilterProfile(name.trim(), getFilterState());
        await loadFilterProfiles();
    } catch (err) {
        console.error('Profile save error:', err);
        alert('Failed to save profile.');
    }
}

async function loadFilterProfiles() {
    try {
        const list = await window.dbAdapter.getFilterProfiles();
        profileSelect.innerHTML = '<option value="">Load Profile…</option>';
        list.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.profile_name;
            opt.dataset.state = JSON.stringify(p.filter_state_json);
            profileSelect.appendChild(opt);
        });
    } catch { /* No profiles */ }
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
    } catch { /* Empty */ }
}

function rebuildFuse() {
    if (blacklistData.length === 0) { fuseBlacklist = null; return; }
    fuseBlacklist = new Fuse(blacklistData, {
        keys: ['name'],
        threshold: 0.35,
        includeScore: true
    });
}

function renderBlacklistChips() {
    blacklistList.innerHTML = blacklistData.length === 0
        ? '<span style="color:var(--text-muted);font-size:0.8rem;">No companies blacklisted yet.</span>'
        : '';
    blacklistData.forEach(item => {
        const chip = document.createElement('span');
        chip.className = 'blacklist-chip';
        chip.innerHTML = `${escapeHtml(item.name)} <button data-id="${item.id}" title="Remove">×</button>`;
        chip.querySelector('button').addEventListener('click', () => removeBlacklist(item.id));
        blacklistList.appendChild(chip);
    });
}

async function addBlacklist(name, reason) {
    if (!name || !name.trim()) return;
    try {
        const rec = await window.dbAdapter.addBlacklist(name.trim(), reason);
        blacklistData.push({ id: rec.id, name: rec.name });
        renderBlacklistChips();
        rebuildFuse();
        fetchData(1, false);
    } catch (err) {
        console.error('Blacklist add error:', err);
    }
}

async function removeBlacklist(id) {
    try {
        await window.dbAdapter.removeBlacklist(id);
        blacklistData = blacklistData.filter(i => i.id !== id);
        renderBlacklistChips();
        rebuildFuse();
        fetchData(1, false);
    } catch (err) {
        console.error('Blacklist remove error:', err);
    }
}

async function quickBlacklist(companyName) {
    if (!confirm(`Blacklist "${companyName}"? It will be hidden from future views.`)) return;
    await addBlacklist(companyName, 'Quick blacklist from card');
    if (blacklistPanel.style.display === 'none') {
        blacklistPanel.style.display = 'block';
    }
}

// =====================================================================
// Event Listeners
// =====================================================================
function setupEventListeners() {
    let debounce;
    searchInput.addEventListener('input', () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => fetchData(1, false), 300);
    });

    // Strategy Dial slider
    if (strategyDial) {
        strategyDial.addEventListener('input', (e) => {
            const val = parseInt(e.target.value);
            const labels = {
                1: "Survival Mode (Desperate)",
                2: "Balanced (Standard)",
                3: "Aggressive Growth (Confident)"
            };
            if (strategyLabel) strategyLabel.textContent = labels[val] || "Balanced";
            fetchData(1, false);
        });
    }

    // Tabs group navigation
    if (tabsGroup) {
        tabsGroup.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                tabsGroup.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentActiveZone = btn.dataset.zone || 'strike';
                fetchData(1, false);
            });
        });
    }

    sortSelect.addEventListener('change',      () => fetchData(1, false));
    appStatusFilter.addEventListener('change', () => fetchData(1, false));
    locationFilter.addEventListener('change',  () => fetchData(1, false));
    industryFilter.addEventListener('change',  () => fetchData(1, false));
    hideGhostJobs.addEventListener('change',   () => fetchData(1, false));
    
    let salaryDebounce;
    const onSalaryChange = () => {
        clearTimeout(salaryDebounce);
        salaryDebounce = setTimeout(() => fetchData(1, false), 500);
    };
    salaryMin.addEventListener('input', onSalaryChange);
    salaryMax.addEventListener('input', onSalaryChange);

    // Recency toggle buttons
    recencyToggle.querySelectorAll('.recency-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const days = parseInt(btn.dataset.days);
            setRecencyDays(days);
            fetchData(1, false);
        });
    });

    loadMoreBtn.addEventListener('click', () => {
        if (!hasMore) return;
        loadMoreBtn.textContent = 'Loading…';
        loadMoreBtn.disabled = true;
        fetchData(currentPage + 1, true).then(() => {
            loadMoreBtn.textContent = 'Load More Targets';
            loadMoreBtn.disabled = false;
        });
    });

    closeModalBtn.addEventListener('click',  () => detailsModal.close());
    detailsModal.addEventListener('click', e => { if (e.target === detailsModal) detailsModal.close(); });
    modalCopyBtn.addEventListener('click',       copyDescriptionToClipboard);
    modalSaveStatusBtn.addEventListener('click', saveModalStatus);

    exportCsvBtn.addEventListener('click',   exportCsv);
    saveFilterBtn.addEventListener('click',  saveFilterProfile);

    profileSelect.addEventListener('change', () => {
        const opt = profileSelect.selectedOptions[0];
        if (opt && opt.dataset.state) {
            try { applyFilterState(JSON.parse(opt.dataset.state)); } catch { /* malformed */ }
        }
    });

    // Settings panel toggle
    settingsToggleBtn.addEventListener('click', () => {
        blacklistPanel.style.display = blacklistPanel.style.display === 'none' ? 'block' : 'none';
    });

    // Blacklist add
    blacklistAddBtn.addEventListener('click', () => {
        addBlacklist(blacklistInput.value, blacklistReason.value);
        blacklistInput.value = '';
        blacklistReason.value = '';
    });
    blacklistInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') blacklistAddBtn.click();
    });

    // PWA data portability & settings actions
    ingestSweepBtn.addEventListener('click', runIngestionSweep);
    
    wizardReopenBtn.addEventListener('click', async () => {
        const profile = await window.dbAdapter.getUserProfile();
        window.setupWizard.showWizardModal(profile);
    });
    
    exportDbBtn.addEventListener('click', () => {
        window.dataPortability.exportData();
    });
    
    importDbTriggerBtn.addEventListener('click', () => {
        importDbFile.click();
    });
    
    importDbFile.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        if (confirm('Importing database backup will merge existing items. Proceed?')) {
            try {
                await window.dataPortability.importData(file);
                alert('Database backup imported successfully.');
                fetchData(1, false);
            } catch (err) {
                alert(`Import failed: ${err.message}`);
            }
        }
        importDbFile.value = ''; // Reset
    });
}

// =====================================================================
// Connection Status
// =====================================================================
function setConnectionStatus(connected, message) {
    if (connected) {
        connectionIndicator.style.backgroundColor = 'var(--color-tier1)';
        connectionIndicator.style.boxShadow       = '0 0 8px var(--color-tier1)';
        connectionStatusText.textContent           = 'IndexedDB Connected';
    } else {
        connectionIndicator.style.backgroundColor = 'var(--color-tier4)';
        connectionIndicator.style.boxShadow       = '0 0 8px var(--color-tier4)';
        connectionStatusText.textContent           = 'DB Connection Error';
        if (loader) loader.innerHTML = `<span style="color:var(--color-tier4)">Failed: ${message || 'Unknown error'}</span>`;
    }
}

// =====================================================================
// Utilities
// =====================================================================
function escapeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&/g,  '&amp;')
        .replace(/</g,  '&lt;')
        .replace(/>/g,  '&gt;')
        .replace(/"/g,  '&quot;')
        .replace(/'/g,  '&#039;');
}

// Global hook for wizard initialization
window.appInitSweep = runIngestionSweep;