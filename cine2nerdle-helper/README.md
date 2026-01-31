# Cine2Nerdle Helper

A training assistant for Cine2Nerdle Battle. Unlike bots that auto-play, this tool shows you connection options and helps you learn movie connections strategically.

## Features

- **Full Cast & Crew**: Shows connections via actors, directors, writers, cinematographers, and composers
- **Smart Ranking**: Ranks connections by filmography depth (more credits = more valuable link)
- **Setup Phase Detection**: Automatically filters to Top 5000 films during the first 3 turns
- **Priority Filters**: Train specific niches like "Horror", "Animation + Sci-Fi", "80s Movies"
- **Link Tracking**: Warns you when a connection is at 2/3 uses
- **Popularity Display**: Shows TMDB popularity score for each film
- **No Auto-Play**: You pick, you learn

## Installation

1. Get a TMDB API key:
   - Go to [TMDB](https://www.themoviedb.org/) and create a free account
   - Go to Settings → API → Create → Request an API key
   - Copy the **"API Read Access Token"** (the long one starting with `eyJ...`), NOT the short API Key

2. Load the extension in Chrome:
   - Open `chrome://extensions`
   - Enable "Developer mode" (top right)
   - Click "Load unpacked"
   - Select the `cine2nerdle-helper` folder

3. Configure:
   - Click the extension icon in Chrome
   - Paste your TMDB Read Access Token
   - Click Save

4. Play:
   - Go to [Cine2Nerdle Battle](https://www.cinenerdle2.app/battle)
   - The helper sidebar appears on the right
   - Set your priority filters to train specific genres

## Priority Filters

Train for Battle 2.0 win conditions by filtering connections:

- Select multiple genres (must match ALL selected)
- Add a decade filter
- Example: "Animation + Sci-Fi + 2000s" shows only animated sci-fi from the 2000s

Priority matches appear at the top with a 🎯 indicator.

## Setup Phase

The first 3 turns of a Classic battle require Top 5000 films. The helper automatically detects this and:

- Shows "⚡ SETUP PHASE" indicator at the top
- Filters out obscure films that won't be accepted
- Displays the TMDB popularity score (📊) for each film so you can learn the threshold

Once the game moves past turn 3, all films become available again.

## How It Works

1. Reads the current movie from the game board
2. Fetches full cast and crew from TMDB
3. For each person, fetches their complete filmography
4. Ranks movies by the connecting person's total filmography size
5. Applies your priority filters
6. Displays options—you choose

## Why Filmography Depth?

A character actor with 200 credits is more valuable than a movie star with 40. More credits = more potential connections = less likely to get stuck.

## Cache

Movie and person data is cached locally to avoid hitting TMDB rate limits. Click "Clear Cache" in the popup if data seems stale.

## Development

This is a plain Chrome extension—no build step required. Just edit the files and reload.

```
cine2nerdle-helper/
├── manifest.json        # Extension config
├── src/
│   ├── background.js    # TMDB API calls (service worker)
│   ├── content-script.js # DOM scraping and UI
│   └── styles.css       # Helper sidebar styles
├── popup/
│   ├── popup.html       # Settings UI
│   └── popup.js         # Settings logic
└── icon.png
```

## Credits

Based on the original [cine2nerdle-bot](https://github.com/pshvarts/cine2nerdle-bot) by Phillip Shvartsman, reimagined as a training tool rather than an auto-player.
