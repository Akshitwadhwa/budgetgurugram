import fs from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {syncPublicEvents} from "../lib/public-events.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sources = JSON.parse(await fs.readFile(path.join(root, "data", "event-sources.json"), "utf8"));
const payload = await syncPublicEvents(sources, {days:31});
await fs.writeFile(path.join(root, "data", "events.json"), JSON.stringify(payload, null, 2) + "\n");
payload.errors.forEach((error) => console.warn(`Skipped source: ${error}`));
console.log(`Wrote ${payload.eventCount} events for the next ${payload.nextWindowDays} days to data/events.json`);
