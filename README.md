# ✂️ CropTube

> **Surgically extract and download exact clip ranges from YouTube — without downloading the full video.**

CropTube is a private, lightweight web app that lets you paste a YouTube link, preview it in-browser, set start/end markers by clicking while the video plays, and download only that precise clip at high quality.

---

## ✨ Features

- 🎬 **Embedded YouTube preview** — play the video and grab timestamps live with one click
- ✂️ **Surgical stream-seeking** — uses `yt-dlp --download-sections` to only pull the bytes you need
- 🔊 **Audio sync fix** — re-encodes audio to AAC during merge to eliminate drift
- 🍪 **Cloud cookie auth** — register your YouTube session cookies once, works from any device (phone, tablet)
- 📦 **Auto-cleanup** — downloaded clip is served then immediately deleted from server disk
- 📡 **Real-time terminal logs** — live SSE stream shows yt-dlp output as it runs
- 🤖 **Zero-config yt-dlp** — auto-downloads the latest yt-dlp binary if missing

---

## 🚀 Local Setup (1-command)

```bash
npm install
npm run dev
```

Then open **http://localhost:5173**

> **Requirements:** Node.js 18+, ffmpeg in PATH (or install via `choco install ffmpeg` / `brew install ffmpeg`)

---

## ☁️ Deploy to Render (Free)

1. Push this repo to GitHub
2. Go to [render.com](https://render.com) → **New Web Service** → connect your repo
3. Render will auto-detect `render.yaml` and configure everything
4. After deploy, open the app → **Cloud Auth Settings** → paste your YouTube cookies → **Register to Cloud Server**

---

## 🍪 Getting YouTube Cookies (for cloud auth)

Cloud servers get bot-challenged by YouTube. Fix it in 30 seconds:

1. Install **[Get cookies.txt LOCALLY](https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc)** Chrome extension
2. Open **youtube.com** while logged in to your Google account
3. Click the extension → **Export** → copy all the text
4. In CropTube → expand **Cloud Auth Settings** → paste → click **Register to Cloud Server**
5. Done! All future extractions (even from your phone) will use these cookies.

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js + Express |
| Frontend | React + Vite + Tailwind CSS |
| Extraction | yt-dlp (auto-downloaded) |
| Merging | ffmpeg-static |
| Streaming | Server-Sent Events (SSE) |

---

## 📁 Project Structure

```
CropTube/
├── server.js          # Express backend (SSE, yt-dlp, download)
├── src/
│   ├── App.jsx        # React UI (YouTube player, timeline, terminal)
│   ├── index.css      # Global styles
│   └── main.jsx       # Entry point
├── render.yaml        # Render deployment config
├── vite.config.js     # Vite + API proxy config
└── package.json       # Scripts and dependencies
```

---

*CropTube — Personal tool. Auto-cleanup immediately destroys server storage on delivery.*
