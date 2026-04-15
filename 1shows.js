const BASE_URL = "https://www.1shows.nl";
const VIDSRC_BASE = "https://vidsrc.cc/v2/embed";

// ─── SEARCH ────────────────────────────────────────────────────────────────

async function searchResults(query) {
  try {
    const url = BASE_URL + "/search?q=" + encodeURIComponent(query);

    const res = await fetchv2({
      url: url,
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "text/html"
      }
    });

    const html = await res.text();
    const results = [];

    // Adjusted regex for 1shows layout
    const regex = /href="\/(movie|tv)\/([^"]+)"[\s\S]*?<img[^>]+src="([^"]+)"[\s\S]*?alt="([^"]+)"/g;

    let match;
    while ((match = regex.exec(html)) !== null) {
      const type = match[1];
      const slug = match[2];
      const image = match[3];
      const title = match[4];

      results.push({
        href: `1shows-${type}:${slug}`,
        title: title,
        image: image.startsWith("http") ? image : BASE_URL + image
      });
    }

    if (results.length === 0) {
      return JSON.stringify([{ href: "", image: "", title: "No results found." }]);
    }

    return JSON.stringify(results);

  } catch (err) {
    return JSON.stringify([{ href: "", image: "", title: "Search failed: " + err.message }]);
  }
}

// Required wrapper for some apps
async function search(query) {
  return await searchResults(query);
}

// ─── DETAILS ───────────────────────────────────────────────────────────────

async function extractDetails(url) {
  try {
    const [type, slug] = url.split(":");
    const pageUrl = `${BASE_URL}/${type.replace("1shows-", "")}/${slug}`;

    const res = await fetchv2({ url: pageUrl });
    const html = await res.text();

    const descriptionMatch = html.match(/<p[^>]*class="[^"]*overview[^"]*"[^>]*>([^<]+)</);
    const description = descriptionMatch ? descriptionMatch[1] : "No description available.";

    return JSON.stringify([{
      description: description,
      aliases: "",
      airdate: ""
    }]);

  } catch (err) {
    return JSON.stringify([{ description: "Failed to load details", aliases: "", airdate: "" }]);
  }
}

// ─── EPISODES ──────────────────────────────────────────────────────────────

async function extractEpisodes(url) {
  try {
    const [type, slug] = url.split(":");

    // Movies = single entry
    if (type === "1shows-movie") {
      return JSON.stringify([{
        number: 1,
        href: `1shows-stream-movie:${slug}`
      }]);
    }

    // TV = scrape episodes
    const pageUrl = `${BASE_URL}/tv/${slug}`;
    const res = await fetchv2({ url: pageUrl });
    const html = await res.text();

    const episodes = [];

    const regex = /data-season="(\d+)"\s+data-episode="(\d+)"/g;

    let match;
    while ((match = regex.exec(html)) !== null) {
      const season = match[1];
      const episode = match[2];

      episodes.push({
        number: parseFloat(`${season}.${episode.padStart(3, "0")}`),
        href: `1shows-stream-tv:${slug}:${season}:${episode}`
      });
    }

    return JSON.stringify(episodes);

  } catch (err) {
    return JSON.stringify([{ number: 1, href: "Error loading episodes" }]);
  }
}

// ─── STREAMS ───────────────────────────────────────────────────────────────

async function extractStreamUrl(url) {
  try {
    if (url.startsWith("1shows-stream-movie:")) {
      const slug = url.replace("1shows-stream-movie:", "");

      return JSON.stringify({
        streams: [
          { title: "vidsrc.cc", streamUrl: `${VIDSRC_BASE}/movie/${slug}` }
        ],
        subtitles: ""
      });
    }

    if (url.startsWith("1shows-stream-tv:")) {
      const parts = url.split(":");
      const slug = parts[1];
      const season = parts[2];
      const episode = parts[3];

      return JSON.stringify({
        streams: [
          { title: "vidsrc.cc", streamUrl: `${VIDSRC_BASE}/tv/${slug}/${season}/${episode}` }
        ],
        subtitles: ""
      });
    }

    return JSON.stringify({ streams: [], subtitles: "" });

  } catch (err) {
    return JSON.stringify({ streams: [], subtitles: "" });
  }
}
