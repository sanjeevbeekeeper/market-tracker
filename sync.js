(function(global){
  "use strict";

  // Safe UTF-8 -> base64 (needed because catalog/vegetable names can contain Tamil text).
  function b64EncodeUnicode(str){
    return btoa(unescape(encodeURIComponent(str)));
  }

  function ghHeaders(token){
    return {
      "Authorization": "Bearer " + token,
      "Content-Type": "application/json",
      "Accept": "application/vnd.github+json"
    };
  }

  function apiUrl(cfg, path){
    return "https://api.github.com/repos/" + cfg.owner + "/" + cfg.repo + "/contents/" + path;
  }

  // Files that already exist need their current sha to update; new files don't.
  function getSha(cfg, path){
    return fetch(apiUrl(cfg, path), { headers: ghHeaders(cfg.token) })
      .then(function(res){
        if(res.status === 200) return res.json().then(function(j){ return j.sha; });
        return null;
      })
      .catch(function(){ return null; });
  }

  function putFile(cfg, path, contentObj, message){
    return getSha(cfg, path).then(function(sha){
      var body = {
        message: message,
        content: b64EncodeUnicode(JSON.stringify(contentObj, null, 2))
      };
      if(sha) body.sha = sha;
      return fetch(apiUrl(cfg, path), {
        method: "PUT",
        headers: ghHeaders(cfg.token),
        body: JSON.stringify(body)
      }).then(function(res){
        if(!res.ok){
          return res.text().then(function(errText){
            throw new Error("GitHub error " + res.status + " on " + path + ": " + errText.slice(0, 200));
          });
        }
        return res.json();
      });
    });
  }

  global.MarketSync = {
    // Pushes the pending-changes batch as its own dated file (recovery log),
    // then overwrites the three current-state snapshot files.
    push: function(state, cfg){
      if(!cfg || !cfg.owner || !cfg.repo || !cfg.token){
        return Promise.reject(new Error("GitHub not configured"));
      }
      var ts = new Date().toISOString().replace(/[:.]/g, "-");
      var chain = Promise.resolve();

      if(state.pendingChanges && state.pendingChanges.length){
        chain = chain.then(function(){
          return putFile(cfg, "data/changes/" + ts + ".json", state.pendingChanges, "Sync changes " + ts);
        });
      }
      chain = chain
        .then(function(){ return putFile(cfg, "data/catalog.json", state.catalog, "Update catalog " + ts); })
        .then(function(){ return putFile(cfg, "data/markets.json", state.markets, "Update markets " + ts); })
        .then(function(){ return putFile(cfg, "data/trips.json", state.trips, "Update trips " + ts); });

      return chain;
    }
  };
})(window);
