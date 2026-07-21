const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter"
];

function numberParam(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function categoryFor(tags) {
  const values = [tags.amenity, tags.shop, tags.office, tags.leisure, tags.tourism].filter(Boolean).join(" ").toLowerCase();
  if (/bar|pub|nightclub/.test(values)) return "bars";
  if (/cafe|restaurant|fast_food|food_court|biergarten|bakery|coffee/.test(values)) return "food";
  if (/coworking|office|studio/.test(values)) return "work";
  if (/park|garden|library|community_centre|arts_centre|museum|theatre|cinema|gallery|attraction/.test(values)) return "public";
  if (/supermarket|convenience|grocery|greengrocer|marketplace|pharmacy|bank|post_office/.test(values)) return "grocery";
  return "services";
}

function categoryLabel(category) {
  return ({food:"Food & drink", work:"Workspaces", public:"Public spaces", events:"Events", services:"Useful services", bars:"Bars", grocery:"Grocery"})[category] || "Local place";
}

function sourceUrl(element) {
  return `https://www.openstreetmap.org/${element.type}/${element.id}`;
}

function normalize(element, fetchedAt) {
  const tags = element.tags || {};
  const center = element.center || element;
  const lat = Number(center.lat);
  const lng = Number(center.lon);
  const name = text(tags.name);
  if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const category = categoryFor(tags);
  const address = [tags["addr:housenumber"], tags["addr:street"], tags["addr:suburb"], tags["addr:city"]].filter(Boolean).join(", ");
  const website = text(tags.website || tags["contact:website"]);
  const kind = text(tags.amenity || tags.shop || tags.office || tags.leisure || tags.tourism);
  return {
    id: `osm-${element.type}-${element.id}`,
    name,
    category,
    categoryLabel: categoryLabel(category),
    kind,
    area: text(tags["addr:suburb"] || tags["addr:city"] || tags["addr:district"]) || "Near you",
    address,
    price: "Check source",
    priceValue: null,
    priceType: "Not listed",
    tags: [kind, tags.opening_hours ? "Hours listed" : "Confirm hours"].filter(Boolean).slice(0, 2),
    distance: null,
    open: tags.opening_hours ? tags.opening_hours : "Confirm before visiting",
    verified: fetchedAt,
    verifiedAt: fetchedAt,
    source: "OpenStreetMap",
    sourceUrl: website || sourceUrl(element),
    description: "Nearby place found in public OpenStreetMap data. Check the original source for current hours, price and availability.",
    accent: category === "food" ? "#c8795d" : category === "work" ? "#5b847b" : category === "grocery" ? "#2ca292" : "#718d85",
    glyph: category === "food" ? "F" : category === "work" ? "W" : category === "grocery" ? "G" : "•",
    lat,
    lng,
    isLiveSource: true
  };
}

async function fetchOverpass(query) {
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {"content-type": "application/x-www-form-urlencoded", "user-agent": "BudgetGurugram/1.0 (public nearby map data)"},
        body: new URLSearchParams({data: query})
      });
      if (response.ok) return response;
    } catch (error) { /* Try the next public Overpass mirror. */ }
  }
  throw new Error("All Overpass mirrors failed");
}

module.exports = async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({error: "Method not allowed"});
  }

  const lat = numberParam(request.query?.lat, 28.4945, -90, 90);
  const lng = numberParam(request.query?.lng, 77.0894, -180, 180);
  const radius = numberParam(request.query?.radius, 5000, 500, 10000);
  const fetchedAt = new Date().toISOString();
  const query = `[out:json][timeout:20];(
    nwr(around:${radius},${lat},${lng})["name"]["amenity"];
    nwr(around:${radius},${lat},${lng})["name"]["shop"];
    nwr(around:${radius},${lat},${lng})["name"]["office"];
    nwr(around:${radius},${lat},${lng})["name"]["leisure"];
    nwr(around:${radius},${lat},${lng})["name"]["tourism"];
  );out center tags;`;

  try {
    const upstream = await fetchOverpass(query);
    if (!upstream.ok) throw new Error(`Overpass returned ${upstream.status}`);
    const payload = await upstream.json();
    const places = Array.from(new Map((payload.elements || []).map((element) => normalize(element, fetchedAt)).filter(Boolean).map((place) => [`${place.name.toLowerCase()}|${place.lat.toFixed(5)}|${place.lng.toFixed(5)}`, place])).values()).slice(0, 150);
    response.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=1800");
    response.setHeader("Access-Control-Allow-Origin", "*");
    return response.status(200).json({source: "OpenStreetMap", fetchedAt, count: places.length, radius, places});
  } catch (error) {
    return response.status(502).json({source: "OpenStreetMap", fetchedAt, count: 0, places: [], error: "Nearby map data is temporarily unavailable"});
  }
};
