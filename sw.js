/* Service worker : l'app se charge même sans réseau (réseau d'abord, copie locale en secours).
   Les gros fichiers (reseau.bin, nn.wasm, nn_scalaire.wasm) ne passent PAS par ici : worker.js les garde lui-même sur l'appareil
   (Cache API, avec contrôle) pour éviter de les télécharger deux fois et de garder une copie abîmée. */
const VERSION = 'go-v2';
const GROS = ['reseau.bin', 'nn.wasm', 'nn_scalaire.wasm'];
const FICHIERS = ['./', 'index.html', 'styles.css', 'app.js', 'moteur.js', 'plateau.js', 'worker.js', 'goban.js', 'situation.js', 'features.js',
  'moteur_nn.js', 'recherche.js', 'fin.js', 'niveaux.js', 'bot.js', 'analyse.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/favicon.svg', 'diagnostic.html'];
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
  if (gros) return;           // le navigateur s'en occupe (voir worker.js)
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok) { const copie = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copie)); }
    return r;
  }).catch(() => caches.match(e.request)));
});
