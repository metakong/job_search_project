// =====================================================================
// Transformers Engine Client Wrapper — transformers-engine.js
// =====================================================================

const transformersEngine = {
    worker: null,
    pendingPromises: new Map(),
    requestId: 0,
    isInitialized: false,

    init() {
        if (this.worker) return Promise.resolve(this.isInitialized);
        
        console.log('[Transformers Engine] Initializing worker thread...');
        this.worker = new Worker('js/workers/semantic-worker.js');
        
        this.worker.onmessage = (e) => {
            const { id, type, vector, error } = e.data;
            const promise = this.pendingPromises.get(id);
            if (!promise) return;

            if (type === 'init_ok') {
                this.isInitialized = true;
                promise.resolve(true);
            } else if (type === 'embed_ok') {
                promise.resolve(vector);
            } else if (type === 'error') {
                promise.reject(new Error(error));
            }
            this.pendingPromises.delete(id);
        };
        
        return this._send('init');
    },

    _send(type, data = {}) {
        const id = this.requestId++;
        return new Promise((resolve, reject) => {
            this.pendingPromises.set(id, { resolve, reject });
            this.worker.postMessage({ id, type, data });
        });
    },

    async getEmbedding(text) {
        if (!this.worker) {
            await this.init();
        }
        return this._send('embed', { text });
    },

    calculateSimilarity(vecA, vecB) {
        if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < vecA.length; i++) {
            dotProduct += vecA[i] * vecB[i];
            normA += vecA[i] * vecA[i];
            normB += vecB[i] * vecB[i];
        }
        if (normA === 0 || normB === 0) return 0;
        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }
};

window.transformersEngine = transformersEngine;
console.log('[Transformers Engine] Client module loaded.');
