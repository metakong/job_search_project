// =====================================================================
// CORS Proxy Fetch Utility — fetch.js
// =====================================================================

async function fetchWithCORS(url, options = {}) {
    const TIMEOUT_MS = (window.CONFIG && window.CONFIG.FETCH_TIMEOUT_MS) || 12000;

    // Attempt order: a DIRECT request first (many JSON APIs — e.g. Remotive, The
    // Muse — send `Access-Control-Allow-Origin`, which is faster and far more
    // reliable than a public proxy), then fall back through several public proxies.
    const attempts = [
        url,
        `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
        `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
        `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
        `https://thingproxy.freeboard.io/fetch/${url}`
    ];

    for (let i = 0; i < attempts.length; i++) {
        const attempt = attempts[i];
        const label = i === 0 ? 'direct' : `proxy ${i}`;
        // Per-attempt timeout so one hung route can't stall an entire sweep.
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
        try {
            const response = await fetch(attempt, { ...options, signal: controller.signal });
            clearTimeout(timer);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response;
        } catch (err) {
            clearTimeout(timer);
            console.warn(`[CORS Fetch] ${label} failed for ${url} (${err.message}). Trying next…`);
        }
    }

    // Never throw — a blocked source must degrade gracefully, not crash the sweep.
    console.warn(`[CORS Fetch] All routes failed for ${url}; returning empty fallback.`);
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

