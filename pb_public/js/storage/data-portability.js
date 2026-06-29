// =====================================================================
// Data Portability (Export / Import) — data-portability.js
// =====================================================================

const dataPortability = {
    async exportData(schemaVersion = '1.0') {
        try {
            console.log('[Data Portability] Starting data export...');
            const exportPayload = {
                schemaVersion,
                exportedAt: new Date().toISOString(),
                tables: {}
            };
            
            const tables = [
                'job_listings', 'blacklisted_companies', 'filter_profiles', 
                'ats_watchlist', 'source_health', 'user_profile', 'embeddings'
            ];
            
            for (const tableName of tables) {
                exportPayload.tables[tableName] = await window.localDB[tableName].toArray();
            }
            
            const jsonString = JSON.stringify(exportPayload, null, 2);
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            
            const dateStr = new Date().toISOString().slice(0, 10);
            const a = document.createElement('a');
            a.href = url;
            a.download = `job_search_db_backup_${dateStr}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            // Save last export date to user profile to reset 30-day reminder
            if (window.dbAdapter) {
                const profile = await window.dbAdapter.getUserProfile();
                profile.lastExportDate = dateStr;
                await window.dbAdapter.saveUserProfile(profile);
                console.log(`[Data Portability] Last export timestamp updated to ${dateStr}`);
                
                // Hide banner if visible
                const banner = document.getElementById('export-reminder-banner');
                if (banner) banner.style.display = 'none';
            }
            
            alert('Export completed successfully.');
        } catch (err) {
            console.error('[Data Portability] Export failed:', err);
            alert(`Export failed: ${err.message}`);
        }
    },

    async importData(file) {
        try {
            console.log('[Data Portability] Starting database restore...');
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = async function() {
                    try {
                        const payload = JSON.parse(this.result);
                        if (!payload.schemaVersion || !payload.tables) {
                            throw new Error('Invalid file format. Missing schemaVersion or tables.');
                        }
                        
                        // Import tables sequentially
                        for (const [tableName, rows] of Object.entries(payload.tables)) {
                            if (window.localDB[tableName]) {
                                console.log(`[Data Portability] Restoring ${rows.length} rows to ${tableName}...`);
                                for (const row of rows) {
                                    await window.localDB[tableName].put(row);
                                }
                            }
                        }
                        
                        console.log('[Data Portability] Database restore completed.');
                        resolve(true);
                    } catch (err) {
                        reject(err);
                    }
                };
                reader.onerror = () => reject(reader.error);
                reader.readAsText(file);
            });
        } catch (err) {
            console.error('[Data Portability] Restore failed:', err);
            throw err;
        }
    },

    // ── Export Reminder Banner ───────────────────────────────────────
    async checkExportReminder() {
        if (!window.dbAdapter) return;
        
        const profile = await window.dbAdapter.getUserProfile();
        const lastExport = profile.lastExportDate;
        
        let showBanner = false;
        if (!lastExport) {
            showBanner = true; // Never exported before
        } else {
            const lastExportDate = new Date(lastExport);
            const diffTime = Math.abs(new Date() - lastExportDate);
            const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
            if (diffDays >= 30) {
                showBanner = true; // Export older than 30 days
            }
        }
        
        if (showBanner) {
            this.renderReminderBanner();
        }
    },

    renderReminderBanner() {
        // Prevent duplicate banners
        if (document.getElementById('export-reminder-banner')) return;
        
        const banner = document.createElement('div');
        banner.id = 'export-reminder-banner';
        banner.className = 'export-reminder-banner';
        banner.innerHTML = `
            <div class="banner-content">
                <span class="banner-icon">⚠️</span>
                <span class="banner-text">You haven't exported your job search database in over 30 days. Export now to backup your data.</span>
                <div class="banner-actions">
                    <button id="banner-export-btn" class="banner-btn-primary">Backup Now</button>
                    <button id="banner-dismiss-btn" class="banner-btn-secondary">Dismiss</button>
                </div>
            </div>
        `;
        
        // Append banner at the very top of body
        document.body.insertBefore(banner, document.body.firstChild);
        
        // Add event listeners
        document.getElementById('banner-export-btn').addEventListener('click', () => {
            this.exportData();
        });
        
        document.getElementById('banner-dismiss-btn').addEventListener('click', () => {
            banner.style.display = 'none';
        });
    }
};

window.dataPortability = dataPortability; // Export globally
