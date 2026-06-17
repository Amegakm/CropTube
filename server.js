import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { spawn, execSync } from 'child_process';
import axios from 'axios';
import ffmpegStatic from 'ffmpeg-static';

// Initialize __dirname for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Resolves the best ffmpeg binary.
 * Priority: system ffmpeg (via PATH) > ffmpeg-static npm bundle.
 * ffmpeg-static can segfault (exit code -11) on some Linux environments
 * (e.g. Render.com) when processing HLS/m3u8 streams, so always prefer
 * the OS-installed binary when available.
 */
function resolveFFmpegPath() {
  try {
    const sysPath = execSync(process.platform === 'win32' ? 'where ffmpeg' : 'which ffmpeg')
      .toString().trim().split('\n')[0].trim();
    if (sysPath) {
      console.log(`[Auto-Setup] System ffmpeg found at: ${sysPath} — using system binary.`);
      return sysPath;
    }
  } catch (_) { /* not in PATH */ }

  if (ffmpegStatic) {
    console.log(`[Auto-Setup] Falling back to ffmpeg-static bundle: ${ffmpegStatic}`);
    // Add the static binary dir to PATH so child processes (yt-dlp) can find it
    const staticDir = path.dirname(ffmpegStatic);
    process.env.PATH = `${staticDir}${path.delimiter}${process.env.PATH}`;
    return ffmpegStatic;
  }

  throw new Error('ffmpeg not found on this system. Install it with: apt-get install -y ffmpeg');
}

const resolvedFFmpegPath = resolveFFmpegPath();
// Ensure yt-dlp can find ffmpeg no matter how it's invoked
process.env.FFMPEG_BINARY = resolvedFFmpegPath;

const app = express();
const PORT = process.env.PORT || 3001;

// Middlewares
app.use(cors());
app.use(express.json());

// Set up paths
const binDir = path.join(__dirname, 'bin');
const tempDir = path.join(__dirname, 'temp');
const isWindows = process.platform === 'win32';
const ytdlpFilename = isWindows ? 'yt-dlp.exe' : 'yt-dlp';
const localYtdlpPath = path.join(binDir, ytdlpFilename);
const globalCookiePath = path.join(binDir, 'global_cookies.txt');

// Create necessary folders
if (!fs.existsSync(binDir)) {
  try {
    fs.mkdirSync(binDir, { recursive: true });
    console.log(`[Initialization] Created bin directory at: ${binDir}`);
  } catch (err) {
    console.error(`[Initialization] Failed to create bin directory:`, err);
  }
}
if (!fs.existsSync(tempDir)) {
  try {
    fs.mkdirSync(tempDir, { recursive: true });
    console.log(`[Initialization] Created temp directory at: ${tempDir}`);
  } catch (err) {
    console.error(`[Initialization] Failed to create temp directory:`, err);
  }
}

/**
 * Checks if yt-dlp is available and runs successfully in the system PATH
 */
function checkYtdlpInPath() {
  try {
    const cmd = isWindows ? 'where yt-dlp' : 'which yt-dlp';
    const output = execSync(cmd).toString().trim().split('\r\n')[0];
    if (!output) return false;
    
    // Verify it actually runs successfully without exit codes
    execSync(`"${output}" --version`, { stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Downloads the latest yt-dlp standalone binary
 */
async function downloadYtdlp(targetPath) {
  const binDirectory = path.dirname(targetPath);
  if (!fs.existsSync(binDirectory)) {
    fs.mkdirSync(binDirectory, { recursive: true });
  }

  let downloadUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
  if (!isWindows) {
    if (process.platform === 'darwin') {
      downloadUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos';
    } else {
      downloadUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';
    }
  }

  console.log(`[Auto-Setup] Downloading yt-dlp binary from ${downloadUrl}...`);
  
  const writer = fs.createWriteStream(targetPath);
  const response = await axios({
    url: downloadUrl,
    method: 'GET',
    responseType: 'stream'
  });

  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on('finish', () => {
      if (!isWindows) {
        fs.chmodSync(targetPath, '755'); // Make executable
      }
      console.log('[Auto-Setup] yt-dlp binary downloaded successfully.');
      resolve();
    });
    writer.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Resolves the path to the yt-dlp executable (system or local)
 */
async function resolveYtdlpPath() {
  if (checkYtdlpInPath()) {
    console.log('[Auto-Setup] Valid yt-dlp found in system PATH.');
    return 'yt-dlp';
  }

  if (fs.existsSync(localYtdlpPath)) {
    try {
      execSync(`"${localYtdlpPath}" --version`, { stdio: 'ignore' });
      console.log(`[Auto-Setup] Valid yt-dlp found locally at: ${localYtdlpPath}`);
      return localYtdlpPath;
    } catch (e) {
      console.log(`[Auto-Setup] Local yt-dlp at ${localYtdlpPath} is broken or failed execution. Purging and re-downloading...`);
      try {
        fs.unlinkSync(localYtdlpPath);
      } catch (unlinkErr) {}
    }
  }

  console.log('[Auto-Setup] Valid yt-dlp not found. Initiating automatic download of standalone release...');
  try {
    await downloadYtdlp(localYtdlpPath);
    return localYtdlpPath;
  } catch (error) {
    console.error('[Auto-Setup] Failed to download yt-dlp binary:', error);
    throw new Error('yt-dlp is not available and could not be downloaded automatically.');
  }
}

// ----------------------------------------------------
// API ROUTES
// ----------------------------------------------------

// GET /api/search: Search YouTube videos using yt-dlp
app.get('/api/search', async (req, res) => {
  const { q } = req.query;
  if (!q) {
    return res.status(400).json({ error: 'Missing search query.' });
  }

  let ytdlpCmd;
  try {
    ytdlpCmd = await resolveYtdlpPath();
  } catch (err) {
    return res.status(500).json({ error: `Dependency Resolution Error: ${err.message}` });
  }

  // Use ytsearch5 to get top 5 results quickly
  const args = [
    `ytsearch5:${q}`,
    '--flat-playlist',
    '--dump-single-json',
    '--no-playlist',
    '--no-warnings',
    '--no-check-formats',
    '--extractor-args', 'youtube:skip=hls,dash,player,configs'
  ];

  if (fs.existsSync(globalCookiePath)) {
    args.push('--cookies', globalCookiePath);
  }

  console.log(`[Search] Executing search for query: "${q}"`);

  const child = spawn(ytdlpCmd, args, {
    env: { ...process.env, PYTHONUNBUFFERED: '1' }
  });
  let stdoutData = '';
  let stderrData = '';

  child.stdout.on('data', (data) => {
    stdoutData += data.toString();
  });

  child.stderr.on('data', (data) => {
    stderrData += data.toString();
  });

  child.on('close', (code) => {
    if (code !== 0) {
      console.error(`[Search] yt-dlp search failed with exit code ${code}: ${stderrData}`);
      return res.status(500).json({ error: 'Search failed. Please try again.' });
    }

    try {
      const parsed = JSON.parse(stdoutData);
      const entries = (parsed.entries || []).map(entry => ({
        id: entry.id,
        url: entry.url || `https://www.youtube.com/watch?v=${entry.id}`,
        title: entry.title,
        duration: entry.duration,
        uploader: entry.uploader,
        thumbnails: entry.thumbnails || []
      }));
      res.json({ entries });
    } catch (parseErr) {
      console.error('[Search] Failed to parse search JSON:', parseErr);
      res.status(500).json({ error: 'Failed to process search results.' });
    }
  });
});

// GET /api/formats: Get available resolutions and formats for a YouTube video
app.get('/api/formats', async (req, res) => {
  const { url } = req.query;
  if (!url) {
    return res.status(400).json({ error: 'Missing video URL.' });
  }

  let ytdlpCmd;
  try {
    ytdlpCmd = await resolveYtdlpPath();
  } catch (err) {
    return res.status(500).json({ error: `Dependency Resolution Error: ${err.message}` });
  }

  const args = [
    '--ignore-config',
    '--dump-single-json',
    '--skip-download',
    '--no-warnings',
    '--no-playlist',
    '--js-runtimes', `node:${process.execPath}`,
    '--impersonate', 'chrome',
    '--cache-dir', path.join(tempDir, 'cache'),
    '--remote-components', 'ejs:github'
  ];

  if (fs.existsSync(globalCookiePath)) {
    args.push('--cookies', globalCookiePath);
  }

  args.push(url);

  console.log(`[Formats] Fetching formats for: "${url}"`);

  const child = spawn(ytdlpCmd, args, {
    env: { ...process.env, PYTHONUNBUFFERED: '1', HOME: tempDir, XDG_CACHE_HOME: tempDir }
  });
  let stdoutData = '';
  let stderrData = '';

  child.stdout.on('data', (data) => {
    stdoutData += data.toString();
  });

  child.stderr.on('data', (data) => {
    stderrData += data.toString();
  });

  child.on('close', (code) => {
    if (code !== 0) {
      console.error(`[Formats] yt-dlp failed with exit code ${code}: ${stderrData}`);
      return res.status(500).json({ error: 'Failed to retrieve video formats.' });
    }

    try {
      const parsed = JSON.parse(stdoutData);
      const formats = parsed.formats || [];
      
      const videoFormats = formats.filter(f => f.vcodec !== 'none' && f.height);
      const audioFormats = formats.filter(f => f.acodec !== 'none' && f.vcodec === 'none');

      const heights = Array.from(new Set(videoFormats.map(f => f.height)))
        .sort((a, b) => b - a);

      const videoExts = Array.from(new Set(videoFormats.map(f => f.ext))).filter(e => e === 'mp4' || e === 'mkv' || e === 'webm');
      const audioExts = Array.from(new Set(audioFormats.map(f => f.ext))).filter(e => e === 'mp3' || e === 'm4a' || e === 'opus');

      res.json({
        title: parsed.title,
        duration: parsed.duration,
        heights: heights.map(h => `${h}p`),
        videoFormats: videoExts.length > 0 ? videoExts : ['mp4', 'mkv'],
        audioFormats: audioExts.length > 0 ? audioExts : ['mp3', 'm4a']
      });
    } catch (parseErr) {
      console.error('[Formats] Failed to parse JSON:', parseErr);
      res.status(500).json({ error: 'Failed to process format list.' });
    }
  });
});

// Active extraction jobs registry
const activeJobs = new Map();

// Step 1: Initiate job, cache parameters, write temporary cookie file if provided
app.post('/api/extract/initiate', (req, res) => {
  try {
    const { url, start, end, format, quality, cookies } = req.body;

    if (!url || !start || !end) {
      return res.status(400).json({ error: 'Missing required parameters: url, start, end timestamps.' });
    }

    const fileId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const cookiePath = path.join(tempDir, `cookies_${fileId}.txt`);
    let hasCookies = false;

    if (cookies && cookies.trim()) {
      try {
        fs.writeFileSync(cookiePath, cookies.trim(), 'utf8');
        hasCookies = true;
        console.log(`[Cookies] Cached temporary Netscape cookie file for Job: ${fileId}`);
      } catch (err) {
        console.error('[Cookies] Failed to write temporary cookie file:', err);
        return res.status(500).json({ error: 'Failed to register authentication cookies on server.' });
      }
    }

    // Register job
    activeJobs.set(fileId, {
      url,
      start,
      end,
      format: format || 'mp4',
      quality,
      hasCookies,
      cookiePath
    });

    // Automatically expire job parameters after 5 minutes to prevent memory leaks
    setTimeout(() => {
      if (activeJobs.has(fileId)) {
        const job = activeJobs.get(fileId);
        if (job.hasCookies && fs.existsSync(job.cookiePath)) {
          try { fs.unlinkSync(job.cookiePath); } catch (e) {}
        }
        activeJobs.delete(fileId);
      }
    }, 5 * 60 * 1000);

    return res.json({ fileId });
  } catch (err) {
    console.error('[Initiate] Unexpected error:', err);
    return res.status(500).json({ error: `Internal server error: ${err.message}` });
  }
});

// Step 2: Stream logs via SSE using the cached job settings
app.get('/api/extract/stream', async (req, res) => {
  const { fileId } = req.query;

  // Set headers for Server-Sent Events (SSE)
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable Nginx/Render proxy buffering
  res.flushHeaders();

  // Send SSE keepalive pings every 20 seconds.
  // Render's load balancer silently kills SSE connections that go idle.
  // SSE spec allows ':' comment lines as pings — browsers/EventSource ignore them.
  const keepaliveInterval = setInterval(() => {
    if (!res.writableEnded) {
      res.write(': keepalive\n\n');
    }
  }, 20000);

  const logToClient = (type, message) => {
    res.write(`data: ${JSON.stringify({ type, message })}\n\n`);
  };
  logToClient('log', '⚡ Establishing SSE tunnel with CropTube extraction backend...');

  if (!fileId || !activeJobs.has(fileId)) {
    logToClient('error', 'Job expired or invalid session ID. Please re-initiate extraction.');
    return res.end();
  }

  const job = activeJobs.get(fileId);
  const { url, start, end, format, quality, hasCookies, cookiePath } = job;

  // Basic validation of start/end format
  const timeRegex = /^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;
  if (!timeRegex.test(start) || !timeRegex.test(end)) {
    logToClient('error', 'Timestamps must be formatted exactly as HH:MM:SS.');
    return res.end();
  }

  let ytdlpCmd;
  try {
    ytdlpCmd = await resolveYtdlpPath();
  } catch (err) {
    logToClient('error', `Dependency Resolution Error: ${err.message}`);
    return res.end();
  }

  const targetFormat = format || 'mp4';
  const isAudio = targetFormat === 'mp3' || targetFormat === 'm4a' || targetFormat === 'opus' || targetFormat === 'webm-audio';
  let outputFilename = `croptube_${fileId}.${targetFormat === 'webm-audio' ? 'webm' : targetFormat}`;
  const outputPath = path.join(tempDir, outputFilename);

  // Map quality constraints.
  // CRITICAL RULES for cloud-safe stream-copy:
  //   [vcodec^=avc1]             → ONLY H.264 video. Blocks AV1 (av01/format 401) and VP9.
  //                                AV1 at 4K forces a full CPU transcode (av1→h264) which takes
  //                                minutes and times out Render's SSE connection.
  //   [protocol!=m3u8]           → Blocks HLS streams that crash ffmpeg-static (exit code -11).
  //   With H.264 + -c:v copy, ffmpeg just cuts and remuxes — no encode, near-instant.
  const noHLS = '[protocol!=m3u8][protocol!=m3u8_native]';
  const h264Only = '[vcodec^=avc1]'; // Must be H.264 for stream-copy to work
  let formatSelector;
  if (isAudio) {
    formatSelector = `ba${noHLS}/ba`;
  } else if (quality === '4K' || quality === '2160p') {
    // 4K requires VP9/AV1 since YouTube does not offer H.264 at resolutions above 1080p
    formatSelector = `bv*[height<=2160]${noHLS}+ba${noHLS}/b[height<=2160]${noHLS}`;
  } else if (quality === '2K' || quality === '1440p') {
    // 2K/1440p requires VP9/AV1
    formatSelector = `bv*[height<=1440]${noHLS}+ba${noHLS}/b[height<=1440]${noHLS}`;
  } else {
    // Quality resolutions e.g. '1080p', '720p', '480p', '360p'
    const h = parseInt(quality) || 1080;
    formatSelector = `bv*[height<=${h}][ext=mp4]${h264Only}${noHLS}+ba[ext=m4a]${noHLS}/bv*[height<=${h}]${h264Only}${noHLS}+ba${noHLS}/b[height<=${h}]${noHLS}`;
  }

  // Build arguments list
  const isTranscode = !isAudio && ['1080p', '720p', '480p', '360p'].includes(quality);
  const postprocessorArgs = isTranscode
    ? 'ffmpeg:-c:v libx264 -preset ultrafast -crf 23 -c:a aac -loglevel warning'
    : 'ffmpeg:-c copy -avoid_negative_ts make_zero -loglevel warning';

  const args = [
    '--ignore-config',
    '--download-sections', `*${start}-${end}`,
    // Use Node.js JS runtime for yt-dlp's JS challenge solver
    '--js-runtimes', `node:${process.execPath}`,
    '--impersonate', 'chrome',
    '--cache-dir', path.join(tempDir, 'cache'),
    '--remote-components', 'ejs:github',
    '--newline',
    '--progress',
  ];

  if (isAudio) {
    args.push('-x');
    if (targetFormat === 'm4a') {
      args.push('--audio-format', 'm4a');
    } else if (targetFormat === 'webm-audio') {
      args.push('--audio-format', 'webm');
    } else {
      const bitrate = quality.replace('audio-', '').split('-')[0] || '192';
      args.push('--audio-format', targetFormat);
      args.push('--audio-quality', `${bitrate}K`);
    }
  } else {
    args.push('--postprocessor-args', postprocessorArgs);
  }

  // Add cookies if available (treats them as additive, not required)
  if (hasCookies) {
    args.push('--cookies', cookiePath);
    logToClient('log', '🍪 Session cookies loaded (additive auth boost)...');
  } else if (fs.existsSync(globalCookiePath)) {
    args.push('--cookies', globalCookiePath);
    logToClient('log', '🍪 Pre-registered server-side cookies loaded (additive auth boost)...');
  }

  // Explicitly tell yt-dlp which ffmpeg binary to use — avoids it picking up a broken
  // or missing ffmpeg and also ensures our resolved (system > static) binary is used
  args.push('--ffmpeg-location', resolvedFFmpegPath);

  args.push('-f', formatSelector);
  
  if (!isAudio) {
    args.push('--merge-output-format', targetFormat);
  }

  args.push(
    '--no-playlist',
    // Prefer DASH streams over HLS (m3u8). HLS streams (format 96) sent by TV client
    // require ffmpeg to handle live-segment stitching which can crash ffmpeg-static.
    '--compat-options', 'no-youtube-prefer-utc-upload-date',
    url,
    '-o', outputPath
  );

  logToClient('log', `🎬 Initiating surgical stream-seek for duration [${start} to ${end}]`);
  logToClient('log', `🚀 Executing: yt-dlp --download-sections "*${start}-${end}" -f "${formatSelector}" --postprocessor-args "${postprocessorArgs}" [URL]`);

  const child = spawn(ytdlpCmd, args, {
    env: { ...process.env, PYTHONUNBUFFERED: '1', HOME: tempDir, XDG_CACHE_HOME: tempDir }
  });

  child.stdout.on('data', (data) => {
    const lines = data.toString().split('\n');
    lines.forEach(line => {
      const trimmed = line.trim();
      if (trimmed) {
        logToClient('log', trimmed);
      }
    });
  });

  child.stderr.on('data', (data) => {
    const lines = data.toString().split('\n');
    lines.forEach(line => {
      const trimmed = line.trim();
      if (trimmed) {
        logToClient('log', `[Warning/Stderr] ${trimmed}`);
      }
    });
  });

  const cleanupAll = () => {
    clearInterval(keepaliveInterval);
    if (hasCookies && fs.existsSync(cookiePath)) {
      try {
        fs.unlinkSync(cookiePath);
        console.log(`[Cleanup] Deleted temporary Netscape cookie file for Job: ${fileId}`);
      } catch (unlinkErr) {
        console.error('[Cleanup] Failed to delete temporary cookie file:', unlinkErr);
      }
    }
    activeJobs.delete(fileId);
  };

  child.on('error', (err) => {
    logToClient('error', `Process execution failed: ${err.message}`);
    cleanupAll();
    res.end();
  });

  child.on('close', (code) => {
    if (code === 0 && fs.existsSync(outputPath)) {
      logToClient('log', '✅ Stream cutting & output merging completed successfully!');
      logToClient('complete', { fileId, filename: outputFilename });
    } else {
      logToClient('error', `yt-dlp process terminated with exit code: ${code}. Check logs above for details.`);
    }
    cleanupAll();
    res.end();
  });

  // If the user aborts/closes the page, terminate the spawned yt-dlp process
  req.on('close', () => {
    if (child && !child.killed) {
      console.log(`[Abort] SSE client disconnected. Terminating child process PID: ${child.pid}`);
      child.kill('SIGKILL');
    }
    cleanupAll();
  });
});

// Check if global pre-registered cookies exist
app.get('/api/settings/cookies/check', (req, res) => {
  const exists = fs.existsSync(globalCookiePath);
  res.json({ hasGlobalCookies: exists });
});

// Save global cookies permanently on the server
app.post('/api/settings/cookies', (req, res) => {
  const { cookies } = req.body;
  if (!cookies || !cookies.trim()) {
    return res.status(400).json({ error: 'Cookies content cannot be empty.' });
  }

  try {
    fs.writeFileSync(globalCookiePath, cookies.trim(), 'utf8');
    console.log('[Settings] Pre-registered global server-side cookies file successfully.');
    res.json({ success: true });
  } catch (err) {
    console.error('[Settings] Failed to write global cookies file:', err);
    res.status(500).json({ error: `Failed to write cookies file on server: ${err.message}` });
  }
});

// Delete global cookies from the server
app.delete('/api/settings/cookies', (req, res) => {
  try {
    if (fs.existsSync(globalCookiePath)) {
      fs.unlinkSync(globalCookiePath);
      console.log('[Settings] Deleted pre-registered global server-side cookies file.');
    }
    res.json({ success: true });
  } catch (err) {
    console.error('[Settings] Failed to delete global cookies file:', err);
    res.status(500).json({ error: `Failed to purge cookies file on server: ${err.message}` });
  }
});

// Download Endpoint - Downloads clip then immediately cleans it up
app.get('/api/download/:fileId', (req, res) => {
  const { fileId } = req.params;

  if (!fs.existsSync(tempDir)) {
    return res.status(404).send('Error: Clip file not found or has already been deleted.');
  }

  const files = fs.readdirSync(tempDir);
  const matchedFile = files.find(f => f.startsWith(`croptube_${fileId}`));

  if (!matchedFile) {
    return res.status(404).send('Error: Clip file not found or has already been deleted.');
  }

  const filePath = path.join(tempDir, matchedFile);
  const ext = path.extname(matchedFile);

  console.log(`[Delivery] Serving file to client: ${filePath}`);
  
  res.download(filePath, `CropTube_Clip_${fileId}${ext}`, (err) => {
    if (err) {
      console.error(`[Delivery] Error downloading file:`, err);
    }
    // Delete file immediately after response closes
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`[Delivery] Surgically purged temporary file: ${filePath}`);
      }
    } catch (unlinkErr) {
      console.error('[Delivery] Error deleting file:', unlinkErr);
    }
  });
});

// ----------------------------------------------------
// PRODUCTION static assets
// ----------------------------------------------------
const isProduction = process.env.NODE_ENV === 'production' || fs.existsSync(path.join(__dirname, 'dist'));
if (isProduction) {
  console.log('[System] Production assets detected. Serving static React client.');
  app.use(express.static(path.join(__dirname, 'dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  });
}

// Start Server
app.listen(PORT, async () => {
  console.log(`=================================================`);
  console.log(`  CropTube Backend Server running on port ${PORT}`);
  console.log(`=================================================`);
  try {
    // Proactively resolve/download yt-dlp on startup
    await resolveYtdlpPath();
  } catch (err) {
    console.error(`[Initialization WARNING] Auto-setup of yt-dlp failed: ${err.message}`);
  }
});
