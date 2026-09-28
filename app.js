(function(){
  "use strict";
  var STORAGE_KEY = "marketTrackerApp.v5";
  var GH_CONFIG_KEY = "marketTrackerGithubConfig";
  var UNIT_LABEL = { g: "g", rupee: "₹", piece: "pcs" };
  var QTY_LABELS = { g: "Quantity (grams)", rupee: "Quantity (₹ planned)", piece: "Quantity (pieces / kattu)" };

  function uid(){ return Math.random().toString(36).slice(2,10) + Date.now().toString(36).slice(-4); }
  function todayISO(){ var d=new Date(); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
  function fmtDate(iso){
    var d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString(undefined, { weekday:'short', day:'numeric', month:'short' });
  }
  function fmtTime(ts){
    if(!ts) return "";
    return new Date(ts).toLocaleTimeString(undefined, { hour:'numeric', minute:'2-digit' });
  }
  function fmtDateTime(ts){
    if(!ts) return "";
    var d = new Date(ts);
    return d.toLocaleDateString(undefined,{day:'numeric',month:'short'}) + " · " + fmtTime(ts);
  }
  function money(n){ return "₹" + (Math.round(n*100)/100).toString(); }
  function displayName(nameEn, nameTa){ return nameTa ? (nameEn + " (" + nameTa + ")") : nameEn; }
  function escapeHtml(s){ var d = document.createElement("div"); d.textContent = s == null ? "" : s; return d.innerHTML; }
  function sortedCatalog(){
    return state.catalog.slice().sort(function(a,b){ return a.name.toLowerCase().localeCompare(b.name.toLowerCase()); });
  }

  function defaultState(){ return { version:5, catalog: [], markets: [], trips: [], pendingChanges: [], lastSyncedAt: null }; }

  var state = load();
  function load(){
    try{
      var raw = localStorage.getItem(STORAGE_KEY);
      if(!raw) return defaultState();
      var p = JSON.parse(raw);
      if(!p) return defaultState();
      p.catalog = p.catalog || []; p.markets = p.markets || []; p.trips = p.trips || [];
      p.pendingChanges = p.pendingChanges || []; p.lastSyncedAt = p.lastSyncedAt || null;
      p.trips.forEach(function(t){ if(!t.status) t.status = "open"; });
      return p;
    }catch(e){ console.error("Load failed", e); return defaultState(); }
  }
  function save(){ try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }catch(e){ console.error("Save failed", e); } }

  // Every mutation logs a small entry here; the GitHub push sends this batch, then clears it.
  function queueChange(type, payload){
    state.pendingChanges.push({ id: uid(), ts: Date.now(), type: type, payload: payload });
    save();
    renderSyncBar();
  }

  function getOpenTrip(){ return state.trips.find(function(t){ return t.status === "open"; }); }
  function tripTotal(trip){
    return trip.items.reduce(function(sum,it){ return sum + (it.purchased ? Number(it.amountPaid||0) : 0); }, 0);
  }

  function describeItem(item){
    var u = item.unit || "g";
    var qtyLabel;
    if(item.plannedQty == null || item.plannedQty === ""){
      qtyLabel = "no " + (u === "rupee" ? "amount" : "qty") + " set";
    } else if(u === "rupee"){
      qtyLabel = "₹" + item.plannedQty + " planned";
    } else {
      qtyLabel = item.plannedQty + " " + UNIT_LABEL[u] + " planned";
    }
    if(!item.purchased) return qtyLabel;
    var parts = [money(Number(item.amountPaid))];
    if(item.actualWeight != null && item.actualWeight !== "") parts.push(item.actualWeight + "g actual");
    if(item.purchasedAt) parts.push(fmtTime(item.purchasedAt));
    return parts.join(" · ");
  }

  // ================= HOME VIEW (checkoff only) =================
  var homeWrap = document.getElementById("homeWrap");
  var pageSub = document.getElementById("pageSub");

  function renderHome(){
    var trip = getOpenTrip();
    homeWrap.innerHTML = "";

    if(!trip){
      pageSub.textContent = "No trip started";
      var empty = document.createElement("div");
      empty.className = "card empty-note";
      empty.innerHTML = 'No trip is started yet.<br>Go to <strong>Trip</strong> to add one and hit Start.<br><br><button class="ghost" id="jumpToTripsBtn">Go to Trip</button>';
      homeWrap.appendChild(empty);
      document.getElementById("jumpToTripsBtn").addEventListener("click", function(){
        document.querySelector('.tab[data-tab="trips"]').click();
      });
      return;
    }

    pageSub.textContent = trip.marketName + " · " + fmtDate(trip.date);

    var purchasedCount = trip.items.filter(function(i){ return i.purchased; }).length;
    var totalCount = trip.items.length;
    var pct = totalCount ? Math.round((purchasedCount/totalCount)*100) : 0;

    var head = document.createElement("div");
    head.className = "card trip-head";
    head.innerHTML =
      '<div class="row1"><div class="market"></div><div class="date"></div></div>' +
      '<div class="progress-row"><div class="progress-track"><div class="progress-fill"></div></div><div class="progress-count"></div></div>' +
      '<div class="total-row"><div class="total-label">Total spent</div><div class="total-amt"></div></div>';
    head.querySelector(".market").textContent = trip.marketName;
    head.querySelector(".date").textContent = fmtDate(trip.date);
    head.querySelector(".progress-fill").style.width = pct + "%";
    head.querySelector(".progress-count").textContent = purchasedCount + " / " + totalCount;
    head.querySelector(".total-amt").textContent = money(tripTotal(trip));
    homeWrap.appendChild(head);

    if(trip.items.length === 0){
      var e2 = document.createElement("div");
      e2.className = "card empty-note";
      e2.textContent = "This trip has no items. Add some from the Trip page before you head out.";
      homeWrap.appendChild(e2);
      return;
    }

    var card = document.createElement("div");
    card.className = "card";
    trip.items.forEach(function(item){
      var row = document.createElement("div");
      row.className = "item-row" + (item.purchased ? " done" : "");
      row.innerHTML =
        '<button class="tick" aria-label="Purchase"><svg viewBox="0 0 24 24" fill="none"><path d="M4 12.5L9.5 18L20 6" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></button>' +
        '<button class="body"><div class="name"></div><div class="meta"></div></button>';
      row.querySelector(".name").innerHTML = item.nameTamil
        ? (escapeHtml(item.name) + ' <span class="tamil">(' + escapeHtml(item.nameTamil) + ')</span>')
        : escapeHtml(item.name);
      row.querySelector(".meta").textContent = describeItem(item);
      var openModal = function(){ openPurchaseModal(trip, item); };
      row.querySelector(".tick").addEventListener("click", openModal);
      row.querySelector(".body").addEventListener("click", openModal);
      card.appendChild(row);
    });
    homeWrap.appendChild(card);
  }

  // ---- Purchase modal (Home only) ----
  var purchaseBackdrop = document.getElementById("purchaseBackdrop");
  var purchaseUnitToggle = document.getElementById("purchaseUnitToggle");
  var purchaseQty = document.getElementById("purchaseQty");
  var purchaseQtyLabel = document.getElementById("purchaseQtyLabel");
  var purchaseAmount = document.getElementById("purchaseAmount");
  var purchaseActualWeight = document.getElementById("purchaseActualWeight");
  var purchaseConfirmBtn = document.getElementById("purchaseConfirmBtn");
  var currentModalCtx = null;

  function setModalUnit(u){
    currentModalCtx.unit = u;
    purchaseUnitToggle.querySelectorAll("button").forEach(function(b){ b.classList.toggle("active", b.dataset.unit === u); });
    purchaseQtyLabel.textContent = QTY_LABELS[u];
  }
  purchaseUnitToggle.querySelectorAll("button").forEach(function(b){
    b.addEventListener("click", function(){ setModalUnit(b.dataset.unit); });
  });

  function openPurchaseModal(trip, item){
    currentModalCtx = { trip: trip, item: item, unit: item.unit || "g" };
    document.getElementById("purchaseTitle").textContent = displayName(item.name, item.nameTamil);
    setModalUnit(currentModalCtx.unit);
    purchaseQty.value = (item.plannedQty != null) ? item.plannedQty : "";
    purchaseAmount.value = (item.amountPaid != null) ? item.amountPaid : "";
    purchaseActualWeight.value = (item.actualWeight != null) ? item.actualWeight : "";
    purchaseConfirmBtn.textContent = item.purchased ? "Update" : "Mark purchased";
    purchaseBackdrop.classList.add("open");
    purchaseAmount.focus();
  }
  document.getElementById("purchaseCancelBtn").addEventListener("click", function(){ purchaseBackdrop.classList.remove("open"); });
  purchaseBackdrop.addEventListener("click", function(e){ if(e.target === purchaseBackdrop) purchaseBackdrop.classList.remove("open"); });

  purchaseConfirmBtn.addEventListener("click", function(){
    if(purchaseAmount.value === "" || isNaN(Number(purchaseAmount.value)) || Number(purchaseAmount.value) < 0){
      purchaseAmount.focus();
      purchaseAmount.style.borderColor = "var(--danger)";
      return;
    }
    purchaseAmount.style.borderColor = "";
    var item = currentModalCtx.item;
    var trip = currentModalCtx.trip;
    item.unit = currentModalCtx.unit;
    item.plannedQty = purchaseQty.value === "" ? null : Number(purchaseQty.value);
    item.amountPaid = Number(purchaseAmount.value);
    item.actualWeight = purchaseActualWeight.value === "" ? null : Number(purchaseActualWeight.value);
    item.purchased = true;
    item.purchasedAt = Date.now(); // silent, for later reference
    save();
    queueChange("item_purchase", { tripId: trip.id, itemId: item.id, name: item.name, unit: item.unit, plannedQty: item.plannedQty, amountPaid: item.amountPaid, actualWeight: item.actualWeight, purchasedAt: item.purchasedAt });
    purchaseBackdrop.classList.remove("open");
    renderHome();
  });

  // ================= CATALOG VIEW (vegetables, with search-as-you-add) =================
  var vegListWrap = document.getElementById("vegListWrap");
  var vegSearchEn = document.getElementById("vegSearchEn");
  var vegSearchTa = document.getElementById("vegSearchTa");
  var vegSearchStatus = document.getElementById("vegSearchStatus");
  var editingVegId = null;

  function renderCatalog(){
    var qEn = vegSearchEn.value.trim().toLowerCase();
    var qTa = vegSearchTa.value.trim();
    var hasQuery = qEn.length > 0 || qTa.length > 0;

    var list = sortedCatalog().filter(function(v){
      if(!hasQuery) return true;
      var enMatch = qEn.length > 0 && v.name.toLowerCase().indexOf(qEn) !== -1;
      var taMatch = qTa.length > 0 && v.nameTamil && v.nameTamil.indexOf(qTa) !== -1;
      return enMatch || taMatch;
    });

    if(hasQuery){
      vegSearchStatus.textContent = list.length > 0
        ? (list.length + " match" + (list.length === 1 ? "" : "es") + " already in your catalog")
        : "Not available — tap Add to create it";
    } else {
      vegSearchStatus.textContent = "";
    }

    vegListWrap.innerHTML = "";
    if(state.catalog.length === 0){
      vegListWrap.innerHTML = '<div class="empty-note">No vegetables yet. Add your first one above.</div>';
      return;
    }
    if(list.length === 0){
      vegListWrap.innerHTML = '<div class="empty-note">Not available in your catalog yet.<br>Tap Add above to create it.</div>';
      return;
    }

    list.forEach(function(veg){
      if(editingVegId === veg.id){
        var erow = document.createElement("div");
        erow.className = "edit-row";
        erow.innerHTML =
          '<div class="field"><input type="text" class="ev-name" placeholder="Name (English)" maxlength="40"></div>' +
          '<div class="field" style="margin-bottom:12px;"><input type="text" class="ev-tamil" placeholder="Name (Tamil)" maxlength="40"></div>' +
          '<div class="edit-actions"><button class="text-btn ev-cancel">Cancel</button><button class="text-btn ev-save">Save</button></div>';
        erow.querySelector(".ev-name").value = veg.name;
        erow.querySelector(".ev-tamil").value = veg.nameTamil || "";
        erow.querySelector(".ev-cancel").addEventListener("click", function(){ editingVegId = null; renderCatalog(); });
        erow.querySelector(".ev-save").addEventListener("click", function(){
          var nv = erow.querySelector(".ev-name").value.trim();
          if(!nv) return;
          veg.name = nv;
          veg.nameTamil = erow.querySelector(".ev-tamil").value.trim();
          editingVegId = null;
          save();
          queueChange("catalog_edit", { id: veg.id, name: veg.name, nameTamil: veg.nameTamil });
          renderCatalog();
        });
        vegListWrap.appendChild(erow);
      } else {
        var row = document.createElement("div");
        row.className = "list-row";
        row.innerHTML =
          '<div class="lname"></div>' +
          '<div class="row-actions"><button class="icon-btn ev-edit" aria-label="Edit">✎</button><button class="icon-btn danger ev-del" aria-label="Delete">&times;</button></div>';
        row.querySelector(".lname").innerHTML = veg.nameTamil
          ? (escapeHtml(veg.name) + ' <span class="tamil">(' + escapeHtml(veg.nameTamil) + ')</span>')
          : escapeHtml(veg.name);
        row.querySelector(".ev-edit").addEventListener("click", function(){ editingVegId = veg.id; renderCatalog(); });
        row.querySelector(".ev-del").addEventListener("click", function(){
          if(confirm('Remove "' + veg.name + '" from your catalog? (Existing trips keep their record.)')){
            state.catalog = state.catalog.filter(function(v){ return v.id !== veg.id; });
            save();
            queueChange("catalog_delete", { id: veg.id, name: veg.name });
            renderCatalog();
          }
        });
        vegListWrap.appendChild(row);
      }
    });
  }

  vegSearchEn.addEventListener("input", renderCatalog);
  vegSearchTa.addEventListener("input", renderCatalog);

  document.getElementById("vegAddBtn").addEventListener("click", function(){
    var val = vegSearchEn.value.trim();
    var tamilVal = vegSearchTa.value.trim();
    if(!val){ vegSearchEn.focus(); return; }
    var dup = state.catalog.some(function(v){ return v.name.toLowerCase() === val.toLowerCase(); });
    if(dup){ alert('"' + val + '" is already in your catalog.'); return; }
    var veg = { id: uid(), name: val, nameTamil: tamilVal };
    state.catalog.push(veg);
    save();
    queueChange("catalog_add", veg);
    vegSearchEn.value = ""; vegSearchTa.value = "";
    renderCatalog();
  });

  // ================= MARKET VIEW =================
  var marketListWrap = document.getElementById("marketListWrap");
  var editingMarketId = null;

  function renderMarkets(){
    marketListWrap.innerHTML = "";
    if(state.markets.length === 0){
      marketListWrap.innerHTML = '<div class="empty-note">No markets yet. Add one below.</div>';
    } else {
      state.markets.forEach(function(m){
        if(editingMarketId === m.id){
          var emrow = document.createElement("div");
          emrow.className = "edit-row";
          emrow.innerHTML =
            '<div class="field"><input type="text" class="em-name" placeholder="Market name" maxlength="40"></div>' +
            '<div class="field" style="margin-bottom:12px;"><select class="em-day">' +
              '<option value="">Any day</option><option>Monday</option><option>Tuesday</option><option>Wednesday</option>' +
              '<option>Thursday</option><option>Friday</option><option>Saturday</option><option>Sunday</option>' +
            '</select></div>' +
            '<div class="edit-actions"><button class="text-btn em-cancel">Cancel</button><button class="text-btn em-save">Save</button></div>';
          emrow.querySelector(".em-name").value = m.name;
          emrow.querySelector(".em-day").value = m.weekday || "";
          emrow.querySelector(".em-cancel").addEventListener("click", function(){ editingMarketId = null; renderMarkets(); });
          emrow.querySelector(".em-save").addEventListener("click", function(){
            var nv = emrow.querySelector(".em-name").value.trim();
            if(!nv) return;
            m.name = nv;
            m.weekday = emrow.querySelector(".em-day").value;
            editingMarketId = null;
            save();
            queueChange("market_edit", { id: m.id, name: m.name, weekday: m.weekday });
            renderMarkets(); renderHome(); renderTrips();
          });
          marketListWrap.appendChild(emrow);
        } else {
          var row2 = document.createElement("div");
          row2.className = "list-row";
          row2.innerHTML =
            '<div><div class="lname"></div><div class="lsub"></div></div>' +
            '<div class="row-actions"><button class="icon-btn em-edit" aria-label="Edit">✎</button><button class="icon-btn danger em-del" aria-label="Delete">&times;</button></div>';
          row2.querySelector(".lname").textContent = m.name;
          row2.querySelector(".lsub").textContent = m.weekday || "Any day";
          row2.querySelector(".em-edit").addEventListener("click", function(){ editingMarketId = m.id; renderMarkets(); });
          row2.querySelector(".em-del").addEventListener("click", function(){
            if(confirm('Remove "' + m.name + '"?')){
              state.markets = state.markets.filter(function(x){ return x.id !== m.id; });
              save();
              queueChange("market_delete", { id: m.id, name: m.name });
              renderMarkets(); renderHome();
            }
          });
          marketListWrap.appendChild(row2);
        }
      });
    }
  }

  document.getElementById("newMarketBtn").addEventListener("click", function(){
    var input = document.getElementById("newMarketInput");
    var val = input.value.trim();
    if(!val) return;
    var day = document.getElementById("newMarketDay").value;
    var market = { id: uid(), name: val, weekday: day };
    state.markets.push(market);
    input.value = "";
    document.getElementById("newMarketDay").value = "";
    save();
    queueChange("market_add", market);
    renderMarkets(); renderHome();
  });

  // ================= TRIPS VIEW =================
  var tripsWrap = document.getElementById("tripsWrap");
  var openBlockIds = {};

  // -- Add trip sheet --
  var addTripBackdrop = document.getElementById("addTripBackdrop");
  document.getElementById("openAddTripBtn").addEventListener("click", function(){
    if(state.markets.length === 0){
      alert("Add a market in the Market tab first.");
      return;
    }
    var sel = document.getElementById("tripMarketSelect");
    sel.innerHTML = "";
    state.markets.forEach(function(m){
      var opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.name + (m.weekday ? " · " + m.weekday : "");
      sel.appendChild(opt);
    });
    document.getElementById("tripDateInput").value = todayISO();
    addTripBackdrop.classList.add("open");
  });
  document.getElementById("addTripCancelBtn").addEventListener("click", function(){ addTripBackdrop.classList.remove("open"); });
  addTripBackdrop.addEventListener("click", function(e){ if(e.target === addTripBackdrop) addTripBackdrop.classList.remove("open"); });

  document.getElementById("addTripConfirmBtn").addEventListener("click", function(){
    var marketId = document.getElementById("tripMarketSelect").value;
    var market = state.markets.find(function(m){ return m.id === marketId; });
    var date = document.getElementById("tripDateInput").value || todayISO();
    var newTrip = { id: uid(), marketId: marketId, marketName: market.name, date: date, status: "draft", createdAt: Date.now(), items: [] };
    state.trips.push(newTrip);
    save();
    queueChange("trip_create", { id: newTrip.id, marketName: newTrip.marketName, date: newTrip.date });
    addTripBackdrop.classList.remove("open");
    openBlockIds = {}; openBlockIds[newTrip.id] = true;
    renderTrips();
  });

  function renderAddItemsBlock(trip, container){
    var wrap = document.createElement("div");
    wrap.className = "add-items-block";
    wrap.innerHTML = '<div class="aib-title">Add items</div>';

    var searchRow = document.createElement("div");
    searchRow.className = "aib-new-row";
    searchRow.innerHTML = '<input type="text" class="aib-search" placeholder="Search your catalog to add">';
    wrap.appendChild(searchRow);

    var resultsWrap = document.createElement("div");
    wrap.appendChild(resultsWrap);

    var searchInput = searchRow.querySelector(".aib-search");
    searchInput.addEventListener("input", renderResults);
    renderResults();

    function renderResults(){
      resultsWrap.innerHTML = "";
      var q = searchInput.value.trim().toLowerCase();
      var inTripIds = trip.items.map(function(i){ return i.vegId; });
      var available = sortedCatalog().filter(function(v){ return inTripIds.indexOf(v.id) === -1; });

      if(available.length === 0){
        var hint = document.createElement("div");
        hint.className = "empty-note";
        hint.style.padding = "12px 0";
        hint.textContent = "Everything in your catalog is already on this trip, or your catalog is empty.";
        resultsWrap.appendChild(hint);
        return;
      }

      var matches = q === "" ? available : available.filter(function(v){
        return v.name.toLowerCase().indexOf(q) !== -1 || (v.nameTamil && v.nameTamil.indexOf(q) !== -1);
      });

      if(matches.length === 0){
        var none = document.createElement("div");
        none.className = "empty-note";
        none.style.padding = "12px 0";
        none.textContent = "No match in your catalog.";
        resultsWrap.appendChild(none);
        return;
      }

      matches.forEach(function(veg){
        var row = document.createElement("div");
        row.className = "catalog-pick-row";
        row.innerHTML =
          '<div class="cp-name"></div>' +
          '<div class="cp-unit-row">' +
            '<button type="button" data-unit="g" class="active">Grams</button>' +
            '<button type="button" data-unit="rupee">₹</button>' +
            '<button type="button" data-unit="piece">Pieces</button>' +
          '</div>' +
          '<div class="cp-qty-row"><input type="number" inputmode="decimal" placeholder="qty"><button class="add-btn">Add</button></div>';
        row.querySelector(".cp-name").innerHTML = veg.nameTamil
          ? (escapeHtml(veg.name) + ' <span class="tamil">(' + escapeHtml(veg.nameTamil) + ')</span>')
          : escapeHtml(veg.name);
        var unit = "g";
        var toggleBtns = row.querySelectorAll(".cp-unit-row button");
        toggleBtns.forEach(function(b){
          b.addEventListener("click", function(){
            toggleBtns.forEach(function(x){ x.classList.remove("active"); });
            b.classList.add("active");
            unit = b.dataset.unit;
          });
        });
        var qtyInput = row.querySelector("input");
        row.querySelector(".add-btn").addEventListener("click", function(){
          var newItem = {
            id: uid(), vegId: veg.id, name: veg.name, nameTamil: veg.nameTamil || "", unit: unit,
            plannedQty: qtyInput.value === "" ? null : Number(qtyInput.value),
            purchased: false, amountPaid: null, actualWeight: null, purchasedAt: null
          };
          trip.items.push(newItem);
          save();
          queueChange("trip_item_add", { tripId: trip.id, item: newItem });
          renderTrips();
          renderHome();
        });
        resultsWrap.appendChild(row);
      });
    }

    container.appendChild(wrap);
  }

  function renderTrips(){
    tripsWrap.innerHTML = "";
    var all = state.trips.slice().sort(function(a,b){
      var order = { open:0, draft:1, closed:2 };
      if(order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
      return b.date.localeCompare(a.date) || b.createdAt - a.createdAt;
    });

    if(all.length === 0){
      tripsWrap.innerHTML = '<div class="card empty-note">No trips yet. Tap "+ New trip" above to add one.</div>';
      return;
    }

    all.forEach(function(trip){
      var block = document.createElement("div");
      block.className = "trip-block card" + (openBlockIds[trip.id] ? " open" : "");
      var purchasedCount = trip.items.filter(function(i){ return i.purchased; }).length;

      var head = document.createElement("div");
      head.className = "trip-block-head";
      var startBtnHtml = trip.status === "draft" ? '<button class="small-btn tb-start">Start</button>' : "";
      head.innerHTML =
        '<div class="l"><div class="market-row"><span class="market"></span><span class="badge"></span></div><div class="date"></div></div>' +
        '<div class="r">' + startBtnHtml + '<div><div class="amt"></div><div class="cnt"></div></div></div>';
      head.querySelector(".market").textContent = trip.marketName;
      var badge = head.querySelector(".badge");
      var badgeText = trip.status === "draft" ? "Draft" : (trip.status === "open" ? "In progress" : "Done");
      badge.textContent = badgeText;
      badge.classList.add(trip.status);
      head.querySelector(".date").textContent = fmtDate(trip.date);
      head.querySelector(".amt").textContent = money(tripTotal(trip));
      head.querySelector(".cnt").textContent = purchasedCount + "/" + trip.items.length + " bought";
      head.addEventListener("click", function(){
        openBlockIds[trip.id] = !openBlockIds[trip.id];
        renderTrips();
      });
      var startBtn = head.querySelector(".tb-start");
      if(startBtn){
        startBtn.addEventListener("click", function(e){
          e.stopPropagation();
          var existingOpen = getOpenTrip();
          if(existingOpen && existingOpen.id !== trip.id){
            alert('Finish or delete "' + existingOpen.marketName + '" (' + fmtDate(existingOpen.date) + ') before starting a new trip.');
            return;
          }
          if(trip.items.length === 0){
            if(!confirm("This trip has no items yet. Start it anyway?")) return;
          }
          trip.status = "open";
          save();
          queueChange("trip_start", { tripId: trip.id });
          renderTrips();
          renderHome();
        });
      }
      block.appendChild(head);

      var detail = document.createElement("div");
      detail.className = "trip-detail";

      if(trip.items.length === 0 && trip.status === "closed"){
        detail.innerHTML = '<div class="detail-row"><span class="m">No items recorded.</span></div>';
      } else {
        trip.items.forEach(function(item){
          var row = document.createElement("div");
          row.className = "detail-row" + (item.purchased ? "" : " skipped");
          var canRemove = trip.status !== "closed" && !item.purchased;
          row.innerHTML =
            '<div style="flex:1;min-width:0;"><div class="n"></div><div class="m"></div></div>' +
            '<div class="amt"></div>' +
            (canRemove ? '<button class="remove" aria-label="Remove">&times;</button>' : "");
          row.querySelector(".n").innerHTML = item.nameTamil
            ? (escapeHtml(item.name) + ' <span class="tamil">(' + escapeHtml(item.nameTamil) + ')</span>')
            : escapeHtml(item.name);
          if(item.purchased){
            var bits = [];
            if(item.plannedQty != null && item.plannedQty !== "") bits.push(item.plannedQty + " " + UNIT_LABEL[item.unit || "g"]);
            if(item.actualWeight != null && item.actualWeight !== "") bits.push(item.actualWeight + "g actual");
            if(item.purchasedAt) bits.push(fmtTime(item.purchasedAt));
            row.querySelector(".m").textContent = bits.join(" · ");
            row.querySelector(".amt").textContent = money(Number(item.amountPaid));
          } else {
            row.querySelector(".m").textContent = trip.status === "closed" ? "not bought" : describeItem(item);
            row.querySelector(".amt").textContent = "—";
          }
          var removeBtn = row.querySelector(".remove");
          if(removeBtn){
            removeBtn.addEventListener("click", function(){
              trip.items = trip.items.filter(function(i){ return i.id !== item.id; });
              save();
              queueChange("trip_item_remove", { tripId: trip.id, itemId: item.id, name: item.name });
              renderTrips(); renderHome();
            });
          }
          detail.appendChild(row);
        });
      }

      if(trip.status !== "closed"){
        renderAddItemsBlock(trip, detail);

        var actions = document.createElement("div");
        actions.className = "trip-actions";
        var actionsHtml = "";
        if(trip.status === "open") actionsHtml += '<button class="text-btn tb-finish">Finish trip</button>';
        actionsHtml += '<button class="text-btn danger tb-delete">Delete trip</button>';
        actions.innerHTML = actionsHtml;
        var finishBtn = actions.querySelector(".tb-finish");
        if(finishBtn){
          finishBtn.addEventListener("click", function(e){
            e.stopPropagation();
            if(confirm("Finish this trip? You won't be able to edit it after.")){
              trip.status = "closed";
              save();
              queueChange("trip_finish", { tripId: trip.id });
              renderTrips(); renderHome();
            }
          });
        }
        actions.querySelector(".tb-delete").addEventListener("click", function(e){
          e.stopPropagation();
          if(confirm("Delete this trip entirely? This can't be undone.")){
            state.trips = state.trips.filter(function(t){ return t.id !== trip.id; });
            save();
            queueChange("trip_delete", { tripId: trip.id, marketName: trip.marketName, date: trip.date });
            renderTrips(); renderHome();
          }
        });
        detail.appendChild(actions);
      }

      block.appendChild(detail);
      tripsWrap.appendChild(block);
    });
  }

  // ================= GITHUB SYNC =================
  function loadGithubConfig(){
    try{
      var raw = localStorage.getItem(GH_CONFIG_KEY);
      return raw ? JSON.parse(raw) : null;
    }catch(e){ return null; }
  }
  function saveGithubConfig(cfg){
    try{ localStorage.setItem(GH_CONFIG_KEY, JSON.stringify(cfg)); }catch(e){ console.error("Could not save GitHub config", e); }
  }

  var syncBarTitle = document.getElementById("syncBarTitle");
  var syncBarSub = document.getElementById("syncBarSub");
  var syncPushBtn = document.getElementById("syncPushBtn");

  function renderSyncBar(){
    var cfg = loadGithubConfig();
    var pending = state.pendingChanges.length;
    if(!cfg){
      syncBarTitle.textContent = "GitHub not connected";
      syncBarSub.textContent = "Tap \"GitHub settings\" below to connect";
    } else if(pending > 0){
      syncBarTitle.textContent = pending + " offline change" + (pending === 1 ? "" : "s");
      syncBarSub.textContent = "Not pushed yet — push once you're back online";
    } else {
      syncBarTitle.textContent = "All synced";
      syncBarSub.textContent = state.lastSyncedAt ? ("Last pushed " + fmtDateTime(state.lastSyncedAt)) : "Nothing to push yet";
    }
  }

  var githubSettingsBackdrop = document.getElementById("githubSettingsBackdrop");
  document.getElementById("openGithubSettingsBtn").addEventListener("click", openGithubSettings);
  function openGithubSettings(){
    var cfg = loadGithubConfig() || {};
    document.getElementById("ghOwner").value = cfg.owner || "";
    document.getElementById("ghRepo").value = cfg.repo || "";
    document.getElementById("ghToken").value = cfg.token || "";
    githubSettingsBackdrop.classList.add("open");
  }
  document.getElementById("ghCancelBtn").addEventListener("click", function(){ githubSettingsBackdrop.classList.remove("open"); });
  githubSettingsBackdrop.addEventListener("click", function(e){ if(e.target === githubSettingsBackdrop) githubSettingsBackdrop.classList.remove("open"); });
  document.getElementById("ghSaveBtn").addEventListener("click", function(){
    var owner = document.getElementById("ghOwner").value.trim();
    var repo = document.getElementById("ghRepo").value.trim();
    var token = document.getElementById("ghToken").value.trim();
    if(!owner || !repo || !token){ alert("Fill in all three fields."); return; }
    saveGithubConfig({ owner: owner, repo: repo, token: token });
    githubSettingsBackdrop.classList.remove("open");
    renderSyncBar();
  });

  // sync.js is only fetched the first time a push actually happens — keeps the normal offline app lean.
  function loadSyncScript(){
    if(window.MarketSync) return Promise.resolve();
    return new Promise(function(resolve, reject){
      var s = document.createElement("script");
      s.src = "sync.js";
      s.onload = function(){ resolve(); };
      s.onerror = function(){ reject(new Error("Could not load sync.js — check your connection.")); };
      document.body.appendChild(s);
    });
  }

  syncPushBtn.addEventListener("click", function(){
    var cfg = loadGithubConfig();
    if(!cfg){ openGithubSettings(); return; }
    if(state.pendingChanges.length === 0){ alert("Nothing to sync — you're up to date."); return; }

    syncPushBtn.disabled = true;
    syncPushBtn.textContent = "Pushing…";
    loadSyncScript()
      .then(function(){ return window.MarketSync.push(state, cfg); })
      .then(function(){
        state.pendingChanges = [];
        state.lastSyncedAt = Date.now();
        save();
        renderSyncBar();
      })
      .catch(function(err){
        alert("Sync failed: " + err.message);
      })
      .finally(function(){
        syncPushBtn.disabled = false;
        syncPushBtn.textContent = "Push to repo";
      });
  });

  // ================= TABS =================
  var tabs = document.querySelectorAll(".tab");
  var views = {
    home: document.getElementById("view-home"),
    trips: document.getElementById("view-trips"),
    catalog: document.getElementById("view-catalog"),
    market: document.getElementById("view-market")
  };
  var titles = { home: "Home", trips: "Trip", catalog: "Catalog", market: "Market" };
  tabs.forEach(function(tab){
    tab.addEventListener("click", function(){
      tabs.forEach(function(t){ t.classList.remove("active"); });
      tab.classList.add("active");
      Object.keys(views).forEach(function(k){ views[k].classList.remove("active"); });
      views[tab.dataset.tab].classList.add("active");
      document.getElementById("pageTitle").textContent = titles[tab.dataset.tab];
      if(tab.dataset.tab === "home") renderHome();
      else if(tab.dataset.tab === "trips"){ pageSub.textContent = "All your trips"; renderSyncBar(); renderTrips(); }
      else if(tab.dataset.tab === "catalog"){ pageSub.textContent = "Search or add a vegetable"; renderCatalog(); }
      else { pageSub.textContent = "Where you shop"; renderMarkets(); }
    });
  });

  // ---- service worker (offline caching) ----
  if("serviceWorker" in navigator){
    window.addEventListener("load", function(){
      navigator.serviceWorker.register("sw.js").catch(function(e){ console.error("Service worker registration failed", e); });
    });
  }

  // ---- init ----
  renderHome();
  renderCatalog();
  renderMarkets();
  renderTrips();
  renderSyncBar();
})();
