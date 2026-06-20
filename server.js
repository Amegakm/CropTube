import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { spawn, execSync } from 'child_process';
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

function resolveFfprobePath() {
  try {
    const sysPath = execSync(process.platform === 'win32' ? 'where ffprobe' : 'which ffprobe')
      .toString().trim().split('\n')[0].trim();
    if (sysPath) {
      console.log(`[Auto-Setup] System ffprobe found at: ${sysPath} — using system binary.`);
      return sysPath;
    }
  } catch (_) { /* not in PATH */ }

  const ffmpegDir = path.dirname(resolvedFFmpegPath);
  const staticFfprobe = path.join(ffmpegDir, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
  if (fs.existsSync(staticFfprobe)) {
    console.log(`[Auto-Setup] Static ffprobe found at: ${staticFfprobe}`);
    return staticFfprobe;
  }

  console.log(`[Auto-Setup] WARNING — ffprobe not found. Resolution verification will be bypassed.`);
  return null;
}
const resolvedFfprobePath = resolveFfprobePath();

function getFileResolution(filePath) {
  if (!resolvedFfprobePath || !fs.existsSync(filePath)) {
    return 'unknown';
  }
  try {
    const res = execSync(`"${resolvedFfprobePath}" -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "${filePath}"`)
      .toString().trim();
    return res || 'audio-only';
  } catch (err) {
    console.error('[ffprobe] Failed to read resolution:', err);
    return 'error';
  }
}

const app = express();
const PORT = process.env.PORT || 3001;

// Middlewares
app.use(cors());
app.use(express.json());

// Set up paths
const binDir = path.join(__dirname, 'bin');
const tempDir = path.join(__dirname, 'temp');
const cacheDir = path.join(tempDir, 'cache');
const isWindows = process.platform === 'win32';
const globalCookiePath = path.join(binDir, 'global_cookies.txt');

// Create necessary folders
for (const dir of [binDir, tempDir, cacheDir]) {
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`[Initialization] Created directory: ${dir}`);
    } catch (err) {
      console.error(`[Initialization] Failed to create directory ${dir}:`, err);
    }
  }
}

/**
 * Resolves the path to the yt-dlp executable.
 * Priority: system PATH (pip3-installed) > local bin folder.
 */
function resolveYtdlpPath() {
  // 1. Prefer the pip3-installed system yt-dlp (guaranteed on our Docker image)
  try {
    const out = execSync(isWindows ? 'where yt-dlp' : 'which yt-dlp')
      .toString().trim().split('\n')[0].trim();
    if (out) {
      console.log(`[Auto-Setup] System yt-dlp found: ${out}`);
      return out;
    }
  } catch (_) { /* not found */ }

  throw new Error(
    'yt-dlp not found in PATH. On Docker/Render, ensure the Dockerfile installs it via pip3.'
  );
}

// Resolve yt-dlp path once on startup (synchronous — pip install is always present in Docker)
let ytdlpCmd;
try {
  ytdlpCmd = resolveYtdlpPath();
} catch (err) {
  console.error(`[Initialization] FATAL — ${err.message}`);
  process.exit(1);
}

/**
 * Build the common yt-dlp environment for spawned processes.
 * Sets HOME/XDG_CACHE_HOME so yt-dlp can write its cache even in
 * read-only container roots (Render, Railway, etc.).
 */
function ytdlpEnv() {
  return { ...process.env, PYTHONUNBUFFERED: '1', HOME: tempDir, XDG_CACHE_HOME: cacheDir };
}

function getCommonArgsConfig(quality = '', customCookiePath = null) {
  const cookiePath = customCookiePath || globalCookiePath;
  const cookieExists = fs.existsSync(cookiePath);
  let cookieSize = 0;
  if (cookieExists) {
    try {
      cookieSize = fs.statSync(cookiePath).size;
    } catch (_) {}
  }
  const hasValidCookies = cookieExists && cookieSize > 0;

  // If cookies are active, prioritize 'web' since mobile clients do not support cookies in yt-dlp.
  // Otherwise, use the standard android_vr,web,android client stack.
  const playerClient = hasValidCookies ? 'web' : 'android_vr,web,android';

  const args = [
    '--ignore-config',
    '--impersonate', 'chrome',
    '--extractor-args', `youtube:player_client=${playerClient}`,
    '--cache-dir', cacheDir,
  ];

  if (hasValidCookies) {
    args.push('--cookies', cookiePath);
  }

  return { args, playerClient, cookieExists, cookieSize };
}

function commonArgs(quality = '', customCookiePath = null) {
  return getCommonArgsConfig(quality, customCookiePath).args;
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

  const child = spawn(ytdlpCmd, args, { env: ytdlpEnv() });
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

  const config = getCommonArgsConfig('4K');
  const args = [
    ...config.args,
    '--dump-single-json',
    '--skip-download',
    '--no-warnings',
    '--no-playlist',
  ];

  args.push(url);

  console.log(`[Format Retrieval] Trace:`);
  console.log(`  - Cookie file exists: ${config.cookieExists}`);
  console.log(`  - Cookie file size: ${config.cookieSize} bytes`);
  console.log(`  - Active player_client: ${config.playerClient}`);
  console.log(`  - Exact yt-dlp command: "${ytdlpCmd}" ${args.map(a => a.includes('cookies') ? '--cookies [path]' : a).join(' ')}`);

  const child = spawn(ytdlpCmd, args, { env: ytdlpEnv() });
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
      
      const isBot = stderrData.includes("Sign in to confirm you're not a bot") || 
                    stderrData.includes("Sign in to confirm your age");
      
      const errorMsg = isBot
        ? (config.cookieExists 
            ? "YouTube bot detection triggered. Your pre-registered cookies may be expired or invalid. Please update your session cookies in Settings."
            : "YouTube bot detection triggered. Please register YouTube authentication cookies in Settings to bypass this on cloud/datacenter IPs.")
        : "Failed to retrieve video formats.";

      return res.status(isBot ? 403 : 500).json({ error: errorMsg, details: stderrData.trim() });
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

      console.log(`[Format Retrieval] Success:`);
      console.log(`  - Number of formats returned: ${formats.length}`);
      console.log(`  - Available heights: ${heights.join(', ')}`);

      const rawFormats = formats.map(f => ({
        format_id: f.format_id,
        height: f.height || null,
        ext: f.ext,
        vcodec: f.vcodec || 'none',
        acodec: f.acodec || 'none',
        tbr: f.tbr || null
      }));

      res.json({
        title: parsed.title,
        duration: parsed.duration,
        heights: heights.map(h => `${h}p`),
        videoFormats: videoExts.length > 0 ? videoExts : ['mp4', 'mkv'],
        audioFormats: audioExts.length > 0 ? audioExts : ['mp3', 'm4a'],
        rawFormats
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
    const { url, start, end, format, quality, format_id, cookies } = req.body;

    if (!url || !start || !end) {
      return res.status(400).json({ error: 'Missing required parameters: url, start, end timestamps.' });
    }

    console.log(`[Quality Selection] Trace:`);
    console.log(`  - Request payload received:`, req.body);
    console.log(`  - Selected dropdown quality label: ${quality}`);
    console.log(`  - Selected format_id: ${format_id || 'none'}`);

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
      format_id,
      hasCookies,
      cookiePath
    });

    // Automatically expire job parameters after 15 minutes to prevent memory leaks
    setTimeout(() => {
      if (activeJobs.has(fileId)) {
        const job = activeJobs.get(fileId);
        if (job.hasCookies && fs.existsSync(job.cookiePath)) {
          try { fs.unlinkSync(job.cookiePath); } catch (e) {}
        }
        activeJobs.delete(fileId);
      }
    }, 15 * 60 * 1000);

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
  const { url, start, end, format, quality, format_id, hasCookies, cookiePath } = job;

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

  console.log(`[Backend Extraction] Trace:`);
  console.log(`  - format_id received: ${format_id || 'none'}`);
  console.log(`  - quality received: ${quality}`);

  // We require format_id! If it's missing, refuse extraction.
  if (!format_id || format_id === 'none') {
    console.error(`[Backend Extraction] Error: Missing format_id. Slicing aborted.`);
    logToClient('error', 'Authentication/Extraction Error: Missing specific format selection. Please try reloading formats.');
    clearInterval(keepaliveInterval);
    return res.end();
  }

  const noHLS = '[protocol!=m3u8][protocol!=m3u8_native]';
  let formatSelector;

  if (isAudio) {
    formatSelector = format_id;
  } else {
    // Combine the user-selected format_id with the best audio stream
    formatSelector = `${format_id}+ba${noHLS}/bestaudio`;
  }

  console.log(`  - Final yt-dlp format string: "${formatSelector}"`);

  // FFmpeg stream-copy argument
  const postprocessorArgs = isAudio
    ? null
    : 'ffmpeg:-c copy -avoid_negative_ts make_zero -loglevel warning';

  const config = getCommonArgsConfig(quality, hasCookies ? cookiePath : null);
  const args = [
    ...config.args,
    '--download-sections', `*${start}-${end}`,
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

  if (config.cookieExists && config.cookieSize > 0) {
    logToClient('log', '🍪 Server-side cookies loaded (cloud auth active)...');
  }

  args.push('--ffmpeg-location', resolvedFFmpegPath);
  args.push('-f', formatSelector);

  if (!isAudio) {
    args.push('--merge-output-format', targetFormat);
  }

  args.push(
    '--no-playlist',
    url,
    '-o', outputPath
  );

  console.log(`  - Exact yt-dlp command executed: "${ytdlpCmd}" ${args.map(a => a.includes('cookies') ? '--cookies [path]' : a).join(' ')}`);

  logToClient('log', `🎬 Initiating surgical stream-seek for duration [${start} to ${end}]`);
  logToClient('log', `🚀 Executing: yt-dlp --download-sections "*${start}-${end}" -f "${formatSelector}" [URL]`);

  const child = spawn(ytdlpCmd, args, { env: ytdlpEnv() });

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

  let isFinished = false;
  const finish = (err = null) => {
    if (isFinished) return;
    isFinished = true;

    clearInterval(keepaliveInterval);

    if (child && !child.killed) {
      try {
        child.kill('SIGKILL');
      } catch (_) {}
    }

    if (hasCookies && fs.existsSync(cookiePath)) {
      try {
        fs.unlinkSync(cookiePath);
        console.log(`[Cleanup] Deleted temporary Netscape cookie file for Job: ${fileId}`);
      } catch (unlinkErr) {
        console.error('[Cleanup] Failed to delete temporary cookie file:', unlinkErr);
      }
    }

    activeJobs.delete(fileId);

    if (!res.writableEnded) {
      res.end();
    }
  };

  child.on('error', (err) => {
    console.error(`[Backend Extraction] Process error: ${err.message}`);
    logToClient('error', `Process execution failed: ${err.message}`);
    finish();
  });

  child.on('close', (code) => {
    if (code === 0 && fs.existsSync(outputPath)) {
      // Final Output Phase logging
      const fileRes = getFileResolution(outputPath);
      console.log(`[Final Output] Trace:`);
      console.log(`  - Downloaded source file resolution: ${fileRes}`);
      console.log(`  - FFmpeg command executed: yt-dlp internal post-processor with arguments "${postprocessorArgs || 'none'}"`);
      console.log(`  - Final output resolution: ${fileRes}`);

      logToClient('log', `✅ Final file resolution: ${fileRes}`);
      logToClient('log', '✅ Stream cutting & output merging completed successfully!');
      logToClient('complete', { fileId, filename: outputFilename });
    } else {
      console.error(`[Backend Extraction] Terminated with code ${code}. Output file exists: ${fs.existsSync(outputPath)}`);
      logToClient('error', `yt-dlp process terminated with exit code: ${code}. Check logs above for details.`);
    }
    finish();
  });

  req.on('close', () => {
    console.log(`[Abort] SSE client closed connection for Job: ${fileId}`);
    finish();
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

// GET /api/debug/cookies: Quick check for cookie files on backend
app.get('/api/debug/cookies', (req, res) => {
  const exists = fs.existsSync(globalCookiePath);
  if (!exists) {
    return res.json({ exists: false, size: 0, lastModified: null });
  }
  try {
    const stats = fs.statSync(globalCookiePath);
    return res.json({
      exists: true,
      size: stats.size,
      lastModified: stats.mtime
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/debug/formats: Get formats with detailed configurations
app.get('/api/debug/formats', async (req, res) => {
  const { url } = req.query;
  if (!url) {
    return res.status(400).json({ error: 'Missing url parameter.' });
  }

  const config = getCommonArgsConfig('4K');
  const args = [
    ...config.args,
    '--dump-single-json',
    '--skip-download',
    '--no-warnings',
    '--no-playlist',
    url
  ];

  console.log(`[Debug Formats] Executing: "${ytdlpCmd}" ${args.map(a => a.includes('cookies') ? '--cookies [path]' : a).join(' ')}`);

  const child = spawn(ytdlpCmd, args, { env: ytdlpEnv() });
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
      return res.status(500).json({
        cookieExists: config.cookieExists,
        cookieSize: config.cookieSize,
        playerClient: config.playerClient,
        error: `yt-dlp failed with exit code ${code}`,
        stderr: stderrData.trim()
      });
    }

    try {
      const parsed = JSON.parse(stdoutData);
      const formats = parsed.formats || [];
      const topFormats = formats.slice(-5).map(f => ({
        format_id: f.format_id,
        height: f.height || null,
        ext: f.ext,
        vcodec: f.vcodec || 'none',
        acodec: f.acodec || 'none'
      }));

      res.json({
        cookieExists: config.cookieExists,
        cookieSize: config.cookieSize,
        playerClient: config.playerClient,
        formatsFound: formats.length,
        topFormats
      });
    } catch (parseErr) {
      res.status(500).json({
        cookieExists: config.cookieExists,
        cookieSize: config.cookieSize,
        playerClient: config.playerClient,
        error: 'Failed to parse JSON output',
        details: parseErr.message
      });
    }
  });
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
app.listen(PORT, () => {
  console.log(`=================================================`);
  console.log(`  CropTube Backend Server running on port ${PORT}`);
  console.log(`  yt-dlp: ${ytdlpCmd}`);
  console.log(`  ffmpeg: ${resolvedFFmpegPath}`);
  console.log(`  cookies: ${fs.existsSync(globalCookiePath) ? 'loaded ✓' : 'not found'}`);
  console.log(`=================================================`);
});
