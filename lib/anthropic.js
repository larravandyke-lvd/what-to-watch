export async function callClaude(content, useWebSearch) {
  const body = {
    model: "claude-sonnet-4-6",
    max_tokens: 1000,
    messages: [{ role: "user", content }],
  };
  if (useWebSearch) {
    body.tools = [{ type: "web_search_20250305", name: "web_search" }];
  }
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${errText}`);
  }
  const data = await res.json();
  return (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

export function extractJSON(text, bracket = "{}") {
  const [open, close] = bracket;
  let clean = text.replace(/```json/gi, "").replace(/```/g, "").trim();

  // Scan for a properly balanced object/array starting from each opening
  // bracket, rather than naively grabbing first-to-last — this avoids
  // grabbing unrelated braces from citations or commentary elsewhere in
  // the response, which was causing consistent parse failures on some titles.
  let searchFrom = 0;
  while (true) {
    const start = clean.indexOf(open, searchFrom);
    if (start === -1) break;
    let depth = 0;
    for (let i = start; i < clean.length; i++) {
      if (clean[i] === open) depth++;
      else if (clean[i] === close) {
        depth--;
        if (depth === 0) {
          const candidate = clean.slice(start, i + 1);
          try {
            return JSON.parse(candidate);
          } catch {
            break; // this candidate wasn't valid JSON — keep scanning after it
          }
        }
      }
    }
    searchFrom = start + 1;
  }

  // Last-resort fallback: the old naive approach, in case the above misses an edge case.
  const start = clean.indexOf(open);
  const end = clean.lastIndexOf(close);
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(clean.slice(start, end + 1));
  } catch {
    return null;
  }
}
