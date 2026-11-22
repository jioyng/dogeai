// 오프라인 실행을 위한 서비스 워커
// 네트워크 우선: 서버가 켜져 있으면 항상 최신 파일을 받고 캐시를 갱신,
// 오프라인이거나 서버가 꺼져 있으면 캐시된 파일로 실행합니다.
const CACHE = 'dodge-v3';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './stages.js',
  './audio.js',
  './game.js',
  './pwa.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
