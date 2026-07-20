import fs from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcesPath = path.join(root, "data", "event-sources.json");
const outputPath = path.join(root, "data", "events.json");
const now = new Date();
const techTerms = /ai|artificial intelligence|api|automation|blockchain|cloud|coding|crypto|cyber|data|developer|devops|founder|hack|javascript|machine learning|no[- ]?code|open source|product|programming|saas|startup|technology|tech|web3|workshop/i;
const genericCityTerms = /gurugram|gurgaon|cyber city|udyog vihar|mg road|sector 29|delhi[- ]?ncr/i;

const sources = JSON.parse(await fs.readFile(sourcesPath, "utf8"));

function text(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number") return String(value).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(", ");
  if (typeof value === "object") return text(value.name || value.address || value.streetAddress || value.locality || value.text || "");
  return "";
}

function first(...values) {
  return values.find((value) => text(value)) || "";
}

function parseJsonLd(html) {
  const objects = [];
  const scripts = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
  for (const script of scripts) {
    const raw = script.replace(/^.*?>/s, "").replace(/<\/script>.*$/is, "").trim();
    try { objects.push(JSON.parse(raw)); } catch { /* Some pages include invalid tracking JSON. */ }
  }
  return objects;
}

function collectEvents(value, output = []) {
  if (!value) return output;
  if (Array.isArray(value)) { value.forEach((item) => collectEvents(item, output)); return output; }
  if (typeof value !== "object") return output;
  const type = Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]];
  if (type.some((item) => String(item).toLowerCase() === "event") || (value.name && (value.startDate || value.start_time || value.startTime))) output.push(value);
  Object.values(value).forEach((item) => { if (item && typeof item === "object") collectEvents(item, output); });
  return output;
}

function extractMeta(html, property) {
  const matcher = new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']*)["'][^>]*>`, "i");
  return html.match(matcher)?.[1] || "";
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

function normalizeEvent(raw, source) {
  const location = normalizeLocation(raw);
  const title = first(raw.name, raw.title, raw.event_name);
  const description = first(raw.description, raw.summary, raw.about);
  const start = first(raw.startDate, raw.start_date, raw.start_time, raw.startTime, raw.start_at, raw.startAt, raw.datetime);
  const startDate = new Date(start);
  if (!title || !start || Number.isNaN(startDate.getTime()) || startDate < now) return null;
  const sourceUrl = first(raw.url, raw.event_url, raw.registration_url, raw.website, source.url);
  if (!sourceUrl) return null;
  const searchable = [title, description, location.cityText, raw.category, raw.tags].map(text).join(" ");
  const cityKeywords = source.cityKeywords?.length ? new RegExp(source.cityKeywords.map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "i") : genericCityTerms;
  if (!cityKeywords.test(location.cityText) && location.cityText) return null;
  if (source.techOnly !== false && !techTerms.test(searchable)) return null;
  const price = first(raw.price, raw.ticket_price, raw.ticketPrice, raw.offers?.price, raw.offers?.[0]?.price) || "See Luma";
  return {
    id: `luma-${Buffer.from(sourceUrl).toString("base64url").slice(0, 18)}`,
    title,
    description: description.slice(0, 240),
    start: startDate.toISOString(),
    end: first(raw.endDate, raw.end_date, raw.end_time, raw.endTime, raw.end_at, raw.endAt) || null,
    location: location.label,
    city: location.cityText || "Gurugram",
    lat: location.lat,
    lng: location.lng,
    price: text(price),
    url: sourceUrl,
    source: "Luma",
    sourceName: source.name,
    verifiedAt: now.toISOString()
  };
}

async function scrapeSource(source) {
  if (source.enabled === false) return [];
  const response = await fetch(source.url, {headers: {"user-agent": "BudgetGurugram event indexer/1.0 (+public source attribution)"}});
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const html = await response.text();
  const candidates = parseJsonLd(html).flatMap((item) => collectEvents(item));
  if (!candidates.length) {
    const title = extractMeta(html, "og:title");
    const canonical = extractMeta(html, "og:url") || source.url;
    if (title) candidates.push({name: title, url: canonical, startDate: extractMeta(html, "event:start_time"), description: extractMeta(html, "og:description")});
  }
  return candidates.map((event) => normalizeEvent(event, source)).filter(Boolean);
}

const allEvents = [];
for (const source of sources) {
  try {
    allEvents.push(...await scrapeSource(source));
    console.log(`Synced ${source.name}`);
  } catch (error) {
    console.warn(`Skipped ${source.name}: ${error.message}`);
  }
}

const deduped = Array.from(new Map(allEvents.map((event) => [`${event.url}|${event.start}`, event])).values())
  .sort((a, b) => new Date(a.start) - new Date(b.start));
const payload = {generatedAt: now.toISOString(), sourceCount: sources.filter((source) => source.enabled !== false).length, eventCount: deduped.length, events: deduped};
await fs.writeFile(outputPath, JSON.stringify(payload, null, 2) + "\n");
console.log(`Wrote ${deduped.length} events to ${path.relative(root, outputPath)}`);
