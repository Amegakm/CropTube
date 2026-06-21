# CropTube API Map

This document outlines the input, output, error handling, and parameter validation for the CropTube backend API.

---

## 1. Search Endpoint
- **Route**: `GET /api/search`
- **Controller Logic**: `server.js` (lines 226-282)
- **Input Parameters**:
  - `q` (Query, String, Required) - The search query term.
- **Output Formats**:
  ```json
  {
    "entries": [
      {
        "id": "2zxDvbLH7PQ",
        "url": "https://www.youtube.com/watch?v=2zxDvbLH7PQ",
        "title": "Shorts Upload...",
        "duration": 724,
        "uploader": "Arvind zone",
        "thumbnails": [{"url": "...", "height": 202, "width": 360}]
      }
    ]
  }
  ```
- **Errors**:
  - `400 Bad Request` if `q` is missing: `{ "error": "Missing search query." }`
  - `500 Internal Server Error` if `yt-dlp` fails.

---

## 2. Formats Endpoint
- **Route**: `GET /api/formats`
- **Controller Logic**: `server.js` (lines 285-421)
- **Input Parameters**:
  - `url` (Query, String, Required) - The watch or share YouTube video URL.
- **Output Formats**:
  - Returns metadata and quality classifications derived from `classifyFormatQuality`.
  ```json
  {
    "title": "Costa Rica in 4K",
    "duration": 314,
    "heights": ["2160p", "1440p", "1080p", "720p", "480p", "360p", "240p", "144p"],
    "videoFormats": ["mp4", "webm"],
    "audioFormats": ["m4a"],
    "rawFormats": [
      {
        "format_id": "315",
        "height": 2160,
        "width": 3840,
        "label": "2160p",
        "ext": "webm",
        "vcodec": "vp9",
        "acodec": "none",
        "tbr": 24040.546
      }
    ]
  }
  ```
- **Errors**:
  - `400 Bad Request` if `url` is missing.
  - `403 Forbidden` if YouTube triggers bot verification blocks (instructs to upload cookies).
  - `500 Internal Server Error` if metadata extraction fails.

---

## 3. Clip Slicing & Extraction Pipeline

### Step A: Initiate Job
- **Route**: `POST /api/extract/initiate`
- **Controller Logic**: `server.js` (lines 427-487)
- **Input Parameters**:
  - JSON Body:
    ```json
    {
      "url": "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
      "start": "00:00:01",
      "end": "00:00:04",
      "format": "mp4",
      "quality": "1080p",
      "format_id": "399",
      "cookies": "Netscape-cookie-data-string..."
    }
    ```
- **Output Formats**:
  ```json
  { "fileId": "1782070528818-jer2g9u" }
  ```
- **Errors**:
  - `400 Bad Request` if `url`, `start`, or `end` are missing.
  - `500 Internal Server Error` if temporary cookie file creation fails.

### Step B: SSE Stream Logs
- **Route**: `GET /api/extract/stream`
- **Controller Logic**: `server.js` (lines 490-805)
- **Input Parameters**:
  - `fileId` (Query, String, Required) - The unique file job token.
- **Output Formats**:
  - Streams text logs via EventSource:
    - Status: `data: {"type":"status","message":"Downloading stream..."}`
    - Progress: `data: {"type":"progress","message":{"stage":"Downloading stream...","pct":75}}`
    - Completion: `event: completed \n data: {"success":true}`
- **Errors**:
  - Close connection if `fileId` is invalid or job expired.
  - SSE error pushed if `yt-dlp`/`ffmpeg` fail: `data: {"type":"error","message":"..."}`

### Step C: Download File
- **Route**: `GET /api/download/:fileId`
- **Controller Logic**: `server.js` (lines 927-965)
- **Input Parameters**:
  - `:fileId` (Path Parameter, String, Required) - The completed job ID.
- **Output Formats**:
  - Streams binary video file.
- **Side Effect**:
  - Purges file immediately from the host filesystem upon response close.

---

## 4. Settings & Cookies Configuration
- **Routes**:
  - `POST /api/settings/cookies` - Save cookie string.
  - `DELETE /api/settings/cookies` - Deletes cookie file.
  - `GET /api/settings/cookies/check` - Returns `{ hasGlobalCookies: boolean }`.
