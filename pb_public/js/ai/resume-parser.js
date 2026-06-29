// =====================================================================
// Client-Side PDF.js Resume Parser — resume-parser.js
// =====================================================================

const resumeParser = {
    async parsePDF(file) {
        // PDF.js global library object pdfjsLib must be loaded in the page
        if (typeof pdfjsLib === 'undefined') {
            throw new Error('PDF.js library is not loaded. Please ensure it is present in index.html.');
        }

        // Configure worker CDN
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = async function() {
                try {
                    const typedarray = new Uint8Array(this.result);
                    const loadingTask = pdfjsLib.getDocument({ data: typedarray });
                    const pdf = await loadingTask.promise;
                    
                    console.log(`[Resume Parser] PDF Loaded. Total pages: ${pdf.numPages}`);
                    let fullText = '';
                    
                    for (let i = 1; i <= pdf.numPages; i++) {
                        const page = await pdf.getPage(i);
                        const textContent = await page.getTextContent();
                        const pageText = textContent.items.map(item => item.str).join(' ');
                        fullText += pageText + '\n';
                    }
                    
                    resolve(fullText.trim());
                } catch (err) {
                    console.error('[Resume Parser] Error during PDF parsing:', err);
                    reject(err);
                }
            };
            reader.onerror = (err) => {
                console.error('[Resume Parser] FileReader error:', err);
                reject(err);
            };
            reader.readAsArrayBuffer(file);
        });
    },

    async saveResumeText(text) {
        if (window.dbAdapter) {
            const profile = await window.dbAdapter.getUserProfile();
            profile.resumeText = text;

            // Axis Y Calibration Math
            let seniority = 1;
            const textLower = text.toLowerCase();
            if (/\bdirector\b|\bvp\b|vice president|\bfounder\b/i.test(textLower)) {
                seniority = 4;
            } else if (/\bmanager\b|\blead\b|\bsupervisor\b/i.test(textLower)) {
                seniority = 3;
            } else if (/\bsenior\b|\bsr\.\b|\bprincipal\b/i.test(textLower)) {
                seniority = 2;
            } else if (/\bcoordinator\b|\bspecialist\b|\brepresentative\b|\bassociate\b/i.test(textLower)) {
                seniority = 1;
            }
            profile.user_baseline_seniority = seniority;

            // Parse for salary anchors/numbers near currency markers
            let salaryFloor = profile.salaryFloor || 40000;
            const salaryRegex = /\$\s*([\d,]+)\s*(?:k|K)?\b/g;
            let match;
            let foundSalaries = [];
            while ((match = salaryRegex.exec(text)) !== null) {
                let val = parseFloat(match[1].replace(/,/g, ''));
                if (val < 1000 && match[0].toLowerCase().includes('k')) {
                    val *= 1000;
                } else if (val < 250) {
                    // Hourly rate likely, ignore or convert to annual
                    val *= 2080;
                }
                if (val >= 20000 && val <= 350000) {
                    foundSalaries.push(val);
                }
            }
            if (foundSalaries.length > 0) {
                // Set floor to the minimum of found salaries, or keep default
                salaryFloor = Math.min(...foundSalaries);
                profile.salaryFloor = salaryFloor;
            }

            await window.dbAdapter.saveUserProfile(profile);
            console.log(`[Resume Parser] Resume text successfully persisted in IndexedDB user_profile. Inferred seniority: ${seniority}, Inferred Salary Floor: ${salaryFloor}`);
            return true;
        }
        return false;
    }
};

window.resumeParser = resumeParser;
console.log('[Resume Parser] Module loaded.');
