const TECH_TERMS = /ai|artificial intelligence|api|automation|blockchain|cloud|coding|crypto|cyber|data|developer|devops|founder|hack|javascript|machine learning|no[- ]?code|open source|product|programming|saas|startup|technology|tech|web3|workshop|fitness|yoga|run|running|pickle|gym|wellness|health|sports|sunrise/i;
const GURUGRAM_TERMS = /gurugram|gurgaon|\bggn\b|cyber ?city|cyber ?hub|udyog vihar|mg road|golf course|sohna road|sector 29|dlf phase|huda city|leisure valley|old gurgaon/i;
const FOREIGN_TERMS = /seoul|taipei|tel aviv|hawaii|melbourne|manila|jakarta|singapore|bangkok|tokyo|osaka|london|paris|berlin|amsterdam|chicago|san francisco|new york|los angeles|austin|boston|seattle|toronto|vancouver|sydney|dubai|abu dhabi|nairobi|lagos|accra|cape town|jaipur|chennai|mumbai|bangalore|bengaluru|hyderabad|pune|kolkata|ahmedabad|chandigarh|lucknow|indore|kochi|goa|thailand|australia|philippines|indonesia|korea|taiwan|israel|hawaii/i;
const OTHER_INDIA_CITIES = /\b(delhi|new delhi|noida|faridabad|ghaziabad|greater noida)\b/i;
const SKIPPED_SLUGS = /^(pricing|login|signup|signin|create|calendar|communitymeetups|discover|startup)$/i;
const PLACEHOLDER_LOCATION = /^location listed/i;

const GURUGRAM_BOUNDS = {minLat: 28.35, maxLat: 28.56, minLng: 76.92, maxLng: 77.16};

export function eventSearchText(event) {
  const location = isPlaceholderLocation(event.location) ? "" : event.location;
  const stampedCity = /^gurugram$/i.test(text(event.city)) && !location;
  return [event.title, event.description, event.aiSummary, location, stampedCity ? "" : event.city, event.cityText].map(text).join(" ");
}

export function isPlaceholderLocation(value) {
  return !text(value) || PLACEHOLDER_LOCATION.test(text(value));
}

export function isInGurugramBounds(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng)
    && lat >= GURUGRAM_BOUNDS.minLat && lat <= GURUGRAM_BOUNDS.maxLat
    && lng >= GURUGRAM_BOUNDS.minLng && lng <= GURUGRAM_BOUNDS.maxLng;
}

export function isGurugramEvent(event) {
  const city = text(event.city);
  if (/gurugram|gurgaon/i.test(city)) return true;
  if (isInGurugramBounds(event.lat, event.lng) && !isPlaceholderLocation(event.location) && event.geocoded !== "city-default") return true;
  const searchable = eventSearchText(event);
  if (!searchable) return false;
  if (FOREIGN_TERMS.test(searchable) && !GURUGRAM_TERMS.test(searchable)) return false;
  if (OTHER_INDIA_CITIES.test(searchable) && !GURUGRAM_TERMS.test(searchable)) return false;
  return GURUGRAM_TERMS.test(searchable);
}

function text(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number") return String(value).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(", ");
  if (typeof value === "object") return text(value.name || value.address || value.streetAddress || value.locality || value.text || "");
  return "";
}

function first(...values) { return values.find((value) => text(value)) || ""; }

function parseJsonScripts(html) {
  const objects = [];
  const scripts = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
  for (const script of scripts) {
    const raw = script.replace(/^.*?>/s, "").replace(/<\/script>.*$/is, "").trim();
    try { objects.push(JSON.parse(raw)); } catch { /* Ignore invalid tracking JSON. */ }
  }
  const nextData = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
  if (nextData) { try { objects.push(JSON.parse(nextData)); } catch { /* Ignore incomplete page state. */ } }
  return objects;
}

function collectEvents(value, output = []) {
  if (!value) return output;
  if (Array.isArray(value)) { value.forEach((item) => collectEvents(item, output)); return output; }
  if (typeof value !== "object") return output;
  const type = Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]];
  if (type.some((item) => String(item).toLowerCase() === "event") || (value.name && (value.startDate || value.start_time || value.startTime || value.start_at))) output.push(value);
  Object.values(value).forEach((item) => { if (item && typeof item === "object") collectEvents(item, output); });
  return output;
}

function extractMeta(html, property) {
  const forward = new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']*)["'][^>]*>`, "i");
  const reverse = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${property}["'][^>]*>`, "i");
  return html.match(forward)?.[1] || html.match(reverse)?.[1] || "";
}

function absoluteUrl(value, baseUrl) {
  try { return new URL(value, baseUrl).href; } catch { return ""; }
}

function canonicalLumaUrl(value, baseUrl) {
  const resolved = absoluteUrl(value, baseUrl);
  try {
    const parsed = new URL(resolved);
    if (!/(^|\.)luma\.com$/i.test(parsed.hostname)) return resolved;
    const slug = parsed.pathname.replace(/^\//, "").split("/")[0];
    return slug ? `https://lu.ma/${slug}` : resolved;
  } catch { return resolved; }
}

function findEventUrls(html, sourceUrl) {
  const urls = new Set();
  const add = (value) => {
    const url = absoluteUrl(value, sourceUrl);
    if (!url || !/^https?:\/\/(?:lu\.ma|luma\.com)\//i.test(url)) return;
    const slug = new URL(url).pathname.replace(/^\//, "").split("/")[0];
    if (!slug || SKIPPED_SLUGS.test(slug)) return;
    urls.add(`https://lu.ma/${slug}`);
  };
  const hrefs = html.matchAll(/(?:href|content)=["']([^"']+)["']/gi);
  for (const match of hrefs) add(match[1]);
  const plainLinks = html.matchAll(/https?:\/\/lu\.ma\/[a-zA-Z0-9_-]+/gi);
  for (const match of plainLinks) add(match[0]);
  if (/^https?:\/\/(?:lu\.ma|luma\.com)\//i.test(sourceUrl)) add(sourceUrl);
  return Array.from(urls).slice(0, 80);
}

function lumaEventUrl(event) {
  const slug = text(event.url).replace(/^https?:\/\/(?:lu\.ma|luma\.com)\//i, "").split("/")[0]
    || text(event.api_id).replace(/^evt-/, "");
  return slug ? `https://lu.ma/${slug}` : "";
}

function lumaApiToRaw(event) {
  return {
    name: event.name,
    title: event.name,
    description: event.description,
    startDate: event.start_at || event.start_at_iso,
    endDate: event.end_at || event.end_at_iso,
    url: lumaEventUrl(event),
    geo_address_info: event.geo_address_info,
    location: event.geo_address_info,
    city: event.geo_address_info?.city
  };
}

async function scrapeLumaDiscover(source, now, maxDate) {
  const queries = source.queries?.length ? source.queries : ["gurugram", "gurgaon"];
  const candidates = [];
  for (const query of queries) {
    const url = new URL("https://api.lu.ma/discover/get-paginated-events");
    url.searchParams.set("pagination_limit", "50");
    url.searchParams.set("query", query);
    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": "BudgetGurugram event indexer/1.0 (+public source attribution)"
      }
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const payload = await response.json();
    for (const entry of payload.entries || []) {
      const event = lumaApiToRaw(entry.event || entry);
      const normalized = normalizeEvent(event, source, event.url, now, maxDate);
      if (normalized) candidates.push(normalized);
    }
  }
  return candidates;
}

function extractNumber(...values) {
  const value = values.find((item) => item !== null && item !== undefined && item !== "");
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeLocation(raw, fallbackLabel = "Location listed on source") {
  const geo = raw.geo_address_info || raw.location?.geo_address_info || {};
  const location = raw.location || raw.venue || geo || {};
  const address = location.address || location.addressInfo || {};
  const city = first(geo.city, raw.city, address.addressLocality);
  const label = first(geo.full_address, location.name, location.address, location.full_address, location.formatted_address, address.streetAddress, city, raw.location_name, raw.venue_name);
  return {
    label: label || fallbackLabel,
    cityText: [city, label, address.addressLocality, address.addressRegion, raw.city, raw.address, geo.region].map(text).filter(Boolean).join(" "),
    city,
    lat: extractNumber(geo.latitude, location.latitude, location.lat, address.latitude, raw.latitude, raw.lat),
    lng: extractNumber(geo.longitude, location.longitude, location.lng, location.lon, address.longitude, raw.longitude, raw.lng)
  };
}

function normalizeEvent(raw, source, pageUrl, now, maxDate) {
  const sourceLabel = source.displayName || source.name || "source";
  const location = normalizeLocation(raw, "Location listed on " + sourceLabel);
  const title = first(raw.name, raw.title, raw.event_name);
  const description = first(raw.description, raw.summary, raw.about);
  const start = first(raw.startDate, raw.start_date, raw.start_time, raw.startTime, raw.start_at, raw.startAt, raw.datetime);
  const end = first(raw.endDate, raw.end_date, raw.end_time, raw.endTime, raw.end_at, raw.endAt);
  const startDate = new Date(start);
  const endDate = new Date(end);
  const hasFutureEnd = Number.isFinite(endDate.getTime()) && endDate > now;
  if (!title || !start || Number.isNaN(startDate.getTime()) || (startDate < now && !hasFutureEnd) || startDate > maxDate) return null;
  const eventUrl = canonicalLumaUrl(first(raw.url, raw.event_url, raw.registration_url, raw.website, pageUrl), pageUrl);
  if (!eventUrl) return null;
  const searchable = [title, description, location.label, location.cityText, raw.category, raw.tags].map(text).join(" ");
  if (source.techOnly !== false && !TECH_TERMS.test(searchable)) return null;
  if ((source.excludeKeywords || []).some((keyword) => searchable.toLowerCase().includes(String(keyword).toLowerCase()))) return null;
  const candidate = {
    title,
    description: description.slice(0, 240),
    location: isPlaceholderLocation(location.label) ? "" : location.label,
    city: location.city || location.cityText,
    lat: location.lat,
    lng: location.lng
  };
  if (!isGurugramEvent(candidate)) return null;
  const price = first(raw.price, raw.ticket_price, raw.ticketPrice, raw.offers?.price, raw.offers?.[0]?.price) || "See source";
  return {
    id: sourceLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + Buffer.from(eventUrl).toString("base64url").slice(0, 18),
    title,
    description: description.slice(0, 240),
    start: startDate.toISOString(),
    end: end || null,
    location: candidate.location || location.city || "Gurugram",
    city: location.city || (GURUGRAM_TERMS.test(location.cityText) ? location.cityText : "Gurugram"),
    lat: isInGurugramBounds(location.lat, location.lng) ? location.lat : null,
    lng: isInGurugramBounds(location.lat, location.lng) ? location.lng : null,
    price: text(price),
    url: eventUrl,
    source: sourceLabel,
    sourceName: source.name,
    verifiedAt: now.toISOString()
  };
}

async function fetchPage(url) {
  const response = await fetch(url, {headers: {"user-agent": "BudgetGurugram event indexer/1.0 (+public source attribution)"}});
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}

async function scrapeSource(source, now, maxDate) {
  if (source.enabled === false) return [];
  if (source.type === "lumaDiscover") return scrapeLumaDiscover(source, now, maxDate);
  const calendarHtml = await fetchPage(source.url);
  const calendarObjects = parseJsonScripts(calendarHtml);
  const candidates = calendarObjects.flatMap((item) => collectEvents(item)).map((event) => normalizeEvent(event, source, source.url, now, maxDate)).filter(Boolean);
  if (source.structuredOnly) return candidates;
  const urls = findEventUrls(calendarHtml, source.url);
  for (let index = 0; index < urls.length; index += 6) {
    const batch = await Promise.all(urls.slice(index, index + 6).map(async (url) => {
      try { return {url, html:await fetchPage(url)}; } catch { return null; }
    }));
    for (const page of batch.filter(Boolean)) {
      const jsonObjects = parseJsonScripts(page.html);
      const events = jsonObjects.flatMap((item) => collectEvents(item));
      if (events.length) candidates.push(...events.map((event) => normalizeEvent(event, source, page.url, now, maxDate)).filter(Boolean));
      else {
        const title = extractMeta(page.html, "og:title");
        const start = extractMeta(page.html, "event:start_time");
        if (title && start) candidates.push(normalizeEvent({name:title, startDate:start, description:extractMeta(page.html, "og:description"), url:page.url}, source, page.url, now, maxDate));
      }
    }
  }
  return candidates.filter(Boolean);
}

export async function syncPublicEvents(sources, options = {}) {
  const now = options.now || new Date();
  const maxDate = new Date(now.getTime() + (options.days || 31) * 86400000);
  const allEvents = [];
  const errors = [];
  for (const source of sources) {
    try { allEvents.push(...await scrapeSource(source, now, maxDate)); }
    catch (error) { errors.push(`${source.name}: ${error.message}`); }
  }
  const freshEvents = allEvents.filter((event) => {
    const end = new Date(event.end || event.start);
    return Number.isFinite(end.getTime()) && end > now;
  });
  const seen = new Set();
  const events = freshEvents.filter((event) => {
    const key = event.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() + "|" + event.start.slice(0, 16);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => new Date(a.start) - new Date(b.start));
  return {generatedAt:now.toISOString(), sourceCount:sources.filter((source) => source.enabled !== false).length, eventCount:events.length, nextWindowDays:options.days || 31, live:true, errors, events};
}
