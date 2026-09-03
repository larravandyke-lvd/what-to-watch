export default async function handler(req, res) {
  const { title, type, year } = req.query;
  if (!title) return res.status(400).json({ error: "title required" });
  if (!process.env.TMDB_API_KEY) return res.status(200).json({ backdropUrl: null });

  const searchType = type === "Movie" ? "movie" : "tv";
  const yearParam = year ? `&${searchType === "movie" ? "year" : "first_air_date_year"}=${encodeURIComponent(year)}` : "";
  try {
    const searchRes = await fetch(
      `https://api.themoviedb.org/3/search/${searchType}?api_key=${process.env.TMDB_API_KEY}&query=${encodeURIComponent(title)}${yearParam}`
    );
    const searchData = await searchRes.json();
    const result = searchData.results && searchData.results[0];
    if (!result) {
      return res.status(200).json({ backdropUrl: null });
    }

    let watchLink = null;
    try {
      const watchRes = await fetch(
        `https://api.themoviedb.org/3/${searchType}/${result.id}/watch/providers?api_key=${process.env.TMDB_API_KEY}`
      );
      const watchData = await watchRes.json();
      watchLink = (watchData.results && watchData.results.US && watchData.results.US.link) || null;
    } catch (e) {
      watchLink = null;
    }

    res.status(200).json({
      backdropUrl: result.backdrop_path ? `https://image.tmdb.org/t/p/w1280${result.backdrop_path}` : null,
      posterUrl: result.poster_path ? `https://image.tmdb.org/t/p/w342${result.poster_path}` : null,
      watchLink,
    });
  } catch (e) {
    res.status(200).json({ backdropUrl: null });
  }
}
