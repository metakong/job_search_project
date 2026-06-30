// =====================================================================
// First-Run Setup Wizard Modal — setup-wizard.js
// =====================================================================

(function () {
    'use strict';

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
            const sen = currentProfile.baselineSeniority || 2;
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
                                    <label for="wizard-seniority">Your Current Level</label>
                                    <select id="wizard-seniority">
                                        <option value="1" ${sen === 1 ? 'selected' : ''}>Entry / Associate</option>
                                        <option value="2" ${sen === 2 ? 'selected' : ''}>Senior / Individual Contributor</option>
                                        <option value="3" ${sen === 3 ? 'selected' : ''}>Manager / Lead</option>
                                        <option value="4" ${sen === 4 ? 'selected' : ''}>Director / VP+</option>
                                    </select>
                                </div>
                            </div>
                            <label for="wizard-custom-roles" style="margin-top:0.5rem;">Target Roles / Search Terms <span style="color:var(--text-muted);font-weight:400;">(one per line or comma-separated — this drives your search)</span></label>
                            <textarea id="wizard-custom-roles" rows="3" placeholder="e.g.\nOperations Manager\nRevenue Operations\nProcess Improvement">${esc((currentProfile.search_queries || []).join('\n'))}</textarea>
                            <label style="margin-top:0.5rem;">Quick presets</label>
                            <div style="display:flex; gap:1rem; flex-wrap:wrap;">
                                <label><input type="checkbox" id="wizard-cat-sales"> Sales</label>
                                <label><input type="checkbox" id="wizard-cat-ops"> Operations</label>
                                <label><input type="checkbox" id="wizard-cat-tech"> Tech &amp; AI</label>
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
            if (cats.includes('sales')) document.getElementById('wizard-cat-sales').checked = true;
            if (cats.includes('operations')) document.getElementById('wizard-cat-ops').checked = true;
            if (cats.includes('tech')) document.getElementById('wizard-cat-tech').checked = true;

            // Résumé parsing.
            const fileInput = document.getElementById('wizard-resume-file');
            const statusDiv = document.getElementById('wizard-resume-status');
            const senSelect = document.getElementById('wizard-seniority');
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
                    senSelect.value = String(cal.baselineSeniority);   // auto-calibrate (user can override)
                    statusDiv.textContent = `✅ Parsed ${text.length} chars. Detected level: ${senSelect.options[senSelect.selectedIndex].text}.`;
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

                if (document.getElementById('wizard-cat-sales').checked) { categories.push('sales'); search_queries.push('Business Development', 'Revenue Operations', 'Sales Director', 'Account Executive'); }
                if (document.getElementById('wizard-cat-ops').checked) { categories.push('operations'); search_queries.push('Operations Manager', 'Process Improvement', 'Strategy', 'Chief of Staff'); }
                if (document.getElementById('wizard-cat-tech').checked) { categories.push('tech'); search_queries.push('AI Systems', 'Data Operations', 'Systems Architecture'); }
                search_queries = Array.from(new Set(search_queries));

                await window.dbAdapter.saveUserProfile({
                    location: document.getElementById('wizard-location').value,
                    radius: parseInt(document.getElementById('wizard-radius').value) || 30,
                    salaryFloor: parseInt(salaryInput.value) || 40000,
                    baselineSeniority: parseInt(senSelect.value) || 2,
                    categories,
                    search_queries,
                    resumeText: extractedResumeText,
                    corsProxyOverride: document.getElementById('wizard-proxy').value,
                    enableSemanticMatching: document.getElementById('wizard-semantic').checked,
                    isFirstRun: false
                });
                console.log('[Setup Wizard] Settings saved.');

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
