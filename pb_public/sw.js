// =====================================================================
// Service Worker — sw.js
// =====================================================================
// Resilient offline support: the local app shell (HTML/CSS/JS modules) is
// pre-cached atomically; third-party CDN assets are cached best-effort so a
// single CDN hiccup can never break the install. Pinned CDN versions only
// (no @latest) for reproducible offline behavior.
// =====================================================================

const CACHE_NAME = 'job-search-v3';

// Same-origin app shell — must all cache for a reliable offline experience.
// Keep this list in sync with the <script> tags in index.html.
const CORE_ASSETS = [
    './', './index.html', './style.css', './app.js', './manifest.json', './icon.svg',
    './js/config.js', './js/utils/fetch.js',
    './js/storage/local-db.js', './js/storage/db-adapter.js', './js/storage/data-portability.js',
    './js/extractors/rss-adapter.js', './js/extractors/remotive-api.js',
    './js/extractors/themuse-api.js', './js/extractors/sitemap-parser.js',
    './js/ai/resume-parser.js', './js/ai/transformers-engine.js',
    './js/scoring/ambiguity-index.js', './js/scoring/transition-friction.js',
    './js/scoring/evaluator.js', './js/scoring/skill-matcher.js', './js/scoring/culture-evaluator.js',
    './js/scoring/industry-classifier.js', './js/scoring/scoring-coordinator.js',
    './js/features/setup-wizard.js'
];

// Third-party CDN assets — cached best-effort (failure is non-fatal).
const CDN_ASSETS = [
    'https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css',
    'https://cdn.jsdelivr.net/npm/dexie@4.0.8/dist/dexie.min.js',
    'https://cdn.jsdelivr.net/npm/fuse.js@7.0.0/dist/fuse.min.js',
    'https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js',
    'https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.min.js'
];

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);
        await cache.addAll(CORE_ASSETS); // atomic; core must succeed
        await Promise.allSettled(CDN_ASSETS.map(u => cache.add(u))); // best-effort
        self.skipWaiting();
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
        self.clients.claim();
    })());
});

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;
    const url = new URL(event.request.url);

    // Job-board / API traffic → network-first, fall back to cache when offline.
    if (url.origin !== self.location.origin || url.pathname.includes('/api/')) {
        event.respondWith(fetch(event.request).catch(() => caches.match(event.request).then(cached => cached || Response.error())));
        return;
    }

    // App shell → cache-first, lazily populate.
    event.respondWith(
        caches.match(event.request).then(cached => cached || fetch(event.request).then(resp => {
            if (resp && resp.status === 200) {
                const clone = resp.clone();
                caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
            }
            return resp;
        }).catch(() => Response.error()))
    );
});
