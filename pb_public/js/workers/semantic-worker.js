// =====================================================================
// Semantic Web Worker for Transformers.js — semantic-worker.js
// =====================================================================

// Load Transformers.js CDN
importScripts('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.1');

let pipelineInstance = null;
let isLoading = false;
let isReady = false;
const messageQueue = [];

// Configure environments
self.transformers.env.allowLocalModels = false;

async function getPipeline() {
    if (pipelineInstance) return pipelineInstance;
    
    const options = {
        quantized: true, // Loads q4 model
    };

    console.log('[Worker] Loading Xenova/all-MiniLM-L6-v2 model...');
    pipelineInstance = await self.transformers.pipeline(
        'feature-extraction', 
        'Xenova/all-MiniLM-L6-v2', 
        options
    );
    console.log('[Worker] Model successfully loaded.');
    return pipelineInstance;
}

self.onmessage = async function(e) {
    const msg = e.data;
    
    if (!isReady && msg.type !== 'init') {
        messageQueue.push(msg);
        return;
    }

    await handleMessage(msg);
};

async function handleMessage(msg) {
    const { type, data, id } = msg;
    
    if (type === 'init') {
        if (isLoading) return;
        isLoading = true;
        try {
            await getPipeline();
            isReady = true;
            self.postMessage({ id, type: 'init_ok' });
            self.postMessage({ type: 'status', status: 'ready' });
            
            // Drain queue
            while (messageQueue.length > 0) {
                const queuedMsg = messageQueue.shift();
                await handleMessage(queuedMsg);
            }
        } catch (err) {
            self.postMessage({ id, type: 'error', error: err.message });
            self.postMessage({ type: 'status', status: 'error', error: err.message });
        } finally {
            isLoading = false;
        }
    } 
    else if (type === 'embed') {
        try {
            const pipe = await getPipeline();
            const text = data.text;
            
            // Calculate embedding vector
            const output = await pipe(text, { pooling: 'mean', normalize: true });
            const vector = Array.from(output.data);
            
            self.postMessage({ id, type: 'embed_ok', vector });
        } catch (err) {
            self.postMessage({ id, type: 'error', error: err.message });
        }
    }
}
