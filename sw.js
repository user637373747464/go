/* Service worker : l'app se charge même sans réseau.
   - le gros réseau de neurones (reseau.bin, 12 Mo) et nn.wasm : copie locale d'abord (on ne les retélécharge pas à chaque ouverture)
   - le reste : réseau d'abord, copie locale en secours */
const VERSION = 'go-v1';
const GROS = ['reseau.bin', 'nn.wasm'];
const FICHIERS = ['./', 'index.html', 'styles.css', 'app.js', 'moteur.js', 'plateau.js', 'worker.js', 'goban.js', 'situation.js', 'features.js',
  'moteur_nn.js', 'recherche.js', 'fin.js', 'niveaux.js', 'bot.js', 'analyse.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/favicon.svg', 'nn.wasm', 'reseau.bin'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => Promise.all(FICHIERS.map(f => c.add(f).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const gros = GROS.some(g => url.pathname.endsWith('/' + g));
  if (gros) {
    e.respondWith(caches.match(e.request).then(c => c || fetch(e.request).then(r => {
      if (r.ok) { const copie = r.clone(); caches.open(VERSION).then(ca => ca.put(e.request, copie)); }
      return r;
    })));
    return;
  }
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok) { const copie = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copie)); }
    return r;
  }).catch(() => caches.match(e.request)));
});
