/**
 * generate.js
 * Usage:
 *   YT_API_KEY=AIzaSyBdJxyIbpsAFjAuMQ7mmv0AdJJsLx0MTkQ node generate.js
 * or set YT_API_KEY in CI (recommended).
 *
 * Output:
 *  - /docs/videos.json
 *  - /docs/video-<videoId>.html  (one file per video)
 *  - /docs/sitemap.xml
 *  - /docs/feed.xml  (RSS)
 */
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const CHANNEL_ID = 'UCqIV4jce9V3lY4UoNObmXBA'; // provided by user
const API_KEY = process.env.YT_API_KEY || ''; // must be set in env for full metadata
const OUT = path.resolve(__dirname, 'docs');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

async function fetchAllVideosApi() {
  if (!API_KEY) return null;
  const videoItems = [];
  // Step 1: get uploads playlist id from channel
  const ch = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
    params: { part: 'contentDetails,snippet', id: CHANNEL_ID, key: API_KEY }
  });
  if (!ch.data.items || !ch.data.items.length) throw new Error('Channel not found or API key invalid');
  const uploadsPlaylist = ch.data.items[0].contentDetails.relatedPlaylists.uploads;
  // Step 2: paginate playlistItems
  let next = '';
  while (true) {
    const res = await axios.get('https://www.googleapis.com/youtube/v3/playlistItems', {
      params: {
        part: 'snippet,contentDetails',
        playlistId: uploadsPlaylist,
        maxResults: 50,
        pageToken: next,
        key: API_KEY
      }
    });
    for (const it of res.data.items) {
      videoItems.push({
        videoId: it.contentDetails.videoId,
        title: it.snippet.title,
        description: it.snippet.description,
        publishedAt: it.contentDetails.videoPublishedAt || it.snippet.publishedAt,
        thumbnail: (it.snippet.thumbnails && (it.snippet.thumbnails.maxres || it.snippet.thumbnails.high || it.snippet.thumbnails.medium || it.snippet.thumbnails.default)).url
      });
    }
    if (res.data.nextPageToken) next = res.data.nextPageToken; else break;
  }
  // Step 3: get details (duration, tags) in batches
  for (let i=0;i<videoItems.length;i+=50){
    const batch = videoItems.slice(i,i+50).map(v=>v.videoId).join(',');
    const r = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
      params: { part: 'contentDetails,statistics,snippet', id: batch, key: API_KEY }
    });
    r.data.items.forEach(item => {
      const v = videoItems.find(x => x.videoId === item.id);
      if (!v) return;
      v.duration = item.contentDetails.duration; // ISO 8601
      v.duration_text = toHumanDuration(item.contentDetails.duration);
      v.tags = item.snippet.tags || [];
      v.views = item.statistics ? item.statistics.viewCount : 0;
      v.url = `./video-${item.id}.html`;
      v.published_at = v.publishedAt;
    });
  }
  return videoItems.reverse(); // newest first
}

function isoDurationToSeconds(d) {
  // Parse a simple ISO 8601 duration (PT1M30S etc). We'll implement basic parser.
  const m = d.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (parseInt(m[1]||0)*3600) + (parseInt(m[2]||0)*60) + (parseInt(m[3]||0));
}
function toHumanDuration(d){
  const s = isoDurationToSeconds(d);
  const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = s%60;
  if (h) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  return `${m}:${String(sec).padStart(2,'0')}`;
}

async function fetchRssFallback() {
  // RSS feed is available at: https://www.youtube.com/feeds/videos.xml?channel_id=CHANNEL_ID
  const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`;
  const res = await axios.get(rssUrl);
  // crude XML parse for entries
  const items = [];
  const entries = res.data.split('<entry>').slice(1);
  for (const e of entries) {
    const id = (e.match(/<yt:videoId>([^<]+)<\/yt:videoId>/) || [])[1];
    const title = (e.match(/<title>([^<]+)<\/title>/) || [])[1];
    const published = (e.match(/<published>([^<]+)<\/published>/) || [])[1];
    const thumb = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
    const link = `./video-${id}.html`;
    items.push({ videoId: id, title, description: '', thumbnail: thumb, url: link, published_at: published });
  }
  return items.reverse();
}

function writeJSON(name, data){
  fs.writeFileSync(path.join(OUT,name), JSON.stringify(data, null, 2), 'utf8');
  console.log('Wrote', name);
}

function generateVideoPage(v) {
  // Minimal SEO metadata + JSON-LD VideoObject
  const title = escapeHtml(v.title);
  const desc = escapeHtml((v.description||'').slice(0,250));
  const videoUrl = `https://YOUR-SITE-DOMAIN/${v.url.replace('./','')}`; // replace with real domain in deployment
  const thumbnail = v.thumbnail || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`;
  const jsonLd = {
    "@context":"https://schema.org",
    "@type":"VideoObject",
    "name": v.title,
    "description": v.description || '',
    "thumbnailUrl": thumbnail,
    "uploadDate": v.published_at,
    "url": `https://www.youtube.com/watch?v=${v.videoId}`,
    "embedUrl": `https://www.youtube.com/embed/${v.videoId}`,
    "duration": v.duration || undefined
  };
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${title} — I Love Shorts</title>
  <meta name="description" content="${desc}" />
  <meta property="og:type" content="video.other" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${desc}" />
  <meta property="og:image" content="${thumbnail}" />
  <meta property="og:url" content="${videoUrl}" />
  <meta name="twitter:card" content="player" />
  <meta name="twitter:title" content="${title}" />
  <meta name="twitter:description" content="${desc}" />
  <link rel="stylesheet" href="styles.css" />
  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
</head>
<body>
  <main class="container">
    <article class="card">
      <h1>${title}</h1>
      <p class="stats">${v.published_at ? v.published_at.slice(0,10) : ''} • ${v.duration_text || ''}</p>
      <div class="video-embed" style="margin:18px 0;">
        <iframe width="100%" height="420" src="https://www.youtube.com/embed/${v.videoId}" frameborder="0" allowfullscreen loading="lazy"></iframe>
      </div>
      <section>
        <h2>Description</h2>
        <p>${escapeHtml(v.description || '')}</p>
      </section>
      <p><a href="/">← Back to all videos</a></p>
    </article>
  </main>
</body>
</html>`;
}

function escapeHtml(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;'); }

(async () => {
  console.log('Starting generator for channel', CHANNEL_ID);
  let videos = null;
  try {
    videos = await fetchAllVideosApi();
  } catch (e) {
    console.warn('API fetch failed or missing key:', e.message);
  }
  if (!videos) {
    console.log('Falling back to RSS...');
    videos = await fetchRssFallback();
  }
  // normalize fields
  videos = videos.map(v => ({
    videoId: v.videoId,
    title: v.title,
    description: v.description || '',
    thumbnail: v.thumbnail || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
    url: `video-${v.videoId}.html`,
    published_at: v.published_at || v.publishedAt || '',
    tags: v.tags || [],
    duration_text: v.duration_text || '',
    views: v.views || 0
  }));

  // write videos.json
  writeJSON('videos.json', videos);

  // write per-video pages
  for (const v of videos) {
    const html = generateVideoPage(v);
    fs.writeFileSync(path.join(OUT, v.url.replace('./','')), html, 'utf8');
  }

  // sitemap
  const base = 'https://YOUR-SITE-DOMAIN/'; // CHANGE to your domain (or GitHub Pages) before publishing
  const urls = [`${base}`].concat(videos.map(v => `${base}${v.url.replace('./','')}`));
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
  <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${urls.map(u => `<url><loc>${u}</loc></url>`).join('\n')}
  </urlset>`;
  fs.writeFileSync(path.join(OUT,'sitemap.xml'), sitemap, 'utf8');
  // simple RSS
  const feedItems = videos.map(v => `<item><title>${escapeHtml(v.title)}</title><link>${base}${v.url.replace('./','')}</link><guid>${v.videoId}</guid><pubDate>${v.published_at}</pubDate></item>`).join('\n');
  const feed = `<?xml version="1.0" encoding="utf-8"?><rss version="2.0"><channel><title>I Love Shorts</title><link>${base}</link>${feedItems}</channel></rss>`;
  fs.writeFileSync(path.join(OUT,'feed.xml'), feed, 'utf8');

  console.log('Done. Wrote', videos.length, 'videos to', OUT);
})();
