# CropTube Codebase Intelligence Memory

This document serves as the permanent brain of the CropTube project. It provides all necessary details to understand the business context, technical architecture, routing, APIs, and development workflows.

---

## 1. Project Overview & Business Purpose
CropTube is a lightweight, responsive web application built to surgically extract and download short clips/slices from YouTube videos. 

### Why It Exists
Downloading full high-definition (1080p, 1440p, or 4K) videos only to cut a 5-second or 1-minute clip is computationally expensive, wasteful of network bandwidth, and time-consuming. CropTube solves this by leveraging `yt-dlp` and `ffmpeg` to stream and cut clips directly from the source HLS/DASH manifest URLs without downloading the entire source video file.

### Major Features
- **Direct Search**: Search YouTube videos using text queries directly in the UI.
- **Dynamic Format Parsing**: Fetches all available audio/video formats, codecs, and resolutions (from 144p to 4K / 2160p) for any valid YouTube URL.
- **Aspect-Ratio-Aware Quality Mappings**: Correctly identifies cinematic aspect ratios (e.g. 3840x1608 as 2160p) and vertical formats (Shorts) without resolution downgrades.
- **Auth Cookie Integration**: Protects against YouTube bot detection on datacenter/cloud IPs by allowing users to register YouTube authentication cookies in the settings.
- **SSE Job Streaming**: Displays real-time stdout extraction logs and progress percentages via Server-Sent Events (SSE).
- **Hardened Monitoring**: Sends sanitised error logs to a Telegram bot channel for live production debugging.

---

## 2. Tech Stack
The project is structured as a Single Page Application (SPA) with a lightweight Node.js/Express backend:

| Layer | Technology |
|---|---|
| **Frontend Framework** | React (Vite-powered SPA, React Hooks) |
| **Backend Framework** | Node.js with Express |
| **Styling** | Vanilla CSS (written in `src/index.css`) + Tailwind CSS utilities |
| **Icons** | Lucide React |
| **Slicing & Extraction** | `yt-dlp` (Python CLI tool called as child processes) |
| **Media Processing** | `ffmpeg` (leveraged via npm `ffmpeg-static` or system binary) |
| **State Management** | React Local State (`useState`) + Context / Prop drilling |
| **Deployment** | Docker on Render.com with attached persistent disk storage |

---

## 3. Repository Structure
```
CropTube/
├── .dockerignore
├── .gitignore
├── Dockerfile                   # Builds Node image & installs Python/yt-dlp/ffmpeg
├── README.md
├── index.html                   # Entry point for Vite React app
├── package.json
├── package-lock.json
├── postcss.config.js
├── tailwind.config.js
├── vite.config.js               # Proxies `/api` requests to localhost:3001
├── render.yaml                  # Render deployment configuration (mounts persistent disk)
├── server.js                    # Express API server + extraction execution pipeline
├── bin/                         # Local binaries and persistence directory
│   ├── global_cookies.txt       # Saved YouTube cookies (git-ignored)
│   └── yt-dlp.exe               # Local yt-dlp executable (development fallback)
├── src/                         # React Frontend SPA code
│   ├── main.jsx                 # Entry point
│   ├── index.css                # Base stylesheet with UI themes
│   └── App.jsx                  # Main UI layout, search, time selectors, & SSE connection
└── temp/                        # Temp working directory for active extractions
    └── cache/                   # Cache folder for yt-dlp player signatures
```

---

## 4. System Architecture
```
+-------------------------------------------------------+
|                    React Client                       |
|  - App.jsx UI Components                              |
|  - Time Selection (Start/End)                         |
|  - Quality Dropdown Selector                          |
+--------------------------+----------------------------+
                           |
            HTTP / SSE API | (Proxied in Development)
                           v
+-------------------------------------------------------+
|                   Express Backend                     |
|  - server.js Endpoints                                |
|  - Active Job Map (In-Memory Tracking)                |
+--------------------------+----------------------------+
                           |
                           v  (Spawn child processes)
+-------------------------------------------------------+
|                    CLI Utilities                      |
|  - yt-dlp: Stream manifests & apply time offsets      |
|  - ffmpeg: Slice and merge video + audio streams      |
+-------------------------------------------------------+
```

---

## 5. Routing Map
CropTube is designed as a client-side SPA. Page switching is handled virtual-style through React conditional rendering rather than a client-side router (like react-router). 

### Virtual Pages (SPA Layouts)
1. **Landing/SaaS Page**: URL input field, Search bar, Feature grids, and Hero section.
2. **Extractor Dashboard**: Activated once a valid video URL is parsed. Exposes the YouTube embed player, Start/End clip grabbers, format quality dropdown selector, and log output console.
3. **Modal Views**: Overlays for **About**, **Works**, **Services**, **Docs & Guide**, **Privacy Policy**, and **Terms of Service**.

---

## 6. Frontend Architecture
The UI is contained inside `src/App.jsx`.
- **`App` Component**: Holds all global states (video URL, player instances, available resolutions, extraction status, and cookie state).
- **`TimeMarker` Component**: Custom input component representing a single `HH:MM:SS` duration field. Includes:
  - Focus tracking (`inputRef`) to decouple parent prop updates during active typing.
  - Formats inputs on `onBlur`.
  - Action buttons: "Grab" (pull current player playback time) and "Seek" (jump player to the designated timestamp).

---

## 7. Backend Architecture
The backend resides entirely in `server.js` and coordinates the system:
- **Auto-Setup Engine**: Automatically checks for system-wide `ffmpeg`/`ffprobe` and falling back to NPM `ffmpeg-static` if needed. Ensures `yt-dlp` has correct execution permissions.
- **Temporary Cookie Manager**: Writes job-specific cookie files to disk when initiating extractions and cleans them up immediately on job completion.
- **In-Memory Job Store**: Caches active jobs in a global `activeJobs` Map (`fileId` -> job parameters).
- **Log Streaming Pipeline**: Reads standard output and error buffers of spawned child processes and pipes them directly to the user as Server-Sent Events (SSE).

---

## 8. Database Architecture
**CropTube does not use a relational or NoSQL database.** 
Instead, it relies on:
1. **In-Memory Maps**:
   - `activeJobs`: Stores pending/ongoing extraction metadata (purged automatically after 15 minutes).
   - `errorCache`: Suppresses duplicate Telegram monitoring alerts by caching hashes of error messages for 10 minutes.
2. **Flat Files (under `bin/` and `temp/`)**:
   - `global_cookies.txt`: Persists registered YouTube cookies.
   - `cookies_[jobId].txt`: Temporary files for netscape credentials during extraction downloads.

---

## 9. Authentication Flow
Authentication is used strictly to authenticate the server requests to YouTube to bypass bot detection.
1. The user pastes Netscape-formatted cookie headers in the **Settings** modal.
2. The frontend sends cookies to `POST /api/settings/cookies`.
3. The server writes cookies to `bin/global_cookies.txt`.
4. Subsequent formats queries and extraction jobs load `global_cookies.txt` and supply it to `yt-dlp` via the `--cookies` argument.

---

## 10. Environment Variables
Stored locally in `.env` and injected into production via Render.com:
- `PORT`: Binds the port for the backend server (defaults to 3001).
- `NODE_ENV`: Defines the node environment (`development` vs `production`).
- `TELEGRAM_BOT_TOKEN`: The bot token for the Telegram monitor bot.
- `TELEGRAM_CHAT_ID`: The personal Telegram user/group ID to receive error alerts.

---

## 11. Known Technical Debt & Known Risks
- **Datacenter IP Blocks**: YouTube aggressively rate-limits or blocks cloud servers (such as Render instances). If cookies expire or are not set, `yt-dlp` extraction will fail.
- **In-Memory Job Storage**: Since active job states are stored in-memory, restarting the backend server will terminate all active extraction pipelines.
- **No Concurrent Request Limit**: Spawning multiple high-resolution extraction jobs simultaneously could overload the host system CPU/RAM due to concurrent `ffmpeg` operations.
