/* Versioned shell with eager asset caching: the first offline reload must work. */
const VERSION = 'cortex-v3-dev';
const PRECACHE_ASSETS = [];
const SHELL = ['/', '/manifest.webmanifest', '/favicon.svg'];
async function shell(cache) {
  const response = await fetch('/', { cache: 'reload' });
  if (!response.ok) throw new Error('Failed to cache application shell');
  const html = await response.clone().text();
  const assets = [...html.matchAll(/(?:src|href)=["'](\/assets\/[^"']+)["']/g)].map((match) => match[1]);
  await cache.addAll([...new Set([...SHELL.slice(1), ...assets, ...PRECACHE_ASSETS])]);
  await cache.put('/', response);
}
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then(shell).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('cortex-') && key !== VERSION).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api') || url.pathname === '/healthz') return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        event.waitUntil(caches.open(VERSION).then(async (cache) => {
        const html = await copy.clone().text();
        const assets = [...html.matchAll(/(?:src|href)=["'](\/assets\/[^"']+)["']/g)].map((match) => match[1]);
        // Publish the new shell only after every required asset is durable.
        await cache.addAll(assets);
        await cache.put('/', copy);
        }));
      }
      return response;
    }).catch(async () => await caches.match('/') ?? Response.error()));
    return;
  }
  if (!url.pathname.startsWith('/assets/') && !SHELL.includes(url.pathname) && !url.pathname.startsWith('/icons/')) return;
  event.respondWith(caches.match(event.request).then(async (cached) => {
    if (cached) return cached;
    const response = await fetch(event.request);
    if (response.ok) { const copy = response.clone(); event.waitUntil(caches.open(VERSION).then((cache) => cache.put(event.request, copy))); }
    return response;
  }));
});
