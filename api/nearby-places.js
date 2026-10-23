const GEOAPIFY_PLACES_URL = "https://api.geoapify.com/v2/places";
const PLACE_CATEGORIES = [
  "catering.cafe",
  "catering.restaurant",
  "catering.fast_food",
  "catering.food_court",
  "catering.bakery",
  "office.coworking",
  "activity.hackerspace",
  "sport.fitness.gym",
  "sport.fitness"
].join(",");

function numberParam(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function categoryFor(categories) {
  const joined = (categories || []).join(" ").toLowerCase();
  if (/sport\.fitness|\.gym|fitness_centre|sports_centre/.test(joined)) return "gym";
  if (/office\.coworking|hackerspace|coworking/.test(joined)) return "work";
  if (/catering|cafe|restaurant|fast_food|bakery|food_court|coffee/.test(joined)) return "food";
  return null;
}

function categoryLabel(category) {
  return ({
    food: "Food & drink",
    work: "Workspaces",
    gym: "Gyms",
    public: "Public spaces",
    events: "Events",
    services: "Useful services",
    bars: "Bars",
    grocery: "Grocery"
  })[category] || "Local place";
}

function kindLabel(categories) {
  const match = (categories || []).find((item) => /catering\.|office\.|sport\.|activity\./.test(item));
  return match ? match.split(".").slice(-2).join(" ") : "Place";
}

function sourceUrl(props) {
  return text(props.website)
    || text(props.datasource?.url)
    || (props.place_id ? `https://www.geoapify.com/` : "");
}

function normalizeFeature(feature, fetchedAt) {
  const props = feature.properties || {};
  const coords = feature.geometry?.coordinates;
  const lng = Number(coords?.[0] ?? props.lon);
  const lat = Number(coords?.[1] ?? props.lat);
  const name = text(props.name);
  if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const category = categoryFor(props.categories);
  if (!category) return null;

  const openingHours = text(props.opening_hours);
  const kind = kindLabel(props.categories);
  const area = text(props.suburb || props.district || props.city || props.county) || "Near you";
  const address = text(props.formatted || props.address_line1);
  const link = sourceUrl(props);

  return {
    id: `geoapify-${text(props.place_id) || `${name}-${lat.toFixed(5)}-${lng.toFixed(5)}`}`,
    name,
    category,
    categoryLabel: categoryLabel(category),
    kind,
    area,
    address,
    price: "Check source",
    priceValue: null,
    priceType: "Not listed",
    tags: [kind, openingHours ? "Hours listed" : "Confirm hours"].filter(Boolean).slice(0, 2),
    distance: Number.isFinite(props.distance) ? props.distance / 1000 : null,
    open: openingHours || "Confirm before visiting",
    verified: fetchedAt,
    verifiedAt: fetchedAt,
    source: "Geoapify",
    sourceUrl: link || "https://www.geoapify.com/",
    description: "Nearby place from Geoapify Places data. Check the original source for current hours, price and availability.",
    accent: category === "food" ? "#c8795d" : category === "work" ? "#5b847b" : "#171827",
    glyph: category === "food" ? "F" : category === "work" ? "W" : "G",
    lat,
    lng,
    isLiveSource: true
  };
}

async function fetchGeoapifyPlaces(apiKey, lat, lng, radius) {
  const url = new URL(GEOAPIFY_PLACES_URL);
  url.searchParams.set("categories", PLACE_CATEGORIES);
  url.searchParams.set("filter", `circle:${lng},${lat},${radius}`);
  url.searchParams.set("bias", `proximity:${lng},${lat}`);
  url.searchParams.set("limit", "80");
  url.searchParams.set("lang", "en");
  url.searchParams.set("apiKey", apiKey);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  const response = await fetch(url, {
    headers: {"user-agent": "BudgetGurugram/1.0 (Geoapify nearby places)"},
    signal: controller.signal
  });
  clearTimeout(timer);

  if (!response.ok) {
    throw new Error(`Geoapify returned ${response.status}`);
  }

  const payload = await response.json();
  return Array.isArray(payload.features) ? payload.features : [];
}

module.exports = async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({error: "Method not allowed"});
  }

  const apiKey = process.env.GEOAPIFY_API_KEY;
  const lat = numberParam(request.query?.lat, 28.4945, -90, 90);
  const lng = numberParam(request.query?.lng, 77.0894, -180, 180);
  const radius = numberParam(request.query?.radius, 5000, 500, 10000);
  const fetchedAt = new Date().toISOString();

  if (!apiKey) {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Access-Control-Allow-Origin", "*");
    return response.status(503).json({
      source: "Geoapify",
      fetchedAt,
      count: 0,
      places: [],
      error: "GEOAPIFY_API_KEY is not configured on the server"
    });
  }

  try {
    const features = await fetchGeoapifyPlaces(apiKey, lat, lng, radius);
    const places = Array.from(new Map(
      features
        .map((feature) => normalizeFeature(feature, fetchedAt))
        .filter(Boolean)
        .map((place) => [`${place.name.toLowerCase()}|${place.lat.toFixed(5)}|${place.lng.toFixed(5)}`, place])
    ).values()).slice(0, 80);

    if (!places.length) throw new Error("Geoapify returned no usable places");

    response.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=1800");
    response.setHeader("Access-Control-Allow-Origin", "*");
    return response.status(200).json({source: "Geoapify", fetchedAt, count: places.length, radius, places});
  } catch (error) {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Access-Control-Allow-Origin", "*");
    return response.status(502).json({
      source: "Geoapify",
      fetchedAt,
      count: 0,
      places: [],
      error: "Nearby map data is temporarily unavailable"
    });
  }
};
