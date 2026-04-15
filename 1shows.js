// 1Shows Source Extension
// Based on 1shows.nl — uses TMDB IDs for movies and TV shows
// Stream delivery via vidsrc.cc embed API

const BASE_URL = "https://www.1shows.nl";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w300";
const TMDB_API_BASE = "https://api.themoviedb.org/3";
const VIDSRC_BASE = "https://vidsrc.cc/v2/embed";

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildTmdbUrl(path, params = {}) {
  let query = `api_key=8265bd1679663a7ea12ac168da84d2e8`;

  for (const key in params) {
    query += `&${key}=${encodeURIComponent(params[key])}`;
  }

  return `${TMDB_API_BASE}${path}?${query}`;
}
function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

// ─── searchResults ───────────────────────────────────────────────────────────
// Returns combined movie + TV results sorted by popularity.
// href format:
//   Movies: "1shows-movie:{tmdb_id}:{title}"
//   TV:     "1shows-tv:{tmdb_id}:{title}"

async function searchResults(query) {
  try {
    const encodedQuery = encodeURIComponent(query);

    const [movieRes, tvRes] = await Promise.all([
      fetchv2(buildTmdbUrl("/search/movie", { query: encodedQuery, include_adult: false })),
      fetchv2(buildTmdbUrl("/search/tv",    { query: encodedQuery, include_adult: false }))
    ]);

    const movieData = await movieRes.json();
    const tvData    = await tvRes.json();

    const movies = (movieData.results || []).map(item => ({
      href:  `1shows-movie:${item.id}:${item.title || ""}`,
      title: item.title || item.original_title || "Unknown",
      image: item.poster_path
        ? `${TMDB_IMAGE_BASE}${item.poster_path}`
        : ""
    }));

    const shows = (tvData.results || []).map(item => ({
      href:  `1shows-tv:${item.id}:${item.name || ""}`,
      title: item.name || item.original_name || "Unknown",
      image: item.poster_path
        ? `${TMDB_IMAGE_BASE}${item.poster_path}`
        : ""
    }));

    // Interleave movies and TV — both sorted by TMDB popularity already
    const combined = [];
    const maxLen = Math.max(movies.length, shows.length);
    for (let i = 0; i < maxLen; i++) {
      if (i < shows.length)  combined.push(shows[i]);
      if (i < movies.length) combined.push(movies[i]);
    }

    if (combined.length === 0) {
      return JSON.stringify([{ href: "", image: "", title: "No results found." }]);
    }

    return JSON.stringify(combined);
  } catch (err) {
    return JSON.stringify([{ href: "", image: "", title: "Search failed: " + err.message }]);
  }
}

// ─── extractDetails ──────────────────────────────────────────────────────────

async function extractDetails(url) {
  try {
    const [type, id] = url.split(":");

    if (type === "1shows-movie") {
      const res  = await fetchv2(buildTmdbUrl(`/movie/${id}`, { append_to_response: "credits" }));
      const data = await res.json();

      const genres  = (data.genres  || []).map(g => g.name).join(", ") || "N/A";
      const runtime = data.runtime ? `${data.runtime} min` : "N/A";
      const rating  = data.vote_average ? data.vote_average.toFixed(1) : "N/A";
      const year    = data.release_date ? data.release_date.slice(0, 4) : "N/A";

      return JSON.stringify([{
        description: data.overview || "No description available.",
        aliases:     `${year} | ${runtime} | ★ ${rating} | ${genres}`,
        airdate:     data.release_date || "Unknown"
      }]);
    }

    if (type === "1shows-tv") {
      const res  = await fetchv2(buildTmdbUrl(`/tv/${id}`));
      const data = await res.json();

      const genres   = (data.genres || []).map(g => g.name).join(", ") || "N/A";
      const seasons  = data.number_of_seasons  || "?";
      const episodes = data.number_of_episodes || "?";
      const rating   = data.vote_average ? data.vote_average.toFixed(1) : "N/A";
      const year     = data.first_air_date ? data.first_air_date.slice(0, 4) : "N/A";

      return JSON.stringify([{
        description: data.overview || "No description available.",
        aliases:     `${year} | ${seasons} Seasons / ${episodes} Episodes | ★ ${rating} | ${genres}`,
        airdate:     data.first_air_date || "Unknown"
      }]);
    }

    return JSON.stringify([{ description: "Unknown content type.", aliases: "", airdate: "" }]);
  } catch (err) {
    return JSON.stringify([{ description: "Failed to load details: " + err.message, aliases: "", airdate: "" }]);
  }
}

// ─── extractEpisodes ─────────────────────────────────────────────────────────
// For movies: returns a single entry (the movie itself).
// For TV:     returns one entry per episode, across all seasons.

async function extractEpisodes(url) {
  try {
    const [type, id, rawTitle] = url.split(":");

    if (type === "1shows-movie") {
      return JSON.stringify([{
        number: 1,
        href:   `1shows-stream-movie:${id}`
      }]);
    }

    if (type === "1shows-tv") {
      const res  = await fetchv2(buildTmdbUrl(`/tv/${id}`));
      const data = await res.json();

      const seasons = (data.seasons || []).filter(s => s.season_number > 0);

      const allEpisodes = [];

      for (const season of seasons) {
        const sRes  = await fetchv2(buildTmdbUrl(`/tv/${id}/season/${season.season_number}`));
        const sData = await sRes.json();

        for (const ep of (sData.episodes || [])) {
          allEpisodes.push({
            number: parseFloat(`${season.season_number}.${String(ep.episode_number).padStart(3, "0")}`),
            href:   `1shows-stream-tv:${id}:${season.season_number}:${ep.episode_number}`
          });
        }
      }

      return JSON.stringify(allEpisodes);
    }

    return JSON.stringify([{ number: 1, href: "Error: unknown type" }]);
  } catch (err) {
    return JSON.stringify([{ number: 1, href: "Error: " + err.message }]);
  }
}

// ─── extractStreamUrl ────────────────────────────────────────────────────────
// Returns a vidsrc.cc embed URL as the stream.
// vidsrc.cc supports HLS via its embed endpoint — no scraping needed.

async function extractStreamUrl(url) {
  try {
    if (url.startsWith("1shows-stream-movie:")) {
      const id = url.replace("1shows-stream-movie:", "").trim();

      // vidsrc.cc movie embed
      const embedUrl = `${VIDSRC_BASE}/movie/${id}`;

      return JSON.stringify({
        streams: [
          { title: "vidsrc.cc", streamUrl: embedUrl }
        ],
        subtitles: ""
      });
    }

    if (url.startsWith("1shows-stream-tv:")) {
      const parts   = url.split(":");
      const id      = parts[1];
      const season  = parts[2];
      const episode = parts[3];

      // vidsrc.cc episode embed
      const embedUrl = `${VIDSRC_BASE}/tv/${id}/${season}/${episode}`;

      return JSON.stringify({
        streams: [
          { title: "vidsrc.cc", streamUrl: embedUrl }
        ],
        subtitles: ""
      });
    }

    return JSON.stringify({
      streams: [],
      subtitles: ""
    });
  } catch (err) {
    return JSON.stringify({
      streams: [],
      subtitles: ""
    });
  }
}
