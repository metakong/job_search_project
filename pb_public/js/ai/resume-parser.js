// =====================================================================
// Client-Side PDF.js Résumé Parser — resume-parser.js
// =====================================================================
// Extracts résumé text locally (never uploaded) and calibrates the candidate's
// baseline seniority (the Delta-Y anchor) and salary floor from it.
// =====================================================================

(function () {
    'use strict';

    const SOFT_SKILLS_LEXICON = [
        "leadership", "communication", "adaptability", "problem solving", "critical thinking",
        "teamwork", "collaboration", "time management", "organization", "emotional intelligence",
        "creativity", "conflict resolution", "negotiation", "empathy", "mentoring", "coaching",
        "agile", "scrum", "kanban", "lean six sigma", "okr"
    ];

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

        _detectSeniority(text) {
            const t = (text || '').toLowerCase();
            let sen = 2;
            if (/\bdirector\b|\bvp\b|vice president|\bfounder\b|\bchief\b|\bhead of\b/i.test(t)) sen = 4;
            else if (/\bmanager\b|\blead\b|\bsupervisor\b|\bprincipal\b/i.test(t)) sen = 3;
            else if (/\bsenior\b|\bsr\.?\b|\bstaff\b/i.test(t)) sen = 2;
            else if (/\bcoordinator\b|\bspecialist\b|\brepresentative\b|\bassociate\b|\bjunior\b|\bintern\b/i.test(t)) sen = 1;
            return sen;
        },

        // Derive baseline seniority (1–4) and a salary-floor anchor from résumé text.
        calibrateFromText(text, currentFloor = 40000) {
            const t = (text || '').toLowerCase();
            
            const peakSeniority = this._detectSeniority(t);
            let recentSeniority = peakSeniority;
            
            const yearRe = /\b(202[1-9])\b/g;
            let lastYearIndex = -1;
            let m;
            while ((m = yearRe.exec(t)) !== null) {
                lastYearIndex = m.index;
            }
            if (lastYearIndex !== -1) {
                const recentText = t.substring(lastYearIndex, lastYearIndex + 500);
                recentSeniority = this._detectSeniority(recentText);
            }

            let salaryFloor = currentFloor || 40000;
            const re = /\$\s*([\d,]+)\s*(?:k|K)?\b/g;
            const found = [];
            while ((m = re.exec(text || '')) !== null) {
                let val = parseFloat(m[1].replace(/,/g, ''));
                if (val < 1000 && m[0].toLowerCase().includes('k')) val *= 1000;
                else if (val < 250) val *= 2080; // hourly → annual
                if (val >= 20000 && val <= 400000) found.push(val);
            }
            if (found.length) salaryFloor = Math.min(...found);
            
            const softSkills = [];
            for (const skill of SOFT_SKILLS_LEXICON) {
                if (t.includes(skill)) softSkills.push(skill);
            }

            return { peakSeniority, recentSeniority, salaryFloor, softSkills };
        },

        // Persist résumé text + calibration in one shot (kept for any direct caller).
        async saveResumeText(text) {
            if (!window.dbAdapter) return false;
            const profile = await window.dbAdapter.getUserProfile();
            const cal = this.calibrateFromText(text, profile.salaryFloor);
            await window.dbAdapter.saveUserProfile({
                resumeText: text,
                baselineSeniority: cal.peakSeniority,
                peakSeniority: cal.peakSeniority,
                recentSeniority: cal.recentSeniority,
                salaryFloor: cal.salaryFloor,
                softSkills: cal.softSkills
            });
            console.log(`[Resume Parser] Saved. Peak=${cal.peakSeniority}, Recent=${cal.recentSeniority}, Floor=${cal.salaryFloor}`);
            return true;
        }
    };

    window.resumeParser = resumeParser;
    console.log('[Resume Parser] Module loaded.');
})();
