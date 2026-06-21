# CropTube Dependency Graph

This document details the module dependencies and critical execution files in the repository.

---

## 1. System Dependency Tree

```
                  [ index.html ]
                        |
                        v
                  [ src/main.jsx ]
                        |
                        v
                  [ src/App.jsx ]
                   /     |     \
                  /      |      \
     [ src/index.css ]  /        [ Lucide Icons ]
                       v
              [ API Proxy Layer ]
                       |
                       +-------------------+
                       |                   |
                       v                   v
                [ server.js ] <--- [ process.env / .env ]
                 /    |     \
                /     |      \
               v      v       v
      [ yt-dlp ] [ ffmpeg ] [ global_cookies.txt ]
```

---

## 2. File Roles & Descriptions

### A. Critical Core Files (Modify with Extreme Caution)
- **`server.js`**
  - **Role**: Backend Node/Express Server.
  - **Responsibilities**: Runs all HTTP API routes, parses YouTube formats, executes quality classification, triggers sanitised Telegram logs, and coordinates clip downloads.
  - **Dependencies**: `express`, `cors`, `ffmpeg-static`, `child_process` (`spawn`, `execSync`).
- **`src/App.jsx`**
  - **Role**: React Frontend SPA Component.
  - **Responsibilities**: Performs UI rendering, YouTube player lifecycle tracking, start/end clip marker configuration, formats querying, and SSE log display.
  - **Dependencies**: `react`, `lucide-react`, `/api/*` proxies.

### B. Configuration & Build Files
- **`vite.config.js`**
  - Configures React bundler, port bindings (5173), and proxies `/api` calls in development mode to `http://localhost:3001` (to prevent CORS issues).
- **`tailwind.config.js` & `postcss.config.js`**
  - Setup styling compiler utilities.
- **`package.json`**
  - Declares all module dependencies (Express, CORS, React, Lucide, Concurrently) and execution scripts (`dev`, `build`, `start`).
- **`Dockerfile`**
  - Docker deployment script. Sets up node container runtime environment, installs Python, pip, `yt-dlp` executable, and pre-resolves system `ffmpeg`.
