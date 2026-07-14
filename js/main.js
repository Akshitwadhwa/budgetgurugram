(function () {
  "use strict";

  const places = window.GC_PLACES || [];
  const coordinates = window.GC_COORDS || {};
  places.forEach((place) => {
    const point = coordinates[place.id];
    if (point) { place.lng = point[0]; place.lat = point[1]; }
  });
  const motives = window.GC_MOTIVES || [];
  const roles = window.GC_ROLES || [];
  const neighbourhoods = window.GC_NEIGHBOURHOODS || [];
  const intentLabels = {
    all: ["All places", "✦"], food: ["Eat & drink", "◒"], work: ["Workspaces", "⌘"],
    public: ["Public spaces", "⌁"], events: ["Events", "✦"], services: ["Useful services", "＋"]
  };
  const mapCategories = [
    {id:"food", label:"Food", color:"#ef3340", filter:"food"},
    {id:"work", label:"Work Spots", color:"#0ea5e9", filter:"work"},
    {id:"coffee", label:"Coffee", color:"#936037", filter:"food"},
    {id:"gym", label:"Gym", color:"#171827", filter:"gym"},
    {id:"bars", label:"Bars", color:"#d44778", filter:"bars"},
    {id:"grocery", label:"Grocery", color:"#2ca292", filter:"grocery"}
  ];
  const nearYouAreas = [
    {area:"Cyber City", note:"Workdays, coffee & after-hours"},
    {area:"Sector 29", note:"Parks, food & easy evenings"},
    {area:"MG Road", note:"Metro-connected city stops"},
    {area:"Old Gurgaon", note:"Everyday places with character"},
    {area:"Golf Course Road", note:"Premium work & coffee"},
    {area:"Udyog Vihar", note:"Flexible workday bases"}
  ];
  const state = {
    onboardingStep: 1, motives: ["explore"], role: "", locationMode: "area", neighbourhood: "Cyber City",
    coords: {lat: 28.4945, lng: 77.0894}, weather: {temp: 29, icon: "☼", label: "Clear skies · Good to be out"},
    activeCategory: "all", mapCategory: "all", areaFilter: "all", query: "", price: "all", tags: [], saved: new Set(JSON.parse(localStorage.getItem("gc-saved") || "[]")), savedOnly: false
  };
  const $ = (selector, root) => (root || document).querySelector(selector);
  const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector));
  const onboarding = $("[data-onboarding]");
  const app = $("[data-app]");
  const onboardingForm = $("[data-onboarding-form]");
  let liveMap = null;
  let mapMarkers = [];
  let userMarker = null;
  let toastTimer;

  function announce(message) {
    const status = $("[data-status-message]"), toast = $("[data-toast]");
    if (status) status.textContent = message;
    if (!toast) return;
    toast.textContent = message; toast.classList.add("is-visible"); clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2800);
  }

  function renderOnboarding() {
    const step = state.onboardingStep;
    $("[data-step-count]").textContent = String(step).padStart(2, "0") + " / 03";
    $("[data-progress]").style.width = (step * 33.333) + "%";
    if (step === 1) {
      onboardingForm.innerHTML = [
        '<div class="form-kicker">Start with a feeling</div><h2 id="onboarding-title">What brings you to the Commons?</h2>',
        '<p class="form-description">Choose what you want to make easier today. We’ll tune your first view around it.</p><div class="choice-grid">',
        motives.map((item) => '<button class="choice-card ' + (state.motives.includes(item.id) ? "is-selected" : "") + '" type="button" data-motive="' + item.id + '" aria-pressed="' + state.motives.includes(item.id) + '"><span class="choice-card__icon">' + item.icon + '</span><span><strong>' + item.label + '</strong><small>' + item.detail + '</small></span><span class="choice-card__check">✓</span></button>').join(""),
        '</div><div class="form-footer"><small>Select as many as you like. You can change this later.</small><button class="primary-button" type="button" data-next>Continue <span>↗</span></button></div>'
      ].join("");
      return;
    }
    if (step === 2) {
      onboardingForm.innerHTML = [
        '<div class="form-kicker">A little context</div><h2 id="onboarding-title">Who are you making the city work for?</h2>',
        '<p class="form-description">This helps us surface the right mix of workdays, communities, events and places. It’s completely optional.</p><div class="role-row">',
        roles.map((role) => '<button class="role-chip ' + (state.role === role ? "is-selected" : "") + '" type="button" data-role="' + role + '">' + role + '</button>').join(""),
        '</div><div class="form-footer"><button class="secondary-button" type="button" data-back>Back</button><button class="primary-button" type="button" data-next>Continue <span>↗</span></button></div>'
      ].join("");
      return;
    }
    onboardingForm.innerHTML = [
      '<div class="form-kicker">Make it nearby</div><h2 id="onboarding-title">Where should we start?</h2>',
      '<p class="form-description">We use your approximate location to show nearby places, travel distance and whether the weather is good to visit.</p>',
      '<div class="location-choice"><button type="button" class="' + (state.locationMode === "current" ? "is-selected" : "") + '" data-location-choice="current"><span class="location-icon">⌖</span><strong>Use my location</strong><small>Only used to personalise your view</small></button>',
      '<button type="button" class="' + (state.locationMode === "area" ? "is-selected" : "") + '" data-location-choice="area"><span class="location-icon">⌂</span><strong>Choose an area</strong><small>Stay approximate and pick a starting point</small></button></div>',
      '<select class="area-select" data-neighbourhood aria-label="Choose a Gurugram neighbourhood">' + neighbourhoods.map((area) => '<option ' + (state.neighbourhood === area ? "selected" : "") + '>' + area + '</option>').join("") + '</select>',
      '<div class="form-footer"><button class="secondary-button" type="button" data-back>Back</button><button class="primary-button" type="button" data-finish>Show my Gurugram <span>↗</span></button></div>'
    ].join("");
  }

  function categoryForMotives() {
    const match = state.motives.find((item) => Object.prototype.hasOwnProperty.call(intentLabels, item));
    return match || "all";
  }
  function distanceFor(place) {
    if (state.locationMode !== "current") return place.distance;
    return Math.max(.3, place.distance + ((state.coords.lat - 28.4945) * 16) + ((state.coords.lng - 77.0894) * 8));
  }
  function visiblePlaces() {
    const query = state.query.toLowerCase();
    return places.filter((place) => {
      const searchable = [place.name, place.area, place.categoryLabel].concat(place.tags).join(" ").toLowerCase();
      const queryMatch = !query || searchable.includes(query) || (query.includes("free") && place.priceValue === 0) || (query.includes("quiet") && place.tags.includes("Quiet")) || (query.includes("work") && ["work", "food"].includes(place.category));
      const categoryMatch = matchesCategory(place);
      const priceMatch = state.price === "all" || (state.price === "free" && place.priceValue === 0) || (state.price === "under300" && place.priceValue <= 300) || (state.price === "under700" && place.priceValue <= 700);
      const tagMatch = state.tags.length === 0 || state.tags.every((tag) => place.tags.includes(tag));
      const areaMatch = state.areaFilter === "all" || place.area === state.areaFilter;
      return queryMatch && categoryMatch && priceMatch && tagMatch && areaMatch && (!state.savedOnly || state.saved.has(place.id));
    }).sort((a, b) => distanceFor(a) - distanceFor(b));
  }
  function matchesCategory(place) {
    const category = state.activeCategory;
    if (category === "all") return true;
    if (category === "food") return place.category === "food";
    if (category === "work") return place.category === "work";
    if (category === "coffee") return place.category === "food" && (/coffee|café|cafe/i.test(place.name) || place.tags.includes("Wi-Fi") || place.tags.includes("Laptop-friendly"));
    if (category === "bars") return place.category === "events" && (place.tags.includes("Open late") || place.tags.includes("Live music") || /social/i.test(place.name));
    if (category === "grocery") return place.category === "services" && (place.tags.includes("Everyday") || /bazaar|market/i.test(place.name));
    if (category === "gym") return place.category === "public" && (place.tags.includes("Outdoor") || place.tags.includes("Walking"));
    return place.category === category;
  }
  function renderIntentFilters() {
    $("[data-intent-filters]").innerHTML = Object.entries(intentLabels).map(([id, item]) => '<button class="intent-chip ' + (state.activeCategory === id ? "is-active" : "") + '" type="button" data-category="' + id + '"><span>' + item[1] + '</span>' + item[0] + '</button>').join("");
  }
  function renderMapCategoryRail() {
    const rail = $("[data-map-category-rail]");
    if (!rail) return;
    rail.innerHTML = '<p class="map-category-rail__title">Explore by</p>' + mapCategories.map((category) => '<button class="map-category-item ' + (state.mapCategory === category.id ? "is-active" : "") + '" type="button" data-map-category="' + category.id + '" data-map-filter="' + category.filter + '"><span class="map-category-item__swatch" style="--category-color:' + category.color + '"></span><span>' + category.label + '</span></button>').join("");
  }
  function renderNearYou() {
    const grid = $("[data-area-grid]");
    if (!grid) return;
    $("[data-near-you-location]").textContent = state.neighbourhood;
    grid.innerHTML = nearYouAreas.map((item, index) => {
      const areaPlaces = places.filter((place) => place.area === item.area);
      const names = areaPlaces.slice(0, 2).map((place) => place.name).join(" · ");
      return '<button class="area-card ' + (state.areaFilter === item.area ? "is-active" : "") + '" type="button" data-area-filter="' + item.area + '"><span class="area-card__top"><span class="area-card__number">' + String(index + 1).padStart(2, "0") + '</span><span class="area-card__arrow">↗</span></span><span><strong>' + item.area + '</strong><small>' + item.note + '</small></span><span class="area-card__places">' + (areaPlaces.length ? names : "New places coming soon") + '</span></button>';
    }).join("");
  }
  function renderCard(place) {
    const saved = state.saved.has(place.id);
    return '<article class="place-card" data-place-id="' + place.id + '"><div class="place-card__cover" style="--cover:' + place.accent + '"><span class="cover-word">' + place.cover.replace("\n", "<br>") + '</span><span class="cover-glyph">' + place.glyph + '</span><span class="status-badge">' + place.visit + '</span><button class="place-card__save ' + (saved ? "is-saved" : "") + '" type="button" data-save="' + place.id + '" aria-label="' + (saved ? "Remove" : "Save") + " " + place.name + '" aria-pressed="' + saved + '">' + (saved ? "♥" : "♡") + '</button></div><button class="place-card__body" type="button" data-open-place="' + place.id + '"><div class="place-card__head"><div><h3>' + place.name + '</h3><p class="place-card__area">' + place.area + " · " + distanceFor(place).toFixed(1) + ' km away</p></div><span class="price-tag ' + (place.priceValue === 0 ? "is-free" : "") + '">' + place.price + '</span></div><div class="place-card__tags">' + place.tags.slice(0, 3).map((tag) => "<span>" + tag + "</span>").join("") + '</div><div class="place-card__details"><span class="place-card__distance">' + place.categoryLabel + '</span><span class="place-card__open">' + place.open + '</span></div><div class="verified-line"><i></i> Last checked ' + place.verified + " · " + place.source + "</div></button></article>";
  }
  function renderMapPins(items) {
    if (liveMap) { renderMapMarkers(items); return; }
    const root = $("[data-map-pins]");
    if (!root) return;
    root.innerHTML = items.map((place) => '<button class="map-pin" style="left:' + place.mapX + "%;top:" + place.mapY + '%" type="button" data-open-place="' + place.id + '" aria-label="Open ' + place.name + '"><span>' + place.glyph + "</span></button>").join("");
  }
  function renderMapMarkers(items) {
    if (!liveMap) return;
    mapMarkers.forEach((marker) => marker.remove());
    mapMarkers = items.filter((place) => place.lat && place.lng).map((place) => {
      const element = document.createElement("button");
      element.className = "premium-map-pin premium-map-pin--" + place.category;
      element.type = "button";
      element.innerHTML = "<span>" + place.glyph + "</span>";
      element.setAttribute("aria-label", "Open " + place.name);
      const popup = new maplibregl.Popup({offset: 18, closeButton: true}).setHTML('<div class="map-popup"><strong>' + place.name + '</strong><span>' + place.area + " · " + place.price + '</span><small>' + place.visit + '</small></div>');
      const marker = new maplibregl.Marker({element: element, anchor: "bottom"}).setLngLat([place.lng, place.lat]).setPopup(popup).addTo(liveMap);
      element.addEventListener("dblclick", () => openPlace(place.id));
      return marker;
    });
  }
  function renderUserLocation() {
    if (!liveMap || state.locationMode !== "current") return;
    if (userMarker) userMarker.remove();
    const element = document.createElement("div");
    element.className = "live-user-marker";
    element.setAttribute("aria-label", "Your approximate location");
    userMarker = new maplibregl.Marker({element: element, anchor: "center"}).setLngLat([state.coords.lng, state.coords.lat]).addTo(liveMap);
  }
  function initMap() {
    const container = $("#real-map"), fallback = $("[data-map-fallback]");
    if (!container) return;
    if (!window.maplibregl) {
      container.hidden = true;
      if (fallback) fallback.hidden = false;
      return;
    }
    const center = state.locationMode === "current" ? [state.coords.lng, state.coords.lat] : [77.0894, 28.4952];
    const zoom = state.locationMode === "current" ? 14.2 : 11.7;
    liveMap = new maplibregl.Map({container: container, style: "https://tiles.openfreemap.org/styles/liberty", center: center, zoom: zoom, attributionControl: true});
    liveMap.addControl(new maplibregl.NavigationControl({showCompass: false}), "top-right");
    liveMap.addControl(new maplibregl.GeolocateControl({positionOptions: {enableHighAccuracy: false}, trackUserLocation: false, showUserLocation: true}), "top-right");
    liveMap.on("load", () => { renderMapMarkers(visiblePlaces()); renderUserLocation(); liveMap.resize(); });
  }
  function focusMap(place) {
    if (!liveMap || !place.lat || !place.lng) return;
    $("[data-place-list]").hidden = true;
    $("[data-map-panel]").hidden = false;
    $$('[data-view]').forEach((button) => button.classList.toggle("is-active", button.dataset.view === "map"));
    window.setTimeout(() => { liveMap.resize(); liveMap.flyTo({center: [place.lng, place.lat], zoom: 15, essential: true}); }, 0);
  }
  function renderActiveFilters() {
    const root = $("[data-active-filters]"), filters = [];
    if (state.savedOnly) filters.push(["Saved places", () => { state.savedOnly = false; renderApp(); }]);
    if (state.price !== "all") filters.push([state.price === "free" ? "Free" : state.price === "under300" ? "Under ₹300" : "Under ₹700", () => { state.price = "all"; renderApp(); }]);
    state.tags.forEach((tag) => filters.push([tag, () => { state.tags = state.tags.filter((item) => item !== tag); renderApp(); }]));
    root.hidden = filters.length === 0;
    root.innerHTML = filters.map(([label], index) => '<span class="active-filter">' + label + '<button type="button" data-remove-active="' + index + '" aria-label="Remove ' + label + '">×</button></span>').join("");
    root.querySelectorAll("[data-remove-active]").forEach((button, index) => button.addEventListener("click", () => filters[index][1]()));
  }
  function renderApp() {
    renderIntentFilters();
    renderMapCategoryRail();
    renderNearYou();
    const items = visiblePlaces();
    const selectedMapCategory = mapCategories.find((category) => category.id === state.mapCategory);
    const categoryHeading = intentLabels[state.activeCategory] ? intentLabels[state.activeCategory][0] : (selectedMapCategory ? selectedMapCategory.label : "Made for your day");
    $$("[data-location-label]").forEach((node) => { node.textContent = state.neighbourhood; });
    $("[data-result-heading]").textContent = state.savedOnly ? "Your saved edit" : state.activeCategory === "all" ? "Made for your day" : categoryHeading;
    $("[data-result-count]").textContent = String(items.length);
    $("[data-place-list]").innerHTML = items.length ? items.map(renderCard).join("") : '<div class="empty-state"><strong>No verified ' + categoryHeading.toLowerCase() + ' listings yet.</strong><span>Try another category, or add a place for the Commons edit.</span></div>';
    renderMapPins(items); renderActiveFilters();
    const filterCount = (state.price === "all" ? 0 : 1) + state.tags.length;
    $("[data-filter-count]").hidden = filterCount === 0; $("[data-filter-count]").textContent = String(filterCount);
    $("[data-weather-temp]").textContent = state.weather.temp + "°"; $("[data-weather-label]").textContent = state.weather.label; $("[data-weather-icon]").textContent = state.weather.icon;
    $("[data-saved-count]").textContent = state.saved.size ? String(state.saved.size) : "";
  }
  function setSaved(id) {
    if (state.saved.has(id)) { state.saved.delete(id); announce("Removed from your saved places."); } else { state.saved.add(id); announce("Saved to your personal edit."); }
    localStorage.setItem("gc-saved", JSON.stringify(Array.from(state.saved))); renderApp();
  }
  function openPlace(id) {
    const place = places.find((item) => item.id === id); if (!place) return;
    focusMap(place);
    const drawer = $("[data-place-drawer]"), saved = state.saved.has(id);
    drawer.innerHTML = '<button class="drawer-close" type="button" data-close-drawer aria-label="Close details">×</button><div class="drawer-cover" style="background:' + place.accent + '"><h2>' + place.cover.replace("\n", "<br>") + '</h2></div><div class="drawer-meta"><div><h3 id="drawer-title">' + place.name + '</h3><p class="drawer-area">' + place.area + " · " + distanceFor(place).toFixed(1) + ' km from you</p></div><span class="drawer-price ' + (place.priceValue === 0 ? "is-free" : "") + '">' + place.price + '</span></div><p class="drawer-description">' + place.description + '</p><div class="detail-list"><div><span>Visit now</span><strong>' + place.visit + '</strong></div><div><span>Hours</span><strong>' + place.open + '</strong></div><div><span>Good for</span><strong>' + place.tags[0] + " · " + place.tags[1] + '</strong></div><div><span>Price basis</span><strong>' + place.priceType + '</strong></div></div><div class="place-card__tags">' + place.tags.map((tag) => "<span>" + tag + "</span>").join("") + '</div><div class="drawer-actions"><button class="outline-button" type="button" data-save-drawer="' + place.id + '">' + (saved ? "♥ Saved" : "♡ Save place") + '</button><a class="primary-button" href="https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(place.name + ", " + place.area + ", Gurugram") + '" target="_blank" rel="noreferrer">Directions <span>↗</span></a></div><p class="drawer-source">Information status: <strong>Editorial sample</strong>. Production records will show a direct <a href="#" data-source-link>source link</a> and verification history.</p>';
    $("[data-modal-backdrop]").hidden = false; document.body.classList.add("is-locked"); drawer.focus();
  }
  function closeModal(selector) {
    const modal = $(selector); if (modal) modal.hidden = true;
    if (!$$(".modal-backdrop:not([hidden])").length) document.body.classList.remove("is-locked");
  }
  function getNearestNeighbourhood(coords) {
    if (coords.lat > 28.52) return "Old Gurgaon";
    if (coords.lng < 77.06) return "Golf Course Road";
    if (coords.lng > 77.11) return "Udyog Vihar";
    if (coords.lat < 28.46) return "Sector 52";
    if (coords.lng > 77.095) return "MG Road";
    return "Cyber City";
  }
  function requestLocation() {
    if (!navigator.geolocation) { announce("Location is not available here. Showing Cyber City instead."); return; }
    announce("Requesting your approximate location…");
    navigator.geolocation.getCurrentPosition((position) => {
      state.locationMode = "current"; state.coords = {lat: position.coords.latitude, lng: position.coords.longitude}; state.neighbourhood = getNearestNeighbourhood(state.coords);
      announce("Showing places near " + state.neighbourhood + "."); renderApp(); updateWeather();
      if (liveMap) { renderUserLocation(); liveMap.flyTo({center: [state.coords.lng, state.coords.lat], zoom: 14.2, essential: true}); }
    }, () => announce("We couldn’t access your location. Showing Cyber City instead."), {enableHighAccuracy:false, timeout:7000, maximumAge:300000});
  }
  async function updateWeather() {
    try {
      const response = await fetch("https://api.open-meteo.com/v1/forecast?latitude=" + state.coords.lat + "&longitude=" + state.coords.lng + "&current=temperature_2m,weather_code&timezone=auto");
      if (!response.ok) throw new Error("Weather request failed");
      const data = await response.json(), code = data.current && data.current.weather_code || 0;
      const weather = code === 0 ? ["☼", "Clear skies · Good to be out"] : code < 70 ? ["☁", "A softer day · Good for a café"] : ["☂", "Rain nearby · Try an indoor spot"];
      state.weather = {temp:Math.round(data.current && data.current.temperature_2m || 29), icon:weather[0], label:weather[1]}; renderApp(); $("[data-weather-updated]").textContent = "Live weather";
    } catch (error) { $("[data-weather-updated]").textContent = "Typical conditions"; }
  }
  function openFilterModal() {
    const modal = $("[data-filter-modal]");
    $("[data-price-options]").innerHTML = [["all","Any price"],["free","Free"],["under300","Under ₹300"],["under700","Under ₹700"]].map((item) => '<button class="filter-option ' + (state.price === item[0] ? "is-selected" : "") + '" type="button" data-price="' + item[0] + '">' + item[1] + "</button>").join("");
    const tags = ["Near metro","Quiet","Free","Outdoor","Wi-Fi","Open late"];
    $("[data-tag-options]").innerHTML = tags.map((tag) => '<button class="filter-option ' + (state.tags.includes(tag) ? "is-selected" : "") + '" type="button" data-filter-tag="' + tag + '">' + tag + "</button>").join("");
    modal.hidden = false; document.body.classList.add("is-locked");
  }
  function startApp() {
    state.activeCategory = categoryForMotives();
    state.mapCategory = mapCategories.some((category) => category.id === state.activeCategory) ? state.activeCategory : "all";
    onboarding.hidden = true; app.hidden = false; document.title = "Gurugram Commons — your city, carefully curated";
    setMainView("explore");
    renderApp(); initMap(); updateWeather(); window.scrollTo({top:0, behavior:"instant"});
  }
  function setMainView(view) {
    const nearMode = view === "near";
    $$("[data-explore-view]").forEach((section) => { section.hidden = nearMode; });
    const nearView = $("[data-near-you-view]");
    if (nearView) nearView.hidden = !nearMode;
    $$("[data-explore-link], [data-near-you-link]").forEach((link) => link.classList.toggle("is-active", nearMode ? link.hasAttribute("data-near-you-link") : link.hasAttribute("data-explore-link")));
    window.scrollTo({top:0, behavior:"smooth"});
  }
  function bindEvents() {
    onboarding.addEventListener("click", (event) => {
      const motive = event.target.closest("[data-motive]");
      if (motive) { const id = motive.dataset.motive; state.motives = state.motives.includes(id) ? state.motives.filter((item) => item !== id) : state.motives.concat(id); if (!state.motives.length) state.motives = ["explore"]; renderOnboarding(); return; }
      const role = event.target.closest("[data-role]");
      if (role) { state.role = role.dataset.role; renderOnboarding(); return; }
      if (event.target.closest("[data-next]")) { state.onboardingStep = Math.min(3, state.onboardingStep + 1); renderOnboarding(); return; }
      if (event.target.closest("[data-back]")) { state.onboardingStep = Math.max(1, state.onboardingStep - 1); renderOnboarding(); return; }
      const locationChoice = event.target.closest("[data-location-choice]");
      if (locationChoice) { state.locationMode = locationChoice.dataset.locationChoice; renderOnboarding(); if (state.locationMode === "current") requestLocation(); return; }
      if (event.target.closest("[data-finish]")) { const area = $("[data-neighbourhood]"); if (area && state.locationMode === "area") state.neighbourhood = area.value; startApp(); return; }
      if (event.target.closest("[data-skip]")) startApp();
    });
    document.addEventListener("click", (event) => {
      const nearLink = event.target.closest("[data-near-you-link]");
      if (nearLink) { event.preventDefault(); setMainView("near"); return; }
      const exploreLink = event.target.closest("[data-explore-link]");
      if (exploreLink) { event.preventDefault(); setMainView("explore"); return; }
      const areaCard = event.target.closest("[data-area-filter]");
      if (areaCard) {
        state.areaFilter = areaCard.dataset.areaFilter;
        state.neighbourhood = state.areaFilter;
        state.locationMode = "area";
        state.activeCategory = "all";
        state.mapCategory = "all";
        state.savedOnly = false;
        setMainView("explore");
        renderApp();
        $("#explore").scrollIntoView({behavior:"smooth", block:"start"});
        if (liveMap) {
          const focusPlace = places.find((place) => place.area === state.areaFilter);
          if (focusPlace && focusPlace.lng && focusPlace.lat) liveMap.flyTo({center:[focusPlace.lng, focusPlace.lat], zoom:13.5, essential:true});
        }
        return;
      }
      if (event.target.closest("[data-reset-area]")) { state.areaFilter = "all"; state.activeCategory = "all"; state.mapCategory = "all"; renderApp(); return; }
      const mapCategory = event.target.closest("[data-map-category]");
      if (mapCategory) { state.mapCategory = mapCategory.dataset.mapCategory; state.activeCategory = mapCategory.dataset.mapCategory; state.savedOnly = false; renderApp(); return; }
      const category = event.target.closest("[data-category]"); if (category) { state.activeCategory = category.dataset.category; state.mapCategory = mapCategories.some((item) => item.id === category.dataset.category) ? category.dataset.category : "all"; state.savedOnly = false; renderApp(); return; }
      const save = event.target.closest("[data-save]"); if (save) { event.stopPropagation(); setSaved(save.dataset.save); return; }
      const open = event.target.closest("[data-open-place]"); if (open) { openPlace(open.dataset.openPlace); return; }
      const saveDrawer = event.target.closest("[data-save-drawer]"); if (saveDrawer) { setSaved(saveDrawer.dataset.saveDrawer); openPlace(saveDrawer.dataset.saveDrawer); return; }
      if (event.target.closest("[data-close-drawer]") || event.target === $("[data-modal-backdrop]")) { closeModal("[data-modal-backdrop]"); return; }
      if (event.target.closest("[data-filter-button]")) { openFilterModal(); return; }
      if (event.target.closest("[data-close-filter]") || event.target === $("[data-filter-modal]")) { closeModal("[data-filter-modal]"); return; }
      if (event.target.closest("[data-add-place]")) { $("[data-add-modal]").hidden = false; document.body.classList.add("is-locked"); return; }
      if (event.target.closest("[data-close-add]") || event.target === $("[data-add-modal]")) { closeModal("[data-add-modal]"); return; }
      const view = event.target.closest("[data-view]");
      if (view) { $$('[data-view]').forEach((button) => button.classList.toggle("is-active", button === view)); $("[data-place-list]").hidden = view.dataset.view !== "list"; $("[data-map-panel]").hidden = view.dataset.view !== "map"; if (view.dataset.view === "map" && liveMap) window.setTimeout(() => liveMap.resize(), 0); return; }
      if (event.target.closest("[data-saved-button]")) { if (!state.saved.size) { announce("Save a place to build your personal edit."); return; } state.savedOnly = true; state.activeCategory = "all"; state.mapCategory = "all"; renderApp(); return; }
      if (event.target.closest("[data-location-button]")) { requestLocation(); return; }
      if (event.target.closest("[data-profile-button]")) { announce("Your preferences are stored for this demo. Profile editing is coming next."); return; }
      const price = event.target.closest("[data-price]");
      if (price) { $$("[data-price]").forEach((button) => button.classList.remove("is-selected")); price.classList.add("is-selected"); state.price = price.dataset.price; return; }
      const filterTag = event.target.closest("[data-filter-tag]");
      if (filterTag) { filterTag.classList.toggle("is-selected"); state.tags = filterTag.classList.contains("is-selected") ? state.tags.concat(filterTag.dataset.filterTag) : state.tags.filter((tag) => tag !== filterTag.dataset.filterTag); return; }
      if (event.target.closest("[data-clear-filters]")) { state.price = "all"; state.tags = []; closeModal("[data-filter-modal]"); renderApp(); return; }
      if (event.target.closest("[data-apply-filters]")) { closeModal("[data-filter-modal]"); renderApp(); }
    });
    const search = $("#place-search"); if (search) search.addEventListener("input", (event) => { state.query = event.target.value.trim(); renderApp(); });
    const addForm = $("[data-add-form]"); if (addForm) addForm.addEventListener("submit", (event) => { event.preventDefault(); closeModal("[data-add-modal]"); event.target.reset(); announce("Thanks — your place has been sent to the Commons edit."); });
    document.addEventListener("keydown", (event) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); $("#place-search")?.focus(); } if (event.key === "Escape") { closeModal("[data-modal-backdrop]"); closeModal("[data-filter-modal]"); closeModal("[data-add-modal]"); } });
  }
  renderOnboarding(); bindEvents();
})();
