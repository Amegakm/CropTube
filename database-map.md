# CropTube Database Map

CropTube does not use a relational or document database. Rather, it handles data tracking in memory and uses the server's local file storage for session files.

---

## 1. In-Memory Tracking Data Structures

The backend Express application (`server.js`) utilizes two global JavaScript `Map` structures to manage states:

### A. Active Jobs Store (`activeJobs`)
Tracks metadata for active extraction pipelines from job initiation until client download.

- **Type**: `Map<string, Object>` where Key is `fileId`.
- **Fields**:
  - `url` (String) - The YouTube video URL.
  - `start` (String) - HH:MM:SS start clip offset.
  - `end` (String) - HH:MM:SS end clip offset.
  - `format` (String) - Output file container (mp4, mkv, mp3, m4a, opus).
  - `quality` (String) - User selected quality label (e.g., "1080p", "2160p").
  - `format_id` (String) - Selected video stream format ID from yt-dlp.
  - `hasCookies` (Boolean) - Indicates whether temporary job cookies are loaded.
  - `cookiePath` (String) - Absolute filepath to the cached netscape cookies file.
- **Lifecycle**:
  - Inserted when client calls `POST /api/extract/initiate`.
  - Cleared on job termination/SSE stream closure or automatically cleaned up after **15 minutes** via a `setTimeout` garbage collector to prevent memory leaks.

### B. Error Alerts Cache (`errorCache`)
Suppresses duplicate Telegram notifications to prevent bot API rate-limiting during high failure rates.

- **Type**: `Map<string, number>` where Key is `hash` and Value is `timestamp` (milliseconds).
- **Hash Composition**: `${stage}|${url}|${sanitized_errorMessage}`
- **Lifecycle**:
  - Inserted before sending a Telegram notification.
  - Checks if the exact same sanitized error hash occurred within the last **10 minutes**. If so, the notification is suppressed.

---

## 2. Directory Mappings & Filesystem Stores

| Path | Purpose | Persistence | Mount Configuration |
|---|---|---|---|
| **`/bin`** | Stores `yt-dlp` executables and persistent session credentials. | Persistent | Mounted on Render.com as persistent volume `croptube-storage` to ensure cookie data survives code updates. |
| **`/bin/global_cookies.txt`** | Persists registered global server cookies uploaded in settings. | Persistent | Written to `/bin` volume. |
| **`/temp`** | Holds temporary output video files and short-lived cookie files. | Ephemeral | Local container filesystem (flushed instantly upon completion). |
| **`/temp/cookies_[fileId].txt`** | Short-lived cookie file for a specific extraction job. | Ephemeral | Deleted immediately when `finish()` is triggered in the extraction stream. |
| **`/temp/croptube_[fileId].[ext]`** | Final merged clip ready for download. | Ephemeral | Deleted instantly upon completion of the `GET /api/download/:fileId` response. |
| **`/temp/cache`** | YouTube player client signature cache. | Ephemeral | Kept locally to speed up subsequent format retrievals. |
