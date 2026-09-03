export default async function handler(req, res) {
  const { title, type } = req.query;
  if (!title) return res.status(400).json({ error: "title required" });
  if (!process.env.TMDB_API_KEY) return res.status(200).json({ backdropUrl: null });

  const searchType = type === "Movie" ? "movie" : "tv";
  try {
    const searchRes = await fetch(
      `https://api.themoviedb.org/3/search/${searchType}?api_key=${process.env.TMDB_API_KEY}&query=${encodeURIComponent(title)}`
    );
    const searchData = await searchRes.json();
    const result = searchData.results && searchData.results[0];
    if (!result || !result.backdrop_path) {
      return res.status(200).json({ backdropUrl: null });
    }
    res.status(200).json({
      backdropUrl: `https://image.tmdb.org/t/p/w1280${result.backdrop_path}`,
      posterUrl: result.poster_path ? `https://image.tmdb.org/t/p/w342${result.poster_path}` : null,
    });
  } catch (e) {
    res.status(200).json({ backdropUrl: null });
  }
}
