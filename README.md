# ✂️ CropTube

> **Surgically extract and download exact clip ranges from YouTube — without downloading the full video.**

CropTube is a private, lightweight web app that lets you paste a YouTube link, preview it in-browser, set start/end markers by clicking while the video plays, and download only that precise clip at high quality.

---

## ✨ Features

- 🎬 **Embedded YouTube preview** — play the video and grab timestamps live with one click
- ✂️ **Surgical stream-seeking** — uses `yt-dlp --download-sections` to only pull the bytes you need
- 🔊 **Audio sync fix** — re-encodes audio to AAC during merge to eliminate drift
- 🍪 **Cloud cookie auth** — register your YouTube session cookies once in the UI to bypass bot blocks
- 📦 **Auto-cleanup** — downloaded clip is served then immediately deleted from server disk
- 📡 **Real-time terminal logs** — live SSE stream shows yt-dlp output as it runs
- 🐳 **Dockerized deployment** — pre-packages `ffmpeg` and `yt-dlp` for hassle-free cloud hosting

---

## 🚀 Local Setup

### Standard Run:
1. Install dependencies:
   ```bash
   npm install
   ```
2. Start development servers:
   ```bash
   npm run dev
   ```
3. Open **http://localhost:5173**
*(Requires: Node.js 18+, ffmpeg in your system PATH)*

### Docker Run:
Alternatively, you can run the entire setup locally inside Docker:
```bash
docker build -t croptube .
docker run -p 3001:3001 croptube
```
Then open **http://localhost:3001**

---

## ☁️ Deploy to the Cloud (Free)

### Deploying to Render:
1. Push this repository to your GitHub.
2. Go to [Render Dashboard](https://dashboard.render.com/) $\rightarrow$ **New +** $\rightarrow$ **Web Service**.
3. Connect your repository.
4. Set the **Runtime** dropdown to **Docker** (Render will automatically detect the `Dockerfile` at the root).
5. (Optional) If you have a paid tier, add a **Disk** under Advanced Settings mounted at `/app/bin` to keep your cookies saved permanently across restarts. On the Free tier, skip this step.
6. Click **Deploy Web Service**.

### Deploying to Hugging Face Spaces:
1. Create a **New Space** on Hugging Face.
2. Set the SDK to **Docker** (select the Blank template).
3. Push your files to the Space's Git repository. It will automatically build and host the app for free.

---

## 🍪 Getting YouTube Cookies (for cloud auth)

YouTube aggressively blocks cloud IPs (Render, AWS, etc.). You can bypass this in 30 seconds by giving the server your session cookies:

1. Install the **[Get cookies.txt LOCALLY](https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc)** Chrome extension.
2. Open **youtube.com** while logged into your Google account.
3. Click the extension $\rightarrow$ **Export** $\rightarrow$ copy all the text.
4. Open your deployed CropTube website $\rightarrow$ expand **Cloud Auth Settings** at the bottom-right $\rightarrow$ paste the cookies $\rightarrow$ click **Register to Cloud Server**.

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js + Express |
| Frontend | React + Vite + Tailwind CSS |
| Container | Docker (`node:20-bookworm-slim`) |
| Extraction | yt-dlp |
| Merging | ffmpeg |
| Streaming | Server-Sent Events (SSE) |

---

*CropTube — Personal tool. Auto-cleanup immediately destroys server storage on delivery.*
