// =====================================================================
// First-Run Setup Wizard Modal — setup-wizard.js
// =====================================================================

(function () {
    'use strict';

    // Expanded, data-driven quick presets. `cat` maps to The Muse's category
    // vocabulary (see mapToMuseCategories in app.js); `q` seeds high-signal search
    // terms. Adding a preset here is all that's needed to broaden coverage.
    const PRESETS = [
        { id: 'sales',      cat: 'sales',      label: 'Sales',            q: ['Business Development', 'Account Executive', 'Sales Manager', 'Revenue Operations'] },
        { id: 'operations', cat: 'operations', label: 'Operations',       q: ['Operations Manager', 'Process Improvement', 'Program Manager', 'Chief of Staff'] },
        { id: 'tech',       cat: 'tech',       label: 'Tech & AI',        q: ['Software Engineer', 'Data Operations', 'Systems Architecture'] },
        { id: 'marketing',  cat: 'marketing',  label: 'Marketing',        q: ['Marketing Manager', 'Growth Marketing', 'Content Strategy', 'Brand Manager'] },
        { id: 'finance',    cat: 'finance',    label: 'Finance & Accounting', q: ['Financial Analyst', 'Accounting Manager', 'FP&A', 'Controller'] },
        { id: 'product',    cat: 'product',    label: 'Product',          q: ['Product Manager', 'Product Owner', 'Program Manager'] },
        { id: 'data',       cat: 'data',       label: 'Data & Analytics', q: ['Data Analyst', 'Data Scientist', 'Business Intelligence'] },
        { id: 'support',    cat: 'support',    label: 'Customer Success',  q: ['Customer Success Manager', 'Account Manager', 'Customer Support'] },
        { id: 'hr',         cat: 'hr',         label: 'HR & Recruiting',  q: ['Recruiter', 'Talent Acquisition', 'People Operations', 'HR Manager'] },
        { id: 'design',     cat: 'design',     label: 'Design & UX',      q: ['Product Designer', 'UX Designer', 'UI Designer'] },
    ];

    const setupWizard = {
        async init() {
            const profile = await window.dbAdapter.getUserProfile();
            if (profile.isFirstRun !== false) {
                console.log('[Setup Wizard] First run detected.');
                this.showWizardModal(profile);
            }
        },

        showWizardModal(currentProfile) {
            const old = document.getElementById('setup-wizard-dialog');
            if (old) old.remove();

            const dialog = document.createElement('dialog');
            dialog.id = 'setup-wizard-dialog';
            dialog.className = 'setup-wizard-dialog';
            dialog.innerHTML = `
                <article class="setup-wizard-card">
                    <header>
                        <h3>🎯 Set up your job search</h3>
                        <p class="subtitle">Everything stays on your device. You can change all of this later.</p>
                    </header>
                    <form id="setup-wizard-form" method="dialog">
                        <fieldset>
                            <legend><strong>1. Targeting</strong></legend>
                            <div class="grid">
                                <div>
                                    <label for="wizard-location">Target Location</label>
                                    <input type="text" id="wizard-location" value="${escAttr(currentProfile.location || 'Springfield, MO')}" required>
                                </div>
                                <div>
                                    <label for="wizard-radius">Search Radius (miles)</label>
                                    <input type="number" id="wizard-radius" value="${escAttr(currentProfile.radius || 30)}" required>
                                </div>
                            </div>
                            <div class="grid">
                                <div>
                                    <label for="wizard-salary">Minimum Salary ($)</label>
                                    <input type="number" id="wizard-salary" value="${escAttr(currentProfile.salaryFloor || 40000)}" required>
                                </div>
                                <div>
                                    <label for="wizard-peak-seniority">Peak Career Level <span style="display:block; font-weight:400; font-size:0.72rem; color:var(--text-muted);">The highest level you've ever held.</span></label>
                                    <select id="wizard-peak-seniority">
                                        <option value="1" ${currentProfile.peakSeniority === 1 ? 'selected' : ''}>Entry / Associate</option>
                                        <option value="2" ${(currentProfile.peakSeniority === 2 || !currentProfile.peakSeniority) ? 'selected' : ''}>Senior / Individual Contributor</option>
                                        <option value="3" ${currentProfile.peakSeniority === 3 ? 'selected' : ''}>Manager / Lead</option>
                                        <option value="4" ${currentProfile.peakSeniority === 4 ? 'selected' : ''}>Director / VP+</option>
                                    </select>
                                </div>
                                <div>
                                    <label for="wizard-recent-seniority">Realistic Current Level <span style="display:block; font-weight:400; font-size:0.72rem; color:var(--text-muted);">What you'd most likely be hired at today. Set below your peak if you've had a gap, pivot, or step-down — this anchors your zones.</span></label>
                                    <select id="wizard-recent-seniority">
                                        <option value="1" ${currentProfile.recentSeniority === 1 ? 'selected' : ''}>Entry / Associate</option>
                                        <option value="2" ${(currentProfile.recentSeniority === 2 || !currentProfile.recentSeniority) ? 'selected' : ''}>Senior / Individual Contributor</option>
                                        <option value="3" ${currentProfile.recentSeniority === 3 ? 'selected' : ''}>Manager / Lead</option>
                                        <option value="4" ${currentProfile.recentSeniority === 4 ? 'selected' : ''}>Director / VP+</option>
                                    </select>
                                </div>
                            </div>
                            <label for="wizard-custom-roles" style="margin-top:0.5rem;">Target Roles / Search Terms <span style="color:var(--text-muted);font-weight:400;">(one per line or comma-separated — this drives your search)</span></label>
                            <textarea id="wizard-custom-roles" rows="3" placeholder="e.g.\nOperations Manager\nRevenue Operations\nProcess Improvement">${esc((currentProfile.search_queries || []).join('\n'))}</textarea>
                            <label style="margin-top:0.5rem;">Quick presets <span style="color:var(--text-muted);font-weight:400;">(optional — check any that fit; they add search terms & tune your matching)</span></label>
                            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); gap:0.5rem 1rem;">
                                ${PRESETS.map(p => `<label><input type="checkbox" id="wizard-cat-${p.id}"> ${esc(p.label)}</label>`).join('')}
                            </div>
                        </fieldset>

                        <fieldset>
                            <legend><strong>2. Résumé (powers matching)</strong></legend>
                            <label for="wizard-resume-file">Upload Résumé (PDF — parsed locally, never uploaded)</label>
                            <input type="file" id="wizard-resume-file" accept="application/pdf">
                            <div id="wizard-resume-status" style="font-size:0.8rem; color:var(--text-muted); margin-top:-0.25rem; margin-bottom:0.5rem;">
                                ${currentProfile.resumeText ? '✅ Résumé loaded (' + currentProfile.resumeText.length + ' chars)' : 'No résumé loaded yet. Strongly recommended — it tailors every match to you.'}
                            </div>
                        </fieldset>

                        <details class="advanced-settings-details" style="margin-bottom: 1.25rem;">
                            <summary style="cursor:pointer; padding:0.75rem 1.25rem; background:#161b22; border:1px solid #30363d; border-radius:10px; color:#58a6ff; font-weight:700; font-size:0.9rem; list-style:none; display:flex; align-items:center; gap:0.5rem; user-select:none;">
                                <span style="transition:transform 0.2s; display:inline-block;">▶</span>
                                Advanced Settings (Optional)
                            </summary>
                            <fieldset style="margin-top:0.75rem;">
                                <legend><strong>3. Privacy &amp; Performance</strong></legend>
                                <label for="wizard-proxy">Custom CORS Proxy URL
                                    <span style="display:block; font-weight:400; font-size:0.75rem; color:var(--text-muted);">Cross-origin job-board fetches route through a CORS proxy. The default is a public service; for full privacy, deploy your own (see cors-proxy/README.md) and paste its URL here.</span>
                                </label>
                                <input type="url" id="wizard-proxy" value="${escAttr(currentProfile.corsProxyOverride || '')}" placeholder="https://your-worker.workers.dev/?url=">
                                <label style="margin-top:0.75rem; display:flex; align-items:center; gap:0.5rem;">
                                    <input type="checkbox" id="wizard-semantic" ${currentProfile.enableSemanticMatching ? 'checked' : ''}>
                                    Enable AI semantic matching <span style="font-weight:400; font-size:0.75rem; color:var(--text-muted);">(downloads a ~30 MB model on first sweep; improves résumé fit. Off = fast keyword matching.)</span>
                                </label>
                            </fieldset>
                        </details>

                        <footer>
                            <button type="submit" class="primary" id="wizard-save-btn">Complete Setup &amp; Run Ingestion</button>
                        </footer>
                    </form>
                </article>`;

            document.body.appendChild(dialog);
            document.body.classList.add('no-scroll');
            dialog.showModal();
            dialog.addEventListener('cancel', e => e.preventDefault()); // keep scroll lock until submit

            // Pre-check category boxes from existing profile.
            const cats = currentProfile.categories || [];
            for (const p of PRESETS) {
                const box = document.getElementById(`wizard-cat-${p.id}`);
                if (box && cats.includes(p.cat)) box.checked = true;
            }

            // Résumé parsing.
            const fileInput = document.getElementById('wizard-resume-file');
            const statusDiv = document.getElementById('wizard-resume-status');
            const peakSelect = document.getElementById('wizard-peak-seniority');
            const recentSelect = document.getElementById('wizard-recent-seniority');
            const salaryInput = document.getElementById('wizard-salary');
            let extractedResumeText = currentProfile.resumeText || '';

            fileInput.addEventListener('change', async e => {
                const file = e.target.files[0];
                if (!file) return;
                statusDiv.textContent = '⏳ Extracting text from PDF…';
                try {
                    const text = await window.resumeParser.parsePDF(file);
                    extractedResumeText = text;
                    const cal = window.resumeParser.calibrateFromText(text, parseInt(salaryInput.value) || 40000);
                    peakSelect.value = String(cal.peakSeniority);
                    recentSelect.value = String(cal.recentSeniority);
                    statusDiv.textContent = `✅ Parsed ${text.length} chars. Peak: ${peakSelect.options[peakSelect.selectedIndex].text} · Realistic current: ${recentSelect.options[recentSelect.selectedIndex].text}. Adjust either if needed — they set your zones.`;
                    statusDiv.style.color = 'var(--color-tier1)';
                } catch (err) {
                    statusDiv.textContent = `❌ Parsing failed: ${err.message}`;
                    statusDiv.style.color = 'var(--color-tier4)';
                    fileInput.value = '';
                }
            });

            // Submit.
            document.getElementById('setup-wizard-form').addEventListener('submit', async e => {
                e.preventDefault();

                const categories = [];
                let search_queries = [];
                const customRaw = document.getElementById('wizard-custom-roles').value.trim();
                if (customRaw) search_queries = customRaw.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);

                for (const p of PRESETS) {
                    const box = document.getElementById(`wizard-cat-${p.id}`);
                    if (box && box.checked) { categories.push(p.cat); search_queries.push(...p.q); }
                }
                search_queries = Array.from(new Set(search_queries));

                const enableSemanticMatching = document.getElementById('wizard-semantic').checked;

                // Keep baselineSeniority as fallback for old data in case anything still references it,
                // but we mainly write peakSeniority and recentSeniority
                const peak = parseInt(peakSelect.value) || 2;
                const recent = parseInt(recentSelect.value) || peak;

                // Competency shape from the résumé (gates Delta-X by domain).
                const domainAffinity = (extractedResumeText && window.competencyProfiler)
                    ? window.competencyProfiler.profileResume(extractedResumeText).affinity : null;
                // "Highest & best use" — years-per-skill signature.
                const yoeProfile = (extractedResumeText && window.yoeProfiler)
                    ? window.yoeProfiler.computeProfile(extractedResumeText) : null;

                await window.dbAdapter.saveUserProfile({
                    location: document.getElementById('wizard-location').value,
                    radius: parseInt(document.getElementById('wizard-radius').value) || 30,
                    salaryFloor: parseInt(salaryInput.value) || 40000,
                    baselineSeniority: peak, // backwards compatibility
                    peakSeniority: peak,
                    recentSeniority: recent,
                    domainAffinity,
                    yoeProfile,
                    calibrationVersion: 4, // these are user-confirmed → don't auto-migrate over them
                    categories,
                    search_queries,
                    resumeText: extractedResumeText,
                    corsProxyOverride: document.getElementById('wizard-proxy').value,
                    enableSemanticMatching: enableSemanticMatching,
                    isFirstRun: false
                });
                console.log('[Setup Wizard] Settings saved.');

                // Pre-warm the embedding model so the first sweep isn't blocked on a
                // cold download. `window.semanticWorker` never existed; the worker is
                // owned by transformersEngine — init() is the correct warm-up entry point.
                if (enableSemanticMatching && window.transformersEngine) {
                    window.transformersEngine.init().catch(() => { /* degrades to keyword matching */ });
                }

                document.body.classList.remove('no-scroll');
                dialog.close();
                dialog.remove();
                if (window.appInitSweep) await window.appInitSweep();
            });
        }
    };

    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
    function escAttr(s) { return esc(s).replace(/"/g, '&quot;'); }

    window.setupWizard = setupWizard;
})();
