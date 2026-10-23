import {geocodeEvents} from "./geocode.mjs";
import {enrichEvents} from "./enrich-events.mjs";
import {isGurugramEvent} from "./public-events.mjs";

export async function processEvents(events, options = {}) {
  const localOnly = events.filter(isGurugramEvent);
  const geocoded = await geocodeEvents(localOnly, {
    limit: options.geocodeLimit ?? 12,
    delayMs: options.geocodeDelayMs ?? 0
  });
  const stillLocal = geocoded.filter(isGurugramEvent);
  const enriched = await enrichEvents(stillLocal, {
    apiKey: options.openaiApiKey,
    roleHint: options.roleHint,
    limit: options.enrichLimit ?? 8
  });
  return enriched;
}
