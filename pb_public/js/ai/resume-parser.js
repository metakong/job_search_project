// =====================================================================
// Client-Side PDF.js Résumé Parser — resume-parser.js
// =====================================================================
// Extracts résumé text locally (never uploaded) and calibrates the candidate's
// baseline seniority (the Delta-Y anchor) and salary floor from it.
// =====================================================================

(function () {
    'use strict';

    const resumeParser = {
        async parsePDF(file) {
            if (typeof pdfjsLib === 'undefined') {
                throw new Error('PDF.js library is not loaded. Please ensure it is present in index.html.');
            }
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = async function () {
                    try {
                        const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(this.result) }).promise;
                        let fullText = '';
                        for (let i = 1; i <= pdf.numPages; i++) {
                            const page = await pdf.getPage(i);
                            const tc = await page.getTextContent();
                            fullText += tc.items.map(it => it.str).join(' ') + '\n';
                        }
                        resolve(fullText.trim());
                    } catch (err) { console.error('[Resume Parser] Parse error:', err); reject(err); }
                };
                reader.onerror = err => { console.error('[Resume Parser] FileReader error:', err); reject(err); };
                reader.readAsArrayBuffer(file);
            });
        },

        // Derive baseline seniority (1–4) and a salary-floor anchor from résumé text.
        calibrateFromText(text, currentFloor = 40000) {
            const t = (text || '').toLowerCase();
            let baselineSeniority = 2;
            if (/\bdirector\b|\bvp\b|vice president|\bfounder\b|\bchief\b|\bhead of\b/i.test(t)) baselineSeniority = 4;
            else if (/\bmanager\b|\blead\b|\bsupervisor\b|\bprincipal\b/i.test(t)) baselineSeniority = 3;
            else if (/\bsenior\b|\bsr\.?\b|\bstaff\b/i.test(t)) baselineSeniority = 2;
            else if (/\bcoordinator\b|\bspecialist\b|\brepresentative\b|\bassociate\b|\bjunior\b|\bintern\b/i.test(t)) baselineSeniority = 1;

            let salaryFloor = currentFloor || 40000;
            const re = /\$\s*([\d,]+)\s*(?:k|K)?\b/g;
            const found = [];
            let m;
            while ((m = re.exec(text || '')) !== null) {
                let val = parseFloat(m[1].replace(/,/g, ''));
                if (val < 1000 && m[0].toLowerCase().includes('k')) val *= 1000;
                else if (val < 250) val *= 2080; // hourly → annual
                if (val >= 20000 && val <= 400000) found.push(val);
            }
            if (found.length) salaryFloor = Math.min(...found);

            return { baselineSeniority, salaryFloor };
        },

        // Persist résumé text + calibration in one shot (kept for any direct caller).
        async saveResumeText(text) {
            if (!window.dbAdapter) return false;
            const profile = await window.dbAdapter.getUserProfile();
            const cal = this.calibrateFromText(text, profile.salaryFloor);
            await window.dbAdapter.saveUserProfile({
                resumeText: text,
                baselineSeniority: cal.baselineSeniority,
                salaryFloor: cal.salaryFloor
            });
            console.log(`[Resume Parser] Saved. Seniority=${cal.baselineSeniority}, Floor=${cal.salaryFloor}`);
            return true;
        }
    };

    window.resumeParser = resumeParser;
    console.log('[Resume Parser] Module loaded.');
})();
