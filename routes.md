# CropTube Routing Intelligence

This document details all client-side layout routes (virtual paths) and backend API endpoints.

---

## 1. Client-Side Virtual Routes (SPA Views)

As CropTube is a single-page React application, page changes are represented as transitions in application state (virtual routes) rather than actual browser page loads.

| Route View | Trigger | Component Section | Purpose | Auth Required |
|---|---|---|---|---|
| **Landing Page** | URL contains no video parameter | `App.jsx` Landing layout | Search YouTube videos, paste standard URL links, and display marketing SaaS features. | No |
| **Extractor Dashboard**| Valid watch/share URL entered | `App.jsx` Dashboard layout | Embeds YouTube iframe player, displays clip slicing selection widgets, and lists formats. | No |
| **Settings Overlay** | Clicking the gear icon in header | `App.jsx` Cookies settings modal | Enter or delete registered YouTube auth cookies. | No |
| **About Modal** | Click "About" in footer/header | `App.jsx` Modal component | Displays details on how CropTube functions. | No |
| **Works Modal** | Click "Works" in footer/header | `App.jsx` Modal component | Displays user guide and extraction workflow diagrams. | No |
| **Services Modal** | Click "Services" in footer/header| `App.jsx` Modal component | Lists platform limits, formats, and advanced capabilities.| No |
| **Docs Modal** | Click "Docs & Guide" in footer | `App.jsx` Modal component | Provides comprehensive troubleshooting and setup guide. | No |
| **Privacy Modal** | Click "Privacy Policy" in footer | `App.jsx` Modal component | Legal privacy policy document. | No |
| **Terms Modal** | Click "Terms of Service" in footer | `App.jsx` Modal component | Legal terms of service document. | No |

---

## 2. Backend Express API Routes

The backend server listens on port `3001` (proxied by Vite server on port `5173` in development mode).

| Method | Route | Purpose | Input / Query Parameters | Response |
|---|---|---|---|---|
| **GET** | `/api/search` | Searches YouTube using `yt-dlp`. | `?q=query` | JSON list of video entries (title, uploader, duration, id). |
| **GET** | `/api/formats` | Retrieves formats & labels for a URL. | `?url=watch_url` | JSON detailing title, duration, video/audio formats, and raw formats. |
| **POST** | `/api/extract/initiate`| Registers and caches a clip job in memory. | JSON body: `url`, `start`, `end`, `format`, `quality`, `format_id` | JSON containing unique `fileId`. |
| **GET** | `/api/extract/stream`| Streams real-time extraction logs (SSE). | `?fileId=job_id` | Text event-stream (pings, status updates, final completion). |
| **GET** | `/api/download/:fileId`| Downloads completed clip from disk. | Param: `:fileId` | Binary file stream (purges clip from disk immediately afterwards). |
| **POST** | `/api/settings/cookies`| Uploads YouTube auth cookies to server. | JSON body: `cookies` | JSON `{ success: true }`. |
| **DELETE**| `/api/settings/cookies`| purges registered global cookies. | None | JSON `{ success: true }`. |
| **GET** | `/api/settings/cookies/check`| Check if global cookies file is configured. | None | JSON `{ hasGlobalCookies: boolean }`. |
| **GET** | `/api/test-telegram-error`| Triggers dummy error alerts (dev-only).| None | JSON `{ success: boolean }`. |
