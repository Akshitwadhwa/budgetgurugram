function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function needsEnrichment(event) {
  const description = text(event.description);
  const summary = text(event.aiSummary);
  return !summary && description.length < 28;
}

async function enrichOne(event, apiKey, roleHint) {
  const prompt = [
    "Write one concise sentence (max 22 words) explaining why this event may matter.",
    `Audience hint: ${roleHint || "tech professional in Gurugram"}.`,
    `Title: ${event.title}`,
    `When: ${event.start}`,
    `Where: ${event.location || event.city || "Gurugram"}`,
    `Source: ${event.source || "public calendar"}`,
    "Do not invent speakers, prices, or venue details."
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.4,
      max_tokens: 60,
      messages: [
        {role: "system", content: "You write short, helpful event blurbs for a local city guide."},
        {role: "user", content: prompt}
      ]
    })
  });

  if (!response.ok) throw new Error(`OpenAI returned ${response.status}`);
  const payload = await response.json();
  const summary = text(payload.choices?.[0]?.message?.content);
  if (!summary) throw new Error("OpenAI returned an empty summary");
  return summary.slice(0, 240);
}

export async function enrichEvents(events, options = {}) {
  const apiKey = options.apiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return events.map((event) => ({
      ...event,
      enriched: Boolean(text(event.aiSummary) || text(event.description))
    }));
  }

  const roleHint = options.roleHint || "tech professional";
  const limit = options.limit ?? 8;
  const output = [];
  let enrichedCount = 0;

  for (const event of events) {
    if (!needsEnrichment(event) || enrichedCount >= limit) {
      output.push({...event, enriched: Boolean(text(event.aiSummary) || text(event.description))});
      continue;
    }
    try {
      const aiSummary = await enrichOne(event, apiKey, roleHint);
      output.push({
        ...event,
        aiSummary,
        description: text(event.description) || aiSummary,
        enriched: true
      });
      enrichedCount += 1;
    } catch {
      output.push({...event, enriched: Boolean(text(event.description))});
    }
  }

  return output;
}
