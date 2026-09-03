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

function normalize(str) {
  return (str || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Common aliases so free-text service names (typed by a person or guessed by AI)
// still match TMDB's official provider names.
const ALIASES = {
  hbo: "max",
  hbomax: "max",
  prime: "amazonprimevideo",
  amazon: "amazonprimevideo",
  amazonprime: "amazonprimevideo",
  disney: "disneyplus",
  apple: "appletvplus",
  appletv: "appletvplus",
  paramount: "paramountplus",
};

export default async function handler(req, res) {
  const { service } = req.query;
  if (!service) return res.status(400).json({ error: "service required" });
  if (!process.env.TMDB_API_KEY) return res.status(200).json({ logoUrl: null });

  try {
    const providers = await getProviderList();
    let query = normalize(service);
    query = ALIASES[query] || query;

    let match = providers.find((p) => normalize(p.provider_name) === query);
    if (!match) {
      match = providers.find((p) => {
        const n = normalize(p.provider_name);
        return n.includes(query) || query.includes(n);
      });
    }

    if (!match || !match.logo_path) return res.status(200).json({ logoUrl: null });
    res.status(200).json({ logoUrl: `https://image.tmdb.org/t/p/w92${match.logo_path}` });
  } catch (e) {
    res.status(200).json({ logoUrl: null });
  }
}
