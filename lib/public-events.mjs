const TECH_TERMS = /ai|artificial intelligence|api|automation|blockchain|cloud|coding|crypto|cyber|data|developer|devops|founder|hack|javascript|machine learning|no[- ]?code|open source|product|programming|saas|startup|technology|tech|web3|workshop/i;
const GENERIC_CITY_TERMS = /gurugram|gurgaon|cyber city|udyog vihar|mg road|sector 29|delhi[- ]?ncr/i;
const SKIPPED_SLUGS = /^(pricing|login|signup|signin|create|calendar|communitymeetups)$/i;

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
  return Array.from(urls).slice(0, 60);
}

function extractNumber(...values) {
  const value = values.find((item) => item !== null && item !== undefined && item !== "");
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeLocation(raw) {
  const location = raw.location || raw.venue || raw.geo_address_info || {};
  const address = location.address || location.addressInfo || {};
  const label = first(location.name, location.address, location.full_address, location.formatted_address, address.streetAddress, address.addressLocality, raw.location_name, raw.venue_name);
  return {
    label: label || "Location listed on Luma",
    cityText: [label, address.addressLocality, address.addressRegion, raw.city, raw.address].map(text).filter(Boolean).join(" "),
    lat: extractNumber(location.latitude, location.lat, address.latitude, raw.latitude, raw.lat),
    lng: extractNumber(location.longitude, location.lng, location.lon, address.longitude, raw.longitude, raw.lng)
  };
}

function normalizeEvent(raw, source, pageUrl, now, maxDate) {
  const location = normalizeLocation(raw);
  const title = first(raw.name, raw.title, raw.event_name);
  const description = first(raw.description, raw.summary, raw.about);
  const start = first(raw.startDate, raw.start_date, raw.start_time, raw.startTime, raw.start_at, raw.startAt, raw.datetime);
  const startDate = new Date(start);
  if (!title || !start || Number.isNaN(startDate.getTime()) || startDate < now || startDate > maxDate) return null;
  const eventUrl = canonicalLumaUrl(first(raw.url, raw.event_url, raw.registration_url, raw.website, pageUrl), pageUrl);
  if (!eventUrl) return null;
  const searchable = [title, description, location.cityText, raw.category, raw.tags].map(text).join(" ");
  const cityKeywords = source.cityKeywords?.length ? new RegExp(source.cityKeywords.map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "i") : GENERIC_CITY_TERMS;
  if (!cityKeywords.test(location.cityText) && location.cityText) return null;
  if (source.techOnly !== false && !TECH_TERMS.test(searchable)) return null;
  const price = first(raw.price, raw.ticket_price, raw.ticketPrice, raw.offers?.price, raw.offers?.[0]?.price) || "See Luma";
  return {
    id: `luma-${Buffer.from(eventUrl).toString("base64url").slice(0, 18)}`,
    title,
    description: description.slice(0, 240),
    start: startDate.toISOString(),
    end: first(raw.endDate, raw.end_date, raw.end_time, raw.endTime, raw.end_at, raw.endAt) || null,
    location: location.label,
    city: location.cityText || "Gurugram",
    lat: location.lat,
    lng: location.lng,
    price: text(price),
    url: eventUrl,
    source: "Luma",
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
  const calendarHtml = await fetchPage(source.url);
  const urls = findEventUrls(calendarHtml, source.url);
  const candidates = [];
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
  const events = Array.from(new Map(allEvents.map((event) => [`${event.url}|${event.start}`, event])).values()).sort((a, b) => new Date(a.start) - new Date(b.start));
  return {generatedAt:now.toISOString(), sourceCount:sources.filter((source) => source.enabled !== false).length, eventCount:events.length, nextWindowDays:options.days || 31, live:true, errors, events};
}
