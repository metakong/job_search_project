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
            await window.dbAdapter.saveUserProfile(profile);
            console.log('[Resume Parser] Resume text successfully persisted in IndexedDB user_profile.');
            return true;
        }
        return false;
    }
};

window.resumeParser = resumeParser;
console.log('[Resume Parser] Module loaded.');
