# The Arab Side — Automated YouTube Website

This repository hosts a fully automated static website that:
- Auto-imports latest YouTube videos from channel `UCc1kt6tGYTGLzYLeT560a8A`
- Generates `videos.json`, `sitemap.xml`, and per-video blog pages under `/posts/<slug>/`
- Updates `index.html` OpenGraph metadata
- Runs automatically via GitHub Actions (every 12 hours) and on demand

## Setup
1. Replace `https://YOUR-SITE-URL/` placeholders in `.github/workflows/auto-build.yml` and other files with your real site URL (e.g. `https://ayaan857.github.io/The_Arab_Side.github.io/`).
2. (Optional) Add `YT_API_KEY` repository secret in GitHub if you want richer metadata from YouTube Data API.
3. Commit & push all files to GitHub.
4. Enable GitHub Pages in repository settings, point to the main branch root.
5. Optionally run the workflow manually (Actions → Auto Build & Publish → Run workflow).

## Files of interest
- `index.html`, `styles.css`, `script.js` — front-end
- `generate-all.js` — builds `videos.json`, `sitemap.xml`, updates OG meta
- `generate-posts.js` — generates `/posts/<slug>/index.html` from `post-template.html`
- `.github/workflows/auto-build.yml` — automation
