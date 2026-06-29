// =====================================================================
// First-Run Setup Wizard Modal — setup-wizard.js
// =====================================================================

const setupWizard = {
    async init() {
        const profile = await window.dbAdapter.getUserProfile();
        // Check if it's the first run. If isFirstRun is not explicitly false, show wizard.
        if (profile.isFirstRun !== false) {
            console.log('[Setup Wizard] First run detected. Prompting wizard modal.');
            this.showWizardModal(profile);
        }
    },

    showWizardModal(currentProfile) {
        // Remove existing setup wizard modal if present
        const oldModal = document.getElementById('setup-wizard-dialog');
        if (oldModal) oldModal.remove();

        const dialog = document.createElement('dialog');
        dialog.id = 'setup-wizard-dialog';
        dialog.className = 'setup-wizard-dialog';
        dialog.innerHTML = `
            <article class="setup-wizard-card">
                <header>
                    <h3>🎯 Zero-Friction target acquisition setup</h3>
                    <p class="subtitle">Configure your job search parameters & API keys</p>
                </header>
                
                <form id="setup-wizard-form" method="dialog">
                    <!-- Step 1: Search Parameters -->
                    <fieldset>
                        <legend><strong>1. Targeting Parameters</strong></legend>
                        <div class="grid">
                            <div>
                                <label for="wizard-location">Target Location</label>
                                <input type="text" id="wizard-location" value="${currentProfile.location || 'Springfield, MO'}" required>
                            </div>
                            <div>
                                <label for="wizard-radius">Search Radius (miles)</label>
                                <input type="number" id="wizard-radius" value="${currentProfile.radius || 30}" required>
                            </div>
                        </div>
                        <div class="grid">
                            <div>
                                <label for="wizard-salary">Minimum Salary ($)</label>
                                <input type="number" id="wizard-salary" value="${currentProfile.salaryFloor || 40000}" required>
                            </div>
                            <div style="display:flex; flex-direction:column; justify-content:center;">
                                <label>Target Role Categories</label>
                                <div style="display:flex; gap:1rem; flex-wrap:wrap; margin-top:0.25rem;">
                                    <label>
                                        <input type="checkbox" id="wizard-cat-sales" ${currentProfile.categories?.includes('sales') !== false ? 'checked' : ''}>
                                        Sales
                                    </label>
                                    <label>
                                        <input type="checkbox" id="wizard-cat-ops" ${currentProfile.categories?.includes('operations') !== false ? 'checked' : ''}>
                                        Operations
                                    </label>
                                    <label>
                                        <input type="checkbox" id="wizard-cat-tech" ${currentProfile.categories?.includes('tech') !== false ? 'checked' : ''}>
                                        Tech & AI
                                    </label>
                                </div>
                            </div>
                        </div>
                    </fieldset>

                    <!-- Step 2: Resume PDF Upload -->
                    <fieldset>
                        <legend><strong>2. Candidate Resume Profile (ATS Scoring)</strong></legend>
                        <label for="wizard-resume-file">Upload Resume (PDF format for local ATS scanning)</label>
                        <input type="file" id="wizard-resume-file" accept="application/pdf">
                        <div id="wizard-resume-status" style="font-size:0.8rem; color:var(--text-muted); margin-top:-0.5rem; margin-bottom:1rem;">
                            ${currentProfile.resumeText ? '✅ Resume text loaded (' + currentProfile.resumeText.length + ' chars)' : 'No resume loaded yet.'}
                        </div>
                    </fieldset>

                    <!-- Step 3: BYOK API Keys & Proxy (collapsed for non-technical users) -->
                    <details class="advanced-settings-details" style="margin-bottom: 1.25rem;">
                        <summary style="cursor:pointer; padding:0.75rem 1.25rem; background:#161b22; border:1px solid #30363d; border-radius:10px; color:#58a6ff; font-weight:700; font-size:0.9rem; list-style:none; display:flex; align-items:center; gap:0.5rem; user-select:none;">
                            <span style="transition:transform 0.2s; display:inline-block;">▶</span>
                            Advanced Settings (Optional: API Keys &amp; Proxies)
                        </summary>
                        <fieldset style="margin-top:0.75rem;">
                            <legend><strong>3. BYOK LLM Keys &amp; CORS Proxy</strong></legend>
                            <p style="font-size:0.78rem; color:#8b949e; margin-top:-0.5rem; margin-bottom:1rem;">These are optional. The app works without any API keys. Only configure if you want AI-powered deep analysis.</p>
                            <div class="grid">
                                <div>
                                    <label for="wizard-key-groq">Groq API Key</label>
                                    <input type="password" id="wizard-key-groq" value="${currentProfile.apiKeyGroq || ''}" placeholder="gsk_...">
                                </div>
                                <div>
                                    <label for="wizard-key-gemini">Gemini (AI Studio) API Key</label>
                                    <input type="password" id="wizard-key-gemini" value="${currentProfile.apiKeyGemini || ''}" placeholder="AIzaSy...">
                                </div>
                            </div>
                            <div class="grid">
                                <div>
                                    <label for="wizard-key-cerebras">Cerebras API Key</label>
                                    <input type="password" id="wizard-key-cerebras" value="${currentProfile.apiKeyCerebras || ''}" placeholder="csk_...">
                                </div>
                                <div>
                                    <label for="wizard-proxy">Custom CORS Proxy URL</label>
                                    <input type="url" id="wizard-proxy" value="${currentProfile.corsProxyOverride || ''}" placeholder="https://corsproxy.io/?">
                                </div>
                            </div>
                        </fieldset>
                    </details>

                    <footer>
                        <button type="submit" class="primary" id="wizard-save-btn">Complete Setup & Run Ingestion</button>
                    </footer>
                </form>
            </article>
        `;

        document.body.appendChild(dialog);
        document.body.classList.add('no-scroll');
        dialog.showModal();

        // Prevent ESC cancellation to preserve scroll lock and wizard completion
        dialog.addEventListener('cancel', (e) => {
            e.preventDefault();
        });

        // Handle PDF text extraction asynchronously when file selected
        const fileInput = document.getElementById('wizard-resume-file');
        const statusDiv = document.getElementById('wizard-resume-status');
        let extractedResumeText = currentProfile.resumeText || '';

        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            statusDiv.textContent = '⏳ Extracting text from PDF...';
            try {
                const text = await window.resumeParser.parsePDF(file);
                extractedResumeText = text;
                statusDiv.textContent = `✅ Successfully parsed ${text.length} characters of resume text!`;
                statusDiv.style.color = 'var(--color-tier1)';
            } catch (err) {
                statusDiv.textContent = `❌ Parsing failed: ${err.message}`;
                statusDiv.style.color = 'var(--color-tier4)';
                fileInput.value = ''; // Reset input
            }
        });

        // Handle submission
        const form = document.getElementById('setup-wizard-form');
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const categories = [];
            const search_queries = [];
            if (document.getElementById('wizard-cat-sales').checked) {
                categories.push('sales');
                search_queries.push('"Business Development" OR "Revenue Operations" OR "Sales Director" OR "Consultative Sales"');
            }
            if (document.getElementById('wizard-cat-ops').checked) {
                categories.push('operations');
                search_queries.push('"Operations Manager" OR "Process Improvement" OR "Turnaround" OR "Strategy"');
            }
            if (document.getElementById('wizard-cat-tech').checked) {
                categories.push('tech');
                search_queries.push('"AI Evaluator" OR "Systems Architecture" OR "Data Operations"');
            }

            const profileUpdates = {
                location: document.getElementById('wizard-location').value,
                radius: parseInt(document.getElementById('wizard-radius').value) || 30,
                salaryFloor: parseInt(document.getElementById('wizard-salary').value) || 40000,
                categories: categories,
                search_queries: search_queries,
                resumeText: extractedResumeText,
                apiKeyGroq: document.getElementById('wizard-key-groq').value,
                apiKeyGemini: document.getElementById('wizard-key-gemini').value,
                apiKeyCerebras: document.getElementById('wizard-key-cerebras').value,
                corsProxyOverride: document.getElementById('wizard-proxy').value,
                isFirstRun: false // Completed
            };

            await window.dbAdapter.saveUserProfile(profileUpdates);
            console.log('[Setup Wizard] Settings successfully saved.');
            
            document.body.classList.remove('no-scroll');
            dialog.close();
            dialog.remove();
            
            // Reload filters and run sweep
            if (window.appInitSweep) {
                await window.appInitSweep();
            }
        });
    }
};

window.setupWizard = setupWizard; // Export globally
