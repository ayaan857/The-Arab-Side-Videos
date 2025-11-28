/**
 * generate.js
 * Usage:
 *   YT_API_KEY=YOUR_KEY node generate.js
 *   OR let GitHub Actions inject it from Secrets
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

// Channel ID
const CHANNEL_ID = 'UCqIV4jce9V3lY4UoNObmXBA';

// API Key from environment (GitHub Secrets or local terminal)
const API_KEY = process.env.YT_API_KEY || '';
if (!API_KEY) console.warn('⚠️ Warning: YT_API_KEY not set. Using RSS fallback only.');

const OUT = path.resolve(__dirname, 'docs');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

// --- Fetch videos via API ---
async function fetchAllVideosApi() {
  if (!API_KEY) return null;
  const videoItems = [];

  // Step 1: Get uploads playlist
  const ch = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
    params: { part: 'contentDetails', id: CHANNEL_ID, key: API_KEY }
  });

  if (!ch.data.items || !ch.data.items.length)
    throw new Error('Channel not found or invalid API key');

  const uploadsPlaylist = ch.data.items[0].contentDetails.relatedPlaylists.uploads;

  // Step 2: Fetch all videos from playlist (pagination)
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
        thumbnail: (it.snippet.thumbnails?.maxres?.url || it.snippet.thumbnails?.high?.url || it.snippet.thumbnails?.medium?.url || it.snippet.thumbnails?.default?.url) || ''
      });
    }

    if (res.data.nextPageToken) next = res.data.nextPageToken;
    else break;
  }

  // Step 3: Get extra details (duration, tags, views)
  for (let i = 0; i < videoItems.length; i += 50) {
    const batch = videoItems.slice(i, i + 50).map(v => v.videoId).join(',');
    const r = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
      params: { part: 'snippet,contentDetails,statistics', id: batch, key: API_KEY }
    });

    r.data.items.forEach(item => {
      const v = videoItems.find(x => x.videoId === item.id);
      if (!v) return;
      v.duration = item.contentDetails.duration;
      v.duration_text = toHumanDuration(item.contentDetails.duration);
      v.tags = item.snippet.tags || [];
      v.views = item.statistics?.viewCount || 0;
      v.url = `./video-${item.id}.html`;
      v.published_at = v.publishedAt;
    });
  }

  return videoItems.reverse(); // newest first
}

// --- Fallback via RSS (no API key needed)
async function fetchRssFallback() {
  const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`;
  const res = await axios.get(rssUrl);
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

// --- Utilities ---
function isoDurationToSeconds(d) {
  const m = d.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (parseInt(m[1]||0)*3600) + (parseInt(m[2]||0)*60) + (parseInt(m[3]||0));
}
function toHumanDuration(d){
  const s = isoDurationToSeconds(d);
  const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = s%60;
  return h ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}` : `${m}:${String(sec).padStart(2,'0')}`;
}
function escapeHtml(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;'); }
function writeJSON(name,data){ fs.writeFileSync(path.join(OUT,name), JSON.stringify(data,null,2),'utf8'); }

// --- Generate individual video HTML
function generateVideoPage(v){
  const title = escapeHtml(v.title);
  const desc = escapeHtml((v.description||'').slice(0,250));
  const videoUrl = `https://ayaan857.github.io/The-Arab-Side-Videos/${v.url.replace('./','')}`;
  const thumbnail = v.thumbnail || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`;

  const jsonLd = {
    "@context":"https://schema.org",
    "@type":"VideoObject",
    "name": v.title,
    "description": v.description||'',
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
<title>${title}</title>
<meta name="description" content="${desc}" />
<meta property="og:image" content="${thumbnail}" />
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
<link rel="stylesheet" href="styles.css" />
</head>
<body>
<main class="container">
<article class="card">
<h1>${title}</h1>
<p>${v.published_at.slice(0,10)} • ${v.duration_text}</p>
<iframe width="100%" height="420" src="https://www.youtube.com/embed/${v.videoId}" allowfullscreen loading="lazy"></iframe>
<h2>Description</h2>
<p>${escapeHtml(v.description||'')}</p>
<p><a href="/">← All Videos</a></p>
</article>
</main>
</body>
</html>`;
}

// --- MAIN ---
(async()=>{
  console.log('Starting generator for channel:', CHANNEL_ID);
  let videos = null;

  try { videos = await fetchAllVideosApi(); } 
  catch(e){ console.warn('API fetch failed, using RSS fallback'); }

  if(!videos) videos = await fetchRssFallback();

  videos = videos.map(v=>({
    videoId:v.videoId,
    title:v.title,
    description:v.description||'',
    thumbnail:v.thumbnail||`https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
    url:`video-${v.videoId}.html`,
    published_at:v.published_at,
    tags:v.tags||[],
    duration_text:v.duration_text||'',
    views:v.views||0
  }));

  writeJSON('videos.json',videos);

  for(const v of videos){
    const html = generateVideoPage(v);
    fs.writeFileSync(path.join(OUT,v.url.replace('./','')) , html ,'utf8');
  }

  // Sitemap + RSS
  const base = 'https://ayaan857.github.io/The-Arab-Side-Videos/';
  const urls = [base].concat(videos.map(v=>`${base}${v.url.replace('./','')}`));

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u=>`<url><loc>${u}</loc></url>`).join('\n')}
</urlset>`;
  fs.writeFileSync(path.join(OUT,'sitemap.xml'),sitemap,'utf8');

  const feedItems = videos.map(v=>`<item><title>${escapeHtml(v.title)}</title><link>${base}${v.url.replace('./','')}</link><guid>${v.videoId}</guid><pubDate>${v.published_at}</pubDate></item>`).join('\n');
  const feed = `<?xml version="1.0" encoding="utf-8"?><rss version="2.0"><channel><title>The Arab Side Videos</title><link>${base}</link>${feedItems}</channel></rss>`;
  fs.writeFileSync(path.join(OUT,'feed.xml'),feed,'utf8');

  console.log('Done! Generated', videos.length,'videos.');
})();

