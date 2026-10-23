import fs from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {syncPublicEvents} from "../lib/public-events.mjs";
import {processEvents} from "../lib/process-events.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sources = JSON.parse(await fs.readFile(path.join(root, "data", "event-sources.json"), "utf8"));
const payload = await syncPublicEvents(sources, {days: 31});
const enabledSourceCount = sources.filter((source) => source.enabled !== false).length;
if (enabledSourceCount && payload.errors.length === enabledSourceCount) {
  throw new Error("All public event sources failed; preserving the previous event snapshot.");
}
payload.events = await processEvents(payload.events, {
  geocodeLimit: 20,
  geocodeDelayMs: 1100,
  enrichLimit: process.env.OPENAI_API_KEY ? 12 : 0
});
payload.enriched = payload.events.some((event) => event.enriched);
payload.geocodedCount = payload.events.filter((event) => Number.isFinite(event.lat) && Number.isFinite(event.lng)).length;
await fs.writeFile(path.join(root, "data", "events.json"), JSON.stringify(payload, null, 2) + "\n");
await fs.writeFile(path.join(root, "js", "events.js"), "window.GC_EVENTS = " + JSON.stringify(payload.events) + ";\n");
payload.errors.forEach((error) => console.warn(`Skipped source: ${error}`));
console.log(`Wrote ${payload.eventCount} events (${payload.geocodedCount} mapped) for the next ${payload.nextWindowDays} days to data/events.json`);
