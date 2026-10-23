const memoryCache = new Map();

const AREA_COORDS = {
  "cyber city": {lat: 28.4952, lng: 77.0894},
  "cyber hub": {lat: 28.4952, lng: 77.0894},
  "dlf phase": {lat: 28.4952, lng: 77.0894},
  "sector 29": {lat: 28.4672, lng: 77.0323},
  "sector 44": {lat: 28.4512, lng: 77.0721},
  "sector 52": {lat: 28.4298, lng: 77.0826},
  "mg road": {lat: 28.4593, lng: 77.0721},
  "golf course": {lat: 28.4425, lng: 77.0941},
  "udyog vihar": {lat: 28.5122, lng: 77.0472},
  "old gurgaon": {lat: 28.4605, lng: 77.0167},
  "sohna road": {lat: 28.4121, lng: 77.0612},
  "dwarka expressway": {lat: 28.4781, lng: 77.0412},
  "gurugram": {lat: 28.4595, lng: 77.0266},
  "gurgaon": {lat: 28.4595, lng: 77.0266},
  "delhi ncr": {lat: 28.6139, lng: 77.209},
  "new delhi": {lat: 28.6139, lng: 77.209},
  "connaught": {lat: 28.6315, lng: 77.2167},
  "noida": {lat: 28.5355, lng: 77.391}
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPlaceholder(value) {
  return !value || /^location listed/i.test(String(value).trim());
}

function areaFallback(location, city) {
  const haystack = `${isPlaceholder(location) ? "" : location || ""} ${city || ""}`.toLowerCase();
  for (const [keyword, coords] of Object.entries(AREA_COORDS)) {
    if (keyword === "delhi ncr" || keyword === "new delhi" || keyword === "connaught" || keyword === "noida") continue;
    if (haystack.includes(keyword)) {
      return {...coords, geocoded: "area-fallback", geocodeQuery: keyword};
    }
  }
  return null;
}

async function nominatimSearch(query) {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "in");

  const response = await fetch(url, {
    headers: {"user-agent": "BudgetGurugram/1.0 (event geocoding; +https://github.com/budgetgurugram)"}
  });
  if (!response.ok) return null;
  const results = await response.json();
  const hit = results[0];
  if (!hit) return null;
  const lat = Number(hit.lat);
  const lng = Number(hit.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {lat, lng, geocoded: "nominatim", geocodeQuery: query};
}

export async function geocodeEvent(event, options = {}) {
  if (Number.isFinite(event.lat) && Number.isFinite(event.lng)) {
    return {...event, geocoded: event.geocoded || "source"};
  }

  const cacheKey = `${event.location || ""}|${event.city || ""}`.toLowerCase().trim();
  if (memoryCache.has(cacheKey)) {
    const cached = memoryCache.get(cacheKey);
    if (!cached) return {...event, lat: null, lng: null, geocoded: "unlocated"};
    return {...event, lat: cached.lat, lng: cached.lng, geocoded: cached.geocoded, geocodeQuery: cached.geocodeQuery};
  }

  const fallback = areaFallback(event.location, event.city);
  if (fallback) memoryCache.set(cacheKey, fallback);

  if (options.skipNetwork) {
    return fallback ? {...event, ...fallback} : {...event, lat: null, lng: null, geocoded: "unlocated"};
  }

  const locationQuery = isPlaceholder(event.location) ? "" : event.location;
  const queries = [
    locationQuery ? `${locationQuery}, Gurugram, Haryana, India` : "",
    locationQuery ? `${locationQuery}, Gurgaon, India` : ""
  ].filter(Boolean);

  for (const query of queries.slice(0, 2)) {
    try {
      const result = await nominatimSearch(query);
      await sleep(options.delayMs || 1100);
      if (result && result.lat >= 28.35 && result.lat <= 28.56 && result.lng >= 76.92 && result.lng <= 77.16) {
        memoryCache.set(cacheKey, result);
        return {...event, lat: result.lat, lng: result.lng, geocoded: result.geocoded, geocodeQuery: result.geocodeQuery};
      }
    } catch {
      /* Try the next query or keep the event unmapped. */
    }
  }

  if (fallback) return {...event, ...fallback};
  memoryCache.set(cacheKey, null);
  return {...event, lat: null, lng: null, geocoded: "unlocated"};
}

export async function geocodeEvents(events, options = {}) {
  const limit = options.limit ?? 12;
  let networkCalls = 0;
  const enriched = [];

  for (const event of events) {
    if (Number.isFinite(event.lat) && Number.isFinite(event.lng)) {
      enriched.push({...event, geocoded: event.geocoded || "source"});
      continue;
    }
    const skipNetwork = networkCalls >= limit;
    const next = await geocodeEvent(event, {skipNetwork, delayMs: options.delayMs || 1100});
    if (!skipNetwork && next.geocoded === "nominatim") networkCalls += 1;
    enriched.push(next);
  }

  return enriched;
}
