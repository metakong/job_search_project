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

        // Back-compat wrapper (defaults to 2 when no signal). Used for the peak
        // scan and by any older caller. Prefer _detectLevelStrict internally.
        _detectSeniority(text) {
            return this._detectLevelStrict(text) ?? 2;
        },

        // Strict level detector: returns 1–4 or null when the text carries no
        // recognizable level keyword (so the recent-role scan can skip ambiguous
        // windows instead of silently defaulting them to "senior").
        _detectLevelStrict(text) {
            const t = (text || '').toLowerCase();
            if (/\bdirector\b|\bvp\b|vice president|\bfounder\b|\bchief\b|\bhead of\b|\bpresident\b|c[etof]o\b/i.test(t)) return 4;
            if (/\bmanager\b|\bmgr\b|\blead\b|\bsupervisor\b|\bprincipal\b|general manager/i.test(t)) return 3;
            if (/\bsenior\b|\bsr\.?\b|\bstaff\b/i.test(t)) return 2;
            if (/\bsales consultant\b|\bsales associate\b|\bsales rep(?:resentative)?\b|\bassociate\b|\bcoordinator\b|\brepresentative\b|\bjunior\b|\bjr\.?\b|\bintern\b|\bassistant\b|\bclerk\b|\btrainee\b|\bapprentice\b|\bcashier\b|\bbarista\b|\bserver\b|\bteller\b|\bretail\b/i.test(t)) return 1;
            return null;
        },

        // Realistic RECENT level = the level of the most-recent role a recruiter
        // would actually credit. Self-employment / founder / 1099-contract titles
        // are notoriously inflated ("Founder & Principal Consultant" of a solo LLC
        // is not a Director in hiring-manager eyes), so we skip them and read the
        // most-recent W-2-style role instead. This is the depressed baseline the
        // dual-baseline (peak↔recent) anchor needs to route zones honestly.
        _detectRecent(text, peak) {
            const raw = String(text || '');
            const SELF_EMP = /self.?employed|\bfounder\b|principal consultant|\b1099\b|freelance|sole proprietor|\bllc\b|\bcontract\b|co.?founder/i;
            // Match a start year followed by a range dash and either Present/Current
            // or an end year — the end year may be preceded by a month name
            // ("Feb 2024 – Jan 2025"), which the simpler pattern missed.
            const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?\\s+';
            const dateRe = new RegExp(`(?:19|20)\\d{2}\\s*(?:–|-|—|to|through|until)\\s*(?:present|current|(?:${MONTH})?(?:19|20)\\d{2})`, 'ig');
            // For each role (top-down = most recent first) the title+company sit
            // immediately BEFORE the date; bullets sit AFTER it. Bounding each
            // window by the PREVIOUS date anchor guarantees we read only THIS role's
            // title, never bleeding into a prior role's "Founder/1099" markers.
            let m, prevEnd = 0;
            while ((m = dateRe.exec(raw)) !== null) {
                const seg = raw.substring(prevEnd, m.index);
                const titleWin = seg.slice(-90); // tail nearest the date = this role's title
                prevEnd = m.index + m[0].length;
                if (SELF_EMP.test(titleWin)) continue; // skip inflated self-employment titles
                const lvl = this._detectLevelStrict(titleWin);
                if (lvl) return lvl;
            }
            return peak; // no clear recent signal → assume no deficit (wizard is authority)
        },

        // Derive dual-baseline seniority (peak + realistic recent, each 1–4) and a
        // salary-floor anchor from résumé text.
        calibrateFromText(text, currentFloor = 40000) {
            const t = (text || '').toLowerCase();

            const peakSeniority = this._detectLevelStrict(t) ?? 2;
            const recentSeniority = this._detectRecent(text, peakSeniority);
            let m;

            // Salary floor: ONLY trust $-amounts that appear in an explicit pay
            // context. Résumés are full of dollar figures (budgets managed, revenue
            // driven, deal sizes) that must never be misread as the candidate's
            // salary — the old code took min() over *all* of them.
            let salaryFloor = currentFloor || 40000;
            const SALARY_CTX = /(salary|compensation|\bpay\b|\bwage\b|\bbase\b|per\s+year|\/\s*yr|annual|per\s+hour|\/\s*hr|hourly)/i;
            const moneyRe = /\$\s*([\d,]+(?:\.\d+)?)\s*(k|K)?/g;
            const found = [];
            while ((m = moneyRe.exec(text || '')) !== null) {
                const ctx = (text || '').substring(Math.max(0, m.index - 40), m.index + m[0].length + 40);
                if (!SALARY_CTX.test(ctx)) continue;       // skip non-pay figures
                let val = parseFloat(m[1].replace(/,/g, ''));
                if (m[2]) val *= 1000;                     // explicit "k"
                else if (val > 0 && val < 250) val *= 2080; // hourly → annual
                if (val >= 15000 && val <= 600000) found.push(val);
            }
            if (found.length) salaryFloor = Math.min(...found);
            
            const softSkills = [];
            for (const skill of SOFT_SKILLS_LEXICON) {
                if (t.includes(skill)) softSkills.push(skill);
            }

            // Competency SHAPE: which skill domains the candidate genuinely belongs
            // to (sales/ops/etc.), used to gate Delta-X so out-of-domain roles (e.g.
            // software engineering for a sales/ops candidate) can't false-match.
            let domainAffinity = null;
            if (window.competencyProfiler) {
                domainAffinity = window.competencyProfiler.profileResume(text || '').affinity;
            }

            return { peakSeniority, recentSeniority, salaryFloor, softSkills, domainAffinity };
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
                softSkills: cal.softSkills,
                domainAffinity: cal.domainAffinity
            });
            console.log(`[Resume Parser] Saved. Peak=${cal.peakSeniority}, Recent=${cal.recentSeniority}, Floor=${cal.salaryFloor}`);
            return true;
        }
    };

    window.resumeParser = resumeParser;
    console.log('[Resume Parser] Module loaded.');
})();
