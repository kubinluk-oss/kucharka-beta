// Service worker: cachuje jen soubory aplikace (shell). Data žijí ve Firebase,
// takže požadavky mimo tento web necháváme být — aplikace potřebuje připojení.
const CACHE = 'kucharka-beta-v1';   // BETA (repo kucharka-beta) — ostrá appka má kucharka-vNNN
/* Fotky receptů a profilovek. Záměrně VLASTNÍ cache s vlastní verzí: přežije
   aktualizace appky, takže se po každé změně kódu nestahují znovu. Firebase u nich
   posílá `cache-control: private, max-age=0`, takže by je prohlížeč sám nikdy
   neuložil a při každém návratu na stránku by je stahoval znovu. */
const IMG_CACHE = 'kucharka-img-v1';
const IMG_HOST = 'firebasestorage.googleapis.com';
const IMG_MAX = 100;          // strop, ať cache neroste donekonečna
const IMG_STALE = 86400000;  // po dni se uložená fotka na pozadí obnoví (pojistka)
const SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/firebase.js',
  './js/auth.js',
  './js/ui.js',
  './js/util.js',
  './manifest.webmanifest',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        // jen starší verze TÉHLE appky — na stejné doméně běží i beta (kucharka-beta-vN)
        // a její cache musí zůstat
        keys.filter(k => k.startsWith(CACHE.replace(/\d+$/, '')) && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Nejstarší fotky nad limit zahodí (klíče chodí v pořadí vložení).
async function trimImgCache(cache) {
  const keys = await cache.keys();
  if (keys.length <= IMG_MAX) return;
  await Promise.all(keys.slice(0, keys.length - IMG_MAX).map(k => cache.delete(k)));
}

// Appka se umí zeptat, jakou verzi právě obsluhuje — zobrazuje ji v Nastavení,
// ať je po nasazení hned vidět, jestli běží ta nová (viz „Kuchařka · verze …").
self.addEventListener('message', e => {
  if (e.data === 'version') e.source?.postMessage({ version: CACHE });
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;

  /* Fotky: nejdřív z uložené kopie (okamžitě), stáhnout jen když ji ještě nemáme.
     Zamrznout na staré fotce nehrozí: při výměně dostane soubor nový přístupový
     token, takže má jinou adresu, kterou si klienti načtou z receptu — a ta v
     uložených kopiích není. Navíc pojistka: kopii starší než den obnovíme na
     pozadí (zobrazí se hned ta uložená, čerstvá naskočí při příštím otevření). */
  /* Jen samotné STAHOVÁNÍ obrázku (`alt=media`, bez přihlášení — klíč je v odkazu).
     Ostatní dotazy na Storage (zjištění adresy po nahrání apod.) nesou přihlášení
     v hlavičce a tady by o ni přišly — Firebase by je pak odmítl jako nepřihlášené. */
  if (url.hostname === IMG_HOST && url.searchParams.get('alt') === 'media'
      && !e.request.headers.has('Authorization')) {
    /* <img> bez crossorigin posílá požadavek v režimu no-cors a odpověď je pak
       „opaque" (status 0, ok=false, bez hlaviček) — nic by se neuložilo a stáří by
       nešlo poznat. Stahujeme proto v režimu cors: Firebase Storage posílá
       `access-control-allow-origin: *` a vystavuje i hlavičku Date. */
    const req = new Request(e.request.url, { mode: 'cors', credentials: 'omit' });
    e.respondWith((async () => {
      const cache = await caches.open(IMG_CACHE);
      const hit = await cache.match(req);
      if (hit) {
        const d = hit.headers.get('date');
        const stara = !d || (Date.now() - Date.parse(d)) > IMG_STALE;
        if (stara) e.waitUntil((async () => {
          try {
            const fresh = await fetch(req);
            if (fresh.ok) await cache.put(req, fresh);
          } catch { /* offline — necháme uloženou kopii */ }
        })());
        return hit;
      }
      let res;
      try { res = await fetch(req); } catch { return fetch(e.request); }   // pojistka, kdyby cors selhal
      if (res.ok) { await cache.put(req, res.clone()); trimImgCache(cache); }
      return res;
    })());
    return;
  }

  if (url.origin !== location.origin) return;
  // network-first s revalidací (obchází heuristickou HTTP cache prohlížeče),
  // cache je záloha pro výpadky
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then(res => {
        // chybovou odpověď (404/500) neukládat — přepsala by dobrou zálohu pro offline
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
