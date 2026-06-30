// =====================================================================
// Transformers Engine Client Wrapper — transformers-engine.js
// =====================================================================

const transformersEngine = {
    worker: null,
    pendingPromises: new Map(),
    requestId: 0,
    isInitialized: false,
    degraded: false,
    _resumeCache: { text: null, vector: null },

    isDegraded() {
        return this.degraded;
    },

    init() {
        if (this.degraded) return Promise.resolve(false);
        if (this.worker) return Promise.resolve(this.isInitialized);
        
        console.log('[Transformers Engine] Initializing worker thread...');
        this.worker = new Worker('js/workers/semantic-worker.js');
        
        this.worker.onmessage = (e) => {
            const { id, type, vector, error, status } = e.data;
            if (type === 'status') return;

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
        
        const id = this.requestId++;
        const workerPromise = new Promise((resolve, reject) => {
            this.pendingPromises.set(id, { resolve, reject });
            this.worker.postMessage({ id, type: 'init' });
        });
        
        const timeoutPromise = new Promise((resolve) => {
            setTimeout(() => {
                this.pendingPromises.delete(id);
                this.degraded = true;
                console.warn('[Transformers Engine] Init timed out after 30s. Gracefully degrading to keyword matching.');
                resolve(false);
            }, 30000);
        });
        
        return Promise.race([workerPromise, timeoutPromise]);
    },

    _send(type, data = {}) {
        if (this.degraded) return Promise.reject(new Error("Engine is degraded"));
        const id = this.requestId++;
        const workerPromise = new Promise((resolve, reject) => {
            this.pendingPromises.set(id, { resolve, reject });
            this.worker.postMessage({ id, type, data });
        });
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => {
                this.pendingPromises.delete(id);
                reject(new Error(`Worker ${type} timed out`));
            }, window.CONFIG?.WORKER_TIMEOUT_MS || 10000);
        });
        return Promise.race([workerPromise, timeoutPromise]);
    },

    async getEmbedding(text, isResume = false) {
        if (this.degraded) return null;
        if (isResume && this._resumeCache.text === text && this._resumeCache.vector) {
            return this._resumeCache.vector;
        }
        
        if (!this.worker || !this.isInitialized) {
            const ok = await this.init();
            if (!ok || this.degraded) return null;
        }
        
        try {
            const vector = await this._send('embed', { text });
            if (isResume && vector) {
                this._resumeCache.text = text;
                this._resumeCache.vector = vector;
            }
            return vector;
        } catch (e) {
            console.warn('[Transformers Engine] Embedding failed:', e);
            return null;
        }
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
