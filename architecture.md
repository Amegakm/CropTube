# CropTube System Architecture

This document outlines the detailed system architecture, processing sequences, and component dependencies of CropTube.

---

## 1. System Map

```
+------------------+             (Virtual Toggles)
|   React Client   | <========================================+
|  (Vite Dev Port) |                                          |
+--------+---------+                                          |
         |                                                    |
         | (HTTP Proxy / API)                                 |
         v                                                    v
+------------------+         (Reads Env)       +------------------------------+
|  Express Server  | ------------------------> | Telegram Monitoring Channel  |
|   (Port 3001)    |                           |     (Error Alerts Bot)       |
+--------+---------+                           +------------------------------+
         |
         | (Spawns Child Processes)
         v
+------------------+          (Streams Output)         +----------------------+
|  yt-dlp Engine   | ================================> | ffmpeg Slicing Engine|
| (Cookie payload) |                                   | (-c copy Stream Copy)|
+--------+---------+                                   +----------+-----------+
         |                                                        |
         | (DUMP JSON Metadata)                                   | (Saves Part)
         v                                                        v
+------------------+                                   +----------------------+
| formats.json API |                                   |  temp/croptube_[id]  |
|  Response Cache  |                                   |  (Cleaned up on DL)  |
+------------------+                                   +----------------------+
```

---

## 2. Media Slicing Sequence (Data Flow)

When a user selects a clip region and starts extraction, the following end-to-end data pipeline is executed:

```
[User Clicks Extract]
         |
         v
1. React frontend invokes POST /api/extract/initiate with timestamps, URL, and format.
         |
         v
2. Express server validates parameters, maps quality, and creates a unique `fileId` job token.
         |
         v
3. React opens a Server-Sent Events (SSE) connection to GET /api/extract/stream?fileId=xxx.
         v
4. Express locates the active job and spawns `yt-dlp` as a child process using the parameters:
   - `--download-sections "*00:01:00-00:02:00"` (Instructs yt-dlp to only fetch manifest chunks for that offset).
   - `--ffmpeg-args` are applied to copy streams without transcoding (`-c copy`).
         |
         v
5. As `yt-dlp` runs, stdout and stderr buffers are parsed.
   - Progress lines (e.g. `[download] 50%`) are extracted and pushed to the client via SSE (`data: { type: 'progress', ... }`).
   - Diagnostic errors or logs are output to the server console.
         |
         v
6. yt-dlp saves the sliced clip to `temp/croptube_[fileId].[ext]`.
         |
         v
7. The server calculates the final file resolution via `ffprobe` and pushes a `completed` SSE event to the client.
         |
         v
8. The React client intercepts the completed event and redirects to GET /api/download/[fileId] to download the clip.
         |
         v
9. The backend streams the file to the client and deletes the file from disk immediately.
```

---

## 3. Persistent Storage and File Lifecycles
Because CropTube is deployed to cloud instances with ephemeral filesystems (like Render.com), proper folder mounts are critical:
- **`bin/` directory**: Mounted on Render as a persistent network disk volume (`croptube-storage`) so that users' uploaded YouTube cookies (`global_cookies.txt`) survive server restarts and code updates.
- **`temp/` directory**: Kept inside ephemeral local storage. This is highly suitable since downloads are cleaned up instantly after completion, ensuring the local disk does not overflow.
