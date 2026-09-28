// Bump this when app.js / styles.css / index.html change, so old caches get replaced.
var CACHE_NAME = "market-tracker-v3";
var CORE_ASSETS = ["./", "./index.html", "./styles.css", "./app.js", "./manifest.json"];

self.addEventListener("install", function(event){
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(cache){
        // cache:"reload" skips the browser's HTTP cache, so all files come from the same fresh deploy
        return Promise.all(CORE_ASSETS.map(function(url){
          return fetch(new Request(url, { cache: "reload" })).then(function(res){
            if(!res.ok) throw new Error("Failed to cache " + url);
            return cache.put(url, res);
          });
        }));
      })
      .then(function(){ return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function(event){
  event.waitUntil(
    caches.keys()
      .then(function(keys){
        return Promise.all(keys.filter(function(k){ return k !== CACHE_NAME; }).map(function(k){ return caches.delete(k); }));
      })
      .then(function(){ return self.clients.claim(); })
  );
});

// Cache-first for the app shell, so it opens instantly offline;
// falls back to network for anything not yet cached (like sync.js, or GitHub API calls),
// and quietly updates the cache when network succeeds.
self.addEventListener("fetch", function(event){
  if(event.request.method !== "GET") return;
  if(event.request.url.indexOf("api.github.com") !== -1) return; // never intercept sync calls

  event.respondWith(
    caches.match(event.request).then(function(cached){
      var networkFetch = fetch(event.request)
        .then(function(res){
          if(res && res.status === 200 && res.type === "basic"){
            var copy = res.clone();
            caches.open(CACHE_NAME).then(function(cache){ cache.put(event.request, copy); });
          }
          return res;
        })
        .catch(function(){ return cached; });
      return cached || networkFetch;
    })
  );
});
