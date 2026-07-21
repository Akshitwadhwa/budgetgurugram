const fs = require("node:fs/promises");
const path = require("node:path");

module.exports = async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({error:"Method not allowed"});
  }
  try {
    const sources = JSON.parse(await fs.readFile(path.join(process.cwd(), "data", "event-sources.json"), "utf8"));
    const {syncPublicEvents} = await import("../lib/public-events.mjs");
    const payload = await syncPublicEvents(sources, {days:31});
    response.setHeader("Cache-Control", "public, s-maxage=900, stale-while-revalidate=3600");
    return response.status(200).json(payload);
  } catch (error) {
    return response.status(502).json({live:false, error:"Unable to refresh public event sources", events:[]});
  }
};
