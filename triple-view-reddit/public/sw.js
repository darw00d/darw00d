// Shell-only cache for the app's own files, so it opens offline.
// Reddit data and media are never cached or stored here.
const CACHE = "triple-view-reddit-shell-6";
const SHELL = ["./", "index.html", "app.js", "config.js", "reddit-local.js", "setup.js", "playback.js", "styles.css", "manifest.json", "icon.svg", "apple-touch-icon.png"];
const SHELL_URLS = SHELL.map((p) => new URL(p, self.registration.scope).pathname);

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !SHELL_URLS.includes(url.pathname)) return;
  // Network first so updates appear immediately; the cache is only an offline fallback.
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match(new URL("index.html", self.registration.scope).href)))
  );
});
