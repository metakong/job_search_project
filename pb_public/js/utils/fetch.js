// =====================================================================
// CORS Proxy Fetch Utility — fetch.js
// =====================================================================

async function fetchWithCORS(url, options = {}) {
    const proxy = await window.CONFIG.getCORSProxy();
    let proxyUrl;
    
    if (proxy.endsWith('?')) {
        // Standard public proxy like https://corsproxy.io/?
        proxyUrl = `${proxy}${url}`;
    } else if (proxy.includes('?url=') || proxy.endsWith('url=')) {
        // e.g., custom worker https://myworker.dev/?url=
        proxyUrl = proxy.endsWith('url=') ? `${proxy}${encodeURIComponent(url)}` : `${proxy}&url=${encodeURIComponent(url)}`;
    } else {
        // Generic fallback: check if proxy contains a query sign, and append appropriately
        proxyUrl = proxy.includes('?') ? `${proxy}&url=${encodeURIComponent(url)}` : `${proxy}${url}`;
    }
    
    console.log(`[CORS Fetch] Routing target: ${url} through proxy: ${proxyUrl}`);
    
    try {
        const response = await fetch(proxyUrl, options);
        if (!response.ok) {
            throw new Error(`CORS Proxy fetch returned HTTP status ${response.status}`);
        }
        return response;
    } catch (err) {
        console.warn(`[CORS Fetch] Proxy failed. Attempting direct fetch for ${url}:`, err);
        // Direct fetch fallback in case proxy is broken or blocked
        return fetch(url, options);
    }
}

async function generateSHA256(company, title, location) {
    const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const locNorm = location.toLowerCase().includes('springfield') ? 'springfieldmo' : norm(location);
    const raw = `${norm(company)}:${norm(title)}:${locNorm}`;
    
    const msgUint8 = new TextEncoder().encode(raw);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

window.fetchWithCORS = fetchWithCORS;
window.generateSHA256 = generateSHA256;

