import { callClaude, extractJSON } from "../../lib/anthropic";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const { title, year, serviceHint } = req.body || {};
  if (!title) return res.status(400).json({ error: "title required" });

  try {
    const disambiguation = year
      ? ` Specifically the one released in or around ${year} — there may be multiple movies or shows with this exact title, so use the ${year} one.`
      : ` Note: some titles are shared by more than one movie or show (remakes, unrelated projects with the same name) — if you find multiple distinct results for "${title}", pick the most well-known one and set "year" to its release year so it can be disambiguated later.`;
    const serviceContext = serviceHint
      ? ` The person believes this is available on "${serviceHint}" — use that as a hint to help confirm which title and release this is, but verify and correct it if your research shows a different current streaming service.`
      : "";
    const prompt = `Look up the title "${title}".${disambiguation}${serviceContext} Determine if it's a Movie or TV Show. Respond with ONLY a raw JSON object, no markdown, no preamble, in this exact shape:
{"title":"the correctly capitalized official title","type":"Movie or TV Show","year": number or null,"service":"primary streaming service or network","genres":["genre1","genre2"],"cast":["actor1","actor2","actor3"],"rtScore": number or null,"rtLink":"url to the Rotten Tomatoes page or null","synopsis":"one sentence"}
Use current, accurate information. If you cannot find a Rotten Tomatoes page, set rtScore and rtLink to null.`;
    const text = await callClaude(prompt, true);
    let json = extractJSON(text, "{}");
    if (!json) {
      // One retry — occasional malformed responses are common with web-search-augmented calls.
      const retryText = await callClaude(prompt, true);
      json = extractJSON(retryText, "{}");
    }
    if (!json) return res.status(200).json({});
    res.status(200).json(json);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
