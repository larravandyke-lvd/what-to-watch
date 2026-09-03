import { callClaude, extractJSON } from "../../lib/anthropic";

export const config = {
  api: { bodyParser: { sizeLimit: "10mb" } },
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const { base64, mediaType } = req.body || {};
  if (!base64) return res.status(400).json({ error: "base64 image required" });

  try {
    const content = [
      { type: "image", source: { type: "base64", media_type: mediaType || "image/jpeg", data: base64 } },
      {
        type: "text",
        text: `This is a photo of a TV/streaming screen or a screenshot. Identify the show or movie title, and if visible, the season/episode number and the streaming service shown. Respond with ONLY a raw JSON object, no markdown:
{"title":"best guess of title","episode":"e.g. Season 2, Episode 4, or null","service":"streaming service if visible, or null"}`,
      },
    ];
    const text = await callClaude(content, false);
    const json = extractJSON(text, "{}");
    res.status(200).json(json || {});
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
