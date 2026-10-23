const fs = require("node:fs/promises");
const path = require("node:path");

module.exports = async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({error: "Method not allowed"});
  }
  try {
    const sources = JSON.parse(await fs.readFile(path.join(process.cwd(), "data", "event-sources.json"), "utf8"));
    const {syncPublicEvents} = await import("../lib/public-events.mjs");
    const {processEvents} = await import("../lib/process-events.mjs");
    const roleHint = typeof request.query?.role === "string" ? request.query.role : "tech professional";
    const payload = await syncPublicEvents(sources, {days: 31});
    payload.events = await processEvents(payload.events, {
      geocodeLimit: 10,
      geocodeDelayMs: 0,
      enrichLimit: 8,
      roleHint
    });
    payload.enriched = payload.events.some((event) => event.enriched);
    payload.geocodedCount = payload.events.filter((event) => Number.isFinite(event.lat) && Number.isFinite(event.lng)).length;
    response.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=1800");
    return response.status(200).json(payload);
  } catch (error) {
    return response.status(502).json({live: false, error: "Unable to refresh public event sources", events: []});
  }
};
