const cacheName = 'obqr-cache-v1';
const assets = ['./','./index.html','./style.css','./app.js','./manifest.json','https://cdn.jsdelivr.net/npm/jsqr/dist/jsQR.js'];

self.addEventListener('install', e=>{
    e.waitUntil(caches.open(cacheName).then(cache=>cache.addAll(assets)));
});

self.addEventListener('fetch', e=>{
    e.respondWith(caches.match(e.request).then(response=>response || fetch(e.request)));
});
