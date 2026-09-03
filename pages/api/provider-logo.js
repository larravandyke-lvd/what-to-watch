// Looks up a streaming service's official logo via TMDB's watch-provider list.
// TMDB maintains these logos specifically for apps that show "where to watch" info.
let cachedProviders = null;
let cachedAt = 0;

async function getProviderList() {
  const ONE_DAY = 1000 * 60 * 60 * 24;
  if (cachedProviders && Date.now() - cachedAt < ONE_DAY) return cachedProviders;

  const [movieRes, tvRes] = await Promise.all([
    fetch(`https://api.themoviedb.org/3/watch/providers/movie?api_key=${process.env.TMDB_API_KEY}&watch_region=US`),
    fetch(`https://api.themoviedb.org/3/watch/providers/tv?api_key=${process.env.TMDB_API_KEY}&watch_region=US`),
  ]);
  const [movieData, tvData] = await Promise.all([movieRes.json(), tvRes.json()]);

  const merged = {};
  [...(movieData.results || []), ...(tvData.results || [])].forEach((p) => {
    merged[p.provider_id] = p;
  });
  cachedProviders = Object.values(merged);
  cachedAt = Date.now();
  return cachedProviders;
}

// Break a name into lowercase word tokens so "Max (HBO)" and "HBO Max" compare
// the same regardless of word order or punctuation.
function tokenize(str) {
  return (str || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

// Some names refer to the same service under different branding —
// expand tokens so either side of a rebrand still matches.
const EXPAND = {
  hbo: ["max"],
  max: ["hbo"],
  prime: ["amazon"],
  amazon: ["prime"],
};

function expandTokens(tokens) {
  const set = new Set(tokens);
  tokens.forEach((t) => {
    (EXPAND[t] || []).forEach((x) => set.add(x));
  });
  return set;
}

function findBestMatch(providers, serviceName) {
  const queryTokens = expandTokens(tokenize(serviceName));
  const queryFull = tokenize(serviceName).join(" ");
  let best = null;
  let bestScore = 0;

  providers.forEach((p) => {
    const pTokens = tokenize(p.provider_name);
    let score = 0;
    pTokens.forEach((t) => {
      if (queryTokens.has(t)) score++;
    });
    if (pTokens.join(" ") === queryFull) score += 10; // exact full-name match wins outright
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  });

  return bestScore > 0 ? best : null;
}

export default async function handler(req, res) {
  const { service } = req.query;
  if (!service) return res.status(400).json({ error: "service required" });
  if (!process.env.TMDB_API_KEY) return res.status(200).json({ logoUrl: null });

  try {
    const providers = await getProviderList();
    const match = findBestMatch(providers, service);
    if (!match || !match.logo_path) return res.status(200).json({ logoUrl: null });
    res.status(200).json({ logoUrl: `https://image.tmdb.org/t/p/w92${match.logo_path}` });
  } catch (e) {
    res.status(200).json({ logoUrl: null });
  }
}
