// =====================================================================
// CORS Proxy Fetch Utility — fetch.js
// =====================================================================

async function fetchWithCORS(url, options = {}) {
    const PROXY_LIST = [
        `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
        `https://corsproxy.io/?${encodeURIComponent(url)}`,
        `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`
    ];

    for (const proxyUrl of PROXY_LIST) {
        console.log(`[CORS Fetch] Routing target: ${url} through proxy: ${proxyUrl}`);
        try {
            const response = await fetch(proxyUrl, options);
            if (!response.ok) {
                throw new Error(`CORS Proxy fetch returned HTTP status ${response.status}`);
            }
            return response;
        } catch (err) {
            console.warn(`[CORS Fetch] Proxy failed: ${proxyUrl}. Trying next...`);
        }
    }
    
    console.warn(`[CORS Fetch] All CORS proxies failed for ${url}`);
    return new Response('[]', { status: 200, statusText: 'CORS Blocked Fallback' });
}

async function generateSHA256(company, title, location) {
    const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const raw = `${norm(company)}:${norm(title)}:${norm(location)}`;
    
    const msgUint8 = new TextEncoder().encode(raw);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

window.fetchWithCORS = fetchWithCORS;
window.generateSHA256 = generateSHA256;

