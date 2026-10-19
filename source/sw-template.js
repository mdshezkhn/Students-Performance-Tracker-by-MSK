/* SPR service worker — versioned app-shell cache (offline support).
   CACHE is injected at build time from a hash of the built app HTML, so ANY
   app change automatically produces a new cache version and a detectable
   sw.js update. Student data never enters this cache: only the static app
   shell (single HTML file + manifest + icons) is precached, and requests to
   other origins (Share & Sync: npoint / Supabase) are always passed through. */

const CACHE = 'spr-app-shell-__SW_VERSION__';
const APP_SHELL = ['./', './index.html']; /* owner decision: no web-app manifest — app shell only */

const OFFLINE_FALLBACK = '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width, initial-scale=1"><title>SPR — offline</title>' +
  '<style>body{font-family:system-ui,sans-serif;background:#f4f1ea;color:#22312c;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}' +
  '.c{max-width:30em;padding:2em}h1{font-size:1.2em}p{line-height:1.5;color:#4b5563}</style></head><body><div class="c">' +
  '<h1>SPR could not load from the offline cache</h1>' +
  '<p>Connect to the internet once and reopen this page, then SPR will work offline again.</p>' +
  '<p>Your student data is not lost — it stays in this browser\'s storage.</p>' +
  '</div></body></html>';

self.addEventListener('install', (event) => {
  /* precache the whole shell; a failed install keeps the previous worker active */
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP_SHELL)));
});

self.addEventListener('activate', (event) => {
  /* delete only SPR-owned old caches, then take control of open pages */
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('spr-app-shell-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

/* Update policy: NEVER skipWaiting automatically. The new worker waits until
   the teacher taps "Reload now" on the update banner (posted as a message). */
self.addEventListener('message', (event) => {
  if (event.data === 'SPR_SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return; /* Share & Sync and any third-party traffic: never cached, never intercepted */
  if (event.request.method !== 'GET') return;
  if (event.request.mode !== 'navigate') return; /* static subresources are precached at install; nothing else is intercepted */

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = (await cache.match('./index.html')) || (await cache.match('./'));
    if (cached) return cached; /* cache-first for the app shell */
    try {
      return await fetch(event.request); /* first visit before install completes */
    } catch (err) {
      return new Response(OFFLINE_FALLBACK, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
  })());
});
