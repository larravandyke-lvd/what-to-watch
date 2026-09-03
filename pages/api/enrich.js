import { callClaude, extractJSON } from "../../lib/anthropic";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const { title } = req.body || {};
  if (!title) return res.status(400).json({ error: "title required" });

  try {
    const prompt = `Look up the title "${title}". Determine if it's a Movie or TV Show. Respond with ONLY a raw JSON object, no markdown, no preamble, in this exact shape:
{"type":"Movie or TV Show","service":"primary streaming service or network","genres":["genre1","genre2"],"cast":["actor1","actor2","actor3"],"rtScore": number or null,"rtLink":"url to the Rotten Tomatoes page or null","synopsis":"one sentence"}
Use current, accurate information. If you cannot find a Rotten Tomatoes page, set rtScore and rtLink to null.`;
    const text = await callClaude(prompt, true);
    const json = extractJSON(text, "{}");
    if (!json) return res.status(200).json({});
    res.status(200).json(json);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
