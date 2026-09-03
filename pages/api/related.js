import { callClaude, extractJSON } from "../../lib/anthropic";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const { title, genres } = req.body || {};
  if (!title) return res.status(400).json({ error: "title required" });

  try {
    const prompt = `Someone enjoys "${title}" (${(genres || []).join(", ")}). Suggest 3 similar movies or TV shows they might like. Respond with ONLY a raw JSON array, no markdown: [{"title":"...", "type":"Movie or TV Show"}, ...]`;
    const text = await callClaude(prompt, true);
    const json = extractJSON(text, "[]");
    res.status(200).json(json || []);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
