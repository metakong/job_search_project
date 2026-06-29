// =====================================================================
// Permissive CORS Proxy for Cloudflare Workers — worker.js
// =====================================================================

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  const url = new URL(request.url);
  
  // Extract target URL from query parameter 'url'
  // e.g. https://my-proxy.workers.dev/?url=https://example.com/api
  let targetUrl = url.searchParams.get('url');
  
  // Fallback: check if the target URL is appended directly
  // e.g. https://my-proxy.workers.dev/https://example.com/api
  if (!targetUrl) {
    const pathAndQuery = url.pathname.substring(1) + url.search;
    if (pathAndQuery.startsWith('http://') || pathAndQuery.startsWith('https://')) {
      targetUrl = pathAndQuery;
    }
  }

  if (!targetUrl) {
    return new Response(
      JSON.stringify({ 
        error: 'Missing target URL. Usage: /?url=https://example.com/api or /https://example.com/api' 
      }), 
      {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      }
    );
  }

  // Handle preflight OPTIONS requests
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': request.headers.get('Access-Control-Request-Headers') || '*',
        'Access-Control-Max-Age': '86400',
      }
    });
  }

  try {
    // Clone headers and rewrite origin/host headers if necessary
    const newHeaders = new Headers(request.headers);
    newHeaders.set('Host', new URL(targetUrl).host);
    newHeaders.delete('Origin');
    newHeaders.delete('Referer');

    // Make the upstream request
    const response = await fetch(targetUrl, {
      method: request.method,
      headers: newHeaders,
      body: request.body,
      redirect: 'follow'
    });

    // Create a new response to modify headers
    const corsResponse = new Response(response.body, response);
    
    // Inject CORS headers
    corsResponse.headers.set('Access-Control-Allow-Origin', '*');
    corsResponse.headers.set('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, DELETE, OPTIONS');
    corsResponse.headers.set('Access-Control-Allow-Headers', '*');
    corsResponse.headers.set('Access-Control-Expose-Headers', '*');
    
    return corsResponse;
  } catch (err) {
    return new Response(
      JSON.stringify({ error: `Proxy failed to fetch target: ${err.message}` }), 
      {
        status: 502,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      }
    );
  }
}
