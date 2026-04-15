///
///
/// 1Shows Luna/Sora/Tsumi/Hiyoku Module
/// Modeled on the working Ashi source pattern
/// Site: https://www.1shows.nl
/// Uses TMDB-based search + vidsrc.cc for streaming
///

const PROXY = "https://deno-proxies-sznvnpnxwhbv.deno.dev/?url=";
const TMDB_KEY = "8265bd1679663a7ea12ac168da84d2e8";
const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_IMG = "https://image.tmdb.org/t/p/w300";

function p(url) {
  return PROXY + encodeURIComponent(url);
}

// ─── searchResults ────────────────────────────────────────────────────────────

async function searchResults(query) {
  try {
    const q = encodeURIComponent(query);

    const [mvRes, tvRes] = await Promise.all([
      fetchv2(p(`${TMDB_BASE}/search/movie?api_key=${TMDB_KEY}&query=${q}&include_adult=false`)),
      fetchv2(p(`${TMDB_BASE}/search/tv?api_key=${TMDB_KEY}&query=${q}&include_adult=false`))
    ]);

    const mvData = await mvRes.json();
    const tvData = await tvRes.json();

    const movies = (mvData.results || []).map(item => ({
      href:  `https://www.1shows.nl/${item.id}-${slugify(item.title || "")}?type=movie`,
      title: (item.title || item.original_title || "Unknown") + " (Movie)",
      image: item.poster_path ? `${TMDB_IMG}${item.poster_path}` : ""
    }));

    const shows = (tvData.results || []).map(item => ({
      href:  `https://www.1shows.nl/tv/${item.id}-${slugify(item.name || "")}`,
      title: (item.name || item.original_name || "Unknown") + " (TV)",
      image: item.poster_path ? `${TMDB_IMG}${item.poster_path}` : ""
    }));

    // Interleave TV and movies
    const combined = [];
    const max = Math.max(movies.length, shows.length);
    for (let i = 0; i < max; i++) {
      if (i < shows.length)  combined.push(shows[i]);
      if (i < movies.length) combined.push(movies[i]);
    }

    return JSON.stringify(
      combined.length > 0
        ? combined
        : [{ href: "", image: "", title: "No results found." }]
    );
  } catch (e) {
    return JSON.stringify([{ href: "", image: "", title: "Search error: " + e.message }]);
  }
}

function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

// ─── extractDetails ───────────────────────────────────────────────────────────

async function extractDetails(url) {
  try {
    const { tmdbId, type } = parseUrl(url);

    const endpoint = type === "movie"
      ? `${TMDB_BASE}/movie/${tmdbId}?api_key=${TMDB_KEY}`
      : `${TMDB_BASE}/tv/${tmdbId}?api_key=${TMDB_KEY}`;

    const res  = await fetchv2(p(endpoint));
    const data = await res.json();

    if (type === "movie") {
      const genres  = (data.genres || []).map(g => g.name).join(", ") || "N/A";
      const runtime = data.runtime ? `${data.runtime} min` : "N/A";
      const rating  = data.vote_average ? data.vote_average.toFixed(1) : "N/A";
      const year    = (data.release_date || "").slice(0, 4) || "N/A";

      return JSON.stringify([{
        description: data.overview || "No description available.",
        aliases:     `${year} | ${runtime} | ★ ${rating} | ${genres}`,
        airdate:     data.release_date || "Unknown"
      }]);
    } else {
      const genres   = (data.genres || []).map(g => g.name).join(", ") || "N/A";
      const seasons  = data.number_of_seasons  || "?";
      const episodes = data.number_of_episodes || "?";
      const rating   = data.vote_average ? data.vote_average.toFixed(1) : "N/A";
      const year     = (data.first_air_date || "").slice(0, 4) || "N/A";

      return JSON.stringify([{
        description: data.overview || "No description available.",
        aliases:     `${year} | ${seasons} Seasons / ${episodes} Episodes | ★ ${rating} | ${genres}`,
        airdate:     data.first_air_date || "Unknown"
      }]);
    }
  } catch (e) {
    return JSON.stringify([{
      description: "Failed to load details: " + e.message,
      aliases: "",
      airdate: ""
    }]);
  }
}

// ─── extractEpisodes ──────────────────────────────────────────────────────────

async function extractEpisodes(url) {
  try {
    const { tmdbId, type } = parseUrl(url);

    if (type === "movie") {
      return JSON.stringify([{
        number: 1,
        href: `1shows-stream:movie:${tmdbId}`
      }]);
    }

    // TV — fetch all seasons from TMDB
    const showRes  = await fetchv2(p(`${TMDB_BASE}/tv/${tmdbId}?api_key=${TMDB_KEY}`));
    const showData = await showRes.json();

    const seasons = (showData.seasons || []).filter(s => s.season_number > 0);
    const episodes = [];

    for (const season of seasons) {
      const sRes  = await fetchv2(p(`${TMDB_BASE}/tv/${tmdbId}/season/${season.season_number}?api_key=${TMDB_KEY}`));
      const sData = await sRes.json();

      for (const ep of (sData.episodes || [])) {
        episodes.push({
          number: parseFloat(`${season.season_number}.${String(ep.episode_number).padStart(3, "0")}`),
          href: `1shows-stream:tv:${tmdbId}:${season.season_number}:${ep.episode_number}`
        });
      }
    }

    return JSON.stringify(episodes.length > 0
      ? episodes
      : [{ number: 1, href: "No episodes found" }]
    );
  } catch (e) {
    return JSON.stringify([{ number: 1, href: "Error: " + e.message }]);
  }
}

// ─── extractStreamUrl ─────────────────────────────────────────────────────────

async function extractStreamUrl(url) {
  try {
    let embedUrl = "";

    if (url.startsWith("1shows-stream:movie:")) {
      const tmdbId = url.split(":")[2];
      embedUrl = `https://vidsrc.cc/v2/embed/movie/${tmdbId}`;
    } else if (url.startsWith("1shows-stream:tv:")) {
      const parts   = url.split(":");
      // parts: ["1shows-stream", "tv", tmdbId, season, episode]
      const tmdbId  = parts[2];
      const season  = parts[3];
      const episode = parts[4];
      embedUrl = `https://vidsrc.cc/v2/embed/tv/${tmdbId}/${season}/${episode}`;
    } else {
      // Fallback: url is already an embed url
      embedUrl = url;
    }

    return JSON.stringify({
      streams: [
        { title: "Server 1", streamUrl: embedUrl }
      ],
      subtitles: ""
    });
  } catch (e) {
    return JSON.stringify({ streams: [], subtitles: "" });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseUrl(url) {
  // Movie URL:  https://www.1shows.nl/12345-some-title?type=movie
  // TV URL:     https://www.1shows.nl/tv/12345-some-title
  // Stream key: 1shows-stream:movie:12345  or  1shows-stream:tv:12345:1:1

  if (url.startsWith("1shows-stream:")) {
    const parts = url.split(":");
    return {
      type:    parts[1],
      tmdbId:  parts[2]
    };
  }

  if (url.includes("?type=movie")) {
    const slug   = url.split("1shows.nl/")[1].split("?")[0];
    const tmdbId = slug.split("-")[0];
    return { tmdbId, type: "movie" };
  }

  if (url.includes("/tv/")) {
    const slug   = url.split("/tv/")[1].split("?")[0];
    const tmdbId = slug.split("-")[0];
    return { tmdbId, type: "tv" };
  }

  // Fallback
  const match = url.match(/\/(\d+)/);
  return { tmdbId: match ? match[1] : "", type: "tv" };
}
