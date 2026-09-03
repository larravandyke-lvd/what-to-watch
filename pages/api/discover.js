export default async function handler(req, res) {
  if (!process.env.TMDB_API_KEY) {
    return res.status(200).json({ trending: [], nowPlaying: [], upcoming: [] });
  }

  const mapItem = (x, forcedType) => ({
    id: x.id,
    type: forcedType || (x.media_type === "tv" ? "TV Show" : "Movie"),
    title: x.title || x.name,
    year: (x.release_date || x.first_air_date || "").slice(0, 4) || null,
    posterUrl: x.poster_path ? `https://image.tmdb.org/t/p/w200${x.poster_path}` : null,
    backdropUrl: x.backdrop_path ? `https://image.tmdb.org/t/p/w780${x.backdrop_path}` : null,
  });

  try {
    const [trendingRes, nowPlayingRes, upcomingRes] = await Promise.all([
      fetch(`https://api.themoviedb.org/3/trending/all/week?api_key=${process.env.TMDB_API_KEY}`),
      fetch(`https://api.themoviedb.org/3/movie/now_playing?api_key=${process.env.TMDB_API_KEY}&region=US`),
      fetch(`https://api.themoviedb.org/3/movie/upcoming?api_key=${process.env.TMDB_API_KEY}&region=US`),
    ]);
    const [trendingData, nowPlayingData, upcomingData] = await Promise.all([
      trendingRes.json(),
      nowPlayingRes.json(),
      upcomingRes.json(),
    ]);

    res.status(200).json({
      trending: (trendingData.results || [])
        .filter((x) => x.media_type === "movie" || x.media_type === "tv")
        .slice(0, 12)
        .map((x) => mapItem(x)),
      nowPlaying: (nowPlayingData.results || []).slice(0, 12).map((x) => mapItem(x, "Movie")),
      upcoming: (upcomingData.results || []).slice(0, 12).map((x) => mapItem(x, "Movie")),
    });
  } catch (e) {
    res.status(200).json({ trending: [], nowPlaying: [], upcoming: [] });
  }
}
