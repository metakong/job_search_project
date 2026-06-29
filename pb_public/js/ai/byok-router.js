// =====================================================================
// BYOK AI Router — byok-router.js
// =====================================================================

const byokRouter = {
    // Estimate tokens client-side: Math.ceil(string.length / 4)
    estimateTokens(text) {
        if (!text) return 0;
        return Math.ceil(text.length / 4);
    },

    async routeRequest(systemPrompt, userPrompt, isBackgroundTask = false) {
        // Fetch keys from user settings
        const settings = await window.dbAdapter.getUserProfile();
        
        const totalTokens = this.estimateTokens(systemPrompt + '\n' + userPrompt);
        console.log(`[BYOK Router] Total tokens estimated: ${totalTokens}. Background: ${isBackgroundTask}`);
        
        let provider = 'groq'; // default
        let modelName = 'llama-3.1-8b-instant';
        let baseUrl = 'https://api.groq.com/openai/v1';
        let apiKey = settings.apiKeyGroq;

        // Route logic per requirements
        if (totalTokens > 8000) {
            provider = 'gemini';
            modelName = 'gemini-1.5-flash';
            baseUrl = 'https://generativelanguage.googleapis.com/v1beta/openai/';
            apiKey = settings.apiKeyGemini;
        } else if (isBackgroundTask) {
            provider = 'cerebras';
            modelName = 'llama3.1-8b';
            baseUrl = 'https://api.cerebras.ai/v1';
            apiKey = settings.apiKeyCerebras;
        }

        // Key fallback check: if preferred provider has no key, check fallbacks
        if (!apiKey) {
            console.warn(`[BYOK Router] Preferred provider "${provider}" has no API key set. Trying fallbacks.`);
            if (settings.apiKeyGroq) {
                provider = 'groq';
                modelName = 'llama-3.1-8b-instant';
                baseUrl = 'https://api.groq.com/openai/v1';
                apiKey = settings.apiKeyGroq;
            } else if (settings.apiKeyGemini) {
                provider = 'gemini';
                modelName = 'gemini-1.5-flash';
                baseUrl = 'https://generativelanguage.googleapis.com/v1beta/openai/';
                apiKey = settings.apiKeyGemini;
            } else if (settings.apiKeyCerebras) {
                provider = 'cerebras';
                modelName = 'llama3.1-8b';
                baseUrl = 'https://api.cerebras.ai/v1';
                apiKey = settings.apiKeyCerebras;
            }
        }

        if (!apiKey) {
            throw new Error('BYOK Router failed: No API keys configured in user profile.');
        }

        console.log(`[BYOK Router] Routing request to: ${provider} (model: ${modelName})`);

        const requestBody = {
            model: modelName,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            temperature: 0.1
        };

        // Construct headers
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        };

        const targetUrl = `${baseUrl}/chat/completions`;

        // Make the API call via CORS Proxy if necessary
        // APIs are generally CORS-enabled, but some might block browser origins.
        // We will try direct fetch first, and fallback to CORS proxy if it fails.
        try {
            const resp = await fetch(targetUrl, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(requestBody)
            });

            if (!resp.ok) {
                const errText = await resp.text();
                throw new Error(`API error (${resp.status}): ${errText}`);
            }

            const data = await resp.json();
            return data.choices?.[0]?.message?.content || '';
        } catch (err) {
            console.warn(`[BYOK Router] Direct API call to ${provider} failed, retrying through CORS proxy:`, err);
            
            const proxy = await window.CONFIG.getCORSProxy();
            let proxyUrl;
            if (proxy.endsWith('?')) {
                proxyUrl = `${proxy}${targetUrl}`;
            } else {
                proxyUrl = `${proxy}${encodeURIComponent(targetUrl)}`;
            }

            const resp = await fetch(proxyUrl, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(requestBody)
            });

            if (!resp.ok) {
                const errText = await resp.text();
                throw new Error(`API via Proxy error (${resp.status}): ${errText}`);
            }

            const data = await resp.json();
            return data.choices?.[0]?.message?.content || '';
        }
    }
};

window.byokRouter = byokRouter; // Export globally
