// Kill-switch for the retired PWA service worker.
//
// Browsers that installed the old vite-plugin-pwa worker keep checking this
// same URL for updates. This version replaces it, wipes every cache it left
// behind, unregisters itself and reloads open tabs so they fetch the live
// site from the network again. Keep this file deployed for a few months.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
    await self.registration.unregister();
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach((client) => client.navigate(client.url));
  })());
});
