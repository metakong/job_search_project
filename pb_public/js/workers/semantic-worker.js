// =====================================================================
// Semantic Web Worker for Transformers.js — semantic-worker.js
// =====================================================================

// Load Transformers.js CDN
importScripts('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.1');

let pipelineInstance = null;

// Configure environments
self.transformers.env.allowLocalModels = false;

async function getPipeline() {
    if (pipelineInstance) return pipelineInstance;
    
    // Strict fallback chain: WebGPU -> WASM+SIMD -> WASM plain
    // Transformers.js manages SIMD vs plain WASM internally using ONNX Runtime Web.
    // We can hint the execution provider if supported.
    const options = {
        quantized: true, // Loads q4 model
    };

    try {
        console.log('[Worker] Loading Xenova/all-MiniLM-L6-v2 model...');
        pipelineInstance = await self.transformers.pipeline(
            'feature-extraction', 
            'Xenova/all-MiniLM-L6-v2', 
            options
        );
        console.log('[Worker] Model successfully loaded.');
        return pipelineInstance;
    } catch (err) {
        console.error('[Worker] Failed to load model:', err);
        throw err;
    }
}

self.onmessage = async function(e) {
    const { type, data, id } = e.data;
    
    if (type === 'init') {
        try {
            await getPipeline();
            self.postMessage({ id, type: 'init_ok' });
        } catch (err) {
            self.postMessage({ id, type: 'error', error: err.message });
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
};
