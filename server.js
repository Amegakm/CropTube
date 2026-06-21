import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import https from 'https';
import { fileURLToPath } from 'url';
import { spawn, execSync } from 'child_process';
import ffmpegStatic from 'ffmpeg-static';

// Initialize __dirname for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load local environment variables if .env exists
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  try {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split(/\r?\n/).forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const key = trimmed.substring(0, eqIdx).trim();
        let val = trimmed.substring(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    });
    console.log('[Auto-Setup] Loaded local .env variables.');
  } catch (err) {
    console.error('[Auto-Setup] Failed to load .env:', err);
  }
}

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
  // 1. Prefer local bin folder if it exists (standalone binary for dev/Windows)
  const localBin = path.join(binDir, isWindows ? 'yt-dlp.exe' : 'yt-dlp');
  if (fs.existsSync(localBin)) {
    console.log(`[Auto-Setup] Local yt-dlp found: ${localBin}`);
    return localBin;
  }

  // 2. Prefer the pip3-installed system yt-dlp (guaranteed on our Docker image)
  try {
    const out = execSync(isWindows ? 'where yt-dlp' : 'which yt-dlp')
      .toString().trim().split('\n')[0].trim();
    if (out) {
      console.log(`[Auto-Setup] System yt-dlp found: ${out}`);
      return out;
    }
  } catch (_) { /* not found */ }

  throw new Error(
    'yt-dlp not found in PATH or local bin. On Docker/Render, ensure the Dockerfile installs it via pip3.'
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

  if (customCookiePath && fs.existsSync(customCookiePath)) {
    console.log(`[Cookies] Using temporary job cookie file`);
  } else if (!customCookiePath && fs.existsSync(globalCookiePath)) {
    console.log(`[Cookies] Using global cookie file`);
    if (cookieSize === 0) {
      sendTelegramAlert('Cookie Persistence', 'N/A', 'N/A', 'N/A', 'Global cookie file size became 0 bytes.', 'N/A');
    }
  }

  // If cookies are active, prioritize 'tv_embedded,web_embedded,web' since 'web' alone suffers from SABR (missing URL) blocks.
  // Otherwise, use the standard android_vr,web,android client stack.
  const playerClient = hasValidCookies ? 'tv_embedded,web_embedded,web' : 'android_vr,web,android';

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
  try {
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

  console.log(`[Formats] Cookie file exists: ${config.cookieExists}, size: ${config.cookieSize} bytes`);

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

      sendTelegramAlert('Format Retrieval', url, 'N/A', 'N/A', stderrData, 'N/A');

      return res.status(isBot ? 403 : 500).json({ error: errorMsg });
    }

    try {
      const parsed = JSON.parse(stdoutData);
      const formats = parsed.formats || [];
      
      // 1. Log the first 10 raw formats returned by yt-dlp per Requirement 1
      console.log("[Formats Debug] First 10 raw formats returned by yt-dlp:");
      formats.slice(0, 10).forEach((f, idx) => {
        console.log(`  [Raw Format #${idx + 1}] format_id: ${f.format_id}, ext: ${f.ext}, width: ${f.width || 'N/A'}, height: ${f.height || 'N/A'}, resolution: ${f.resolution || 'N/A'}, vcodec: ${f.vcodec || 'none'}, acodec: ${f.acodec || 'none'}`);
      });

      // Helper function to map a height to nearest standard YouTube quality label
      const getLabelForHeight = (height) => {
        if (!height) return null;
        const STANDARD_HEIGHTS = [144, 240, 360, 480, 720, 1080, 1440, 2160];
        let nearest = STANDARD_HEIGHTS[0];
        let minDiff = Math.abs(height - nearest);
        for (let i = 1; i < STANDARD_HEIGHTS.length; i++) {
          const diff = Math.abs(height - STANDARD_HEIGHTS[i]);
          if (diff < minDiff) {
            minDiff = diff;
            nearest = STANDARD_HEIGHTS[i];
          }
        }
        return `${nearest}p`;
      };

      // Accept formats based on actual height (Requirement 4) and do not discard due to slight differences (Requirement 6)
      const videoFormats = formats.filter(f => f.vcodec !== 'none' && f.height);
      const audioFormats = formats.filter(f => f.acodec !== 'none' && f.vcodec === 'none');

      // Map display labels and collect unique ones
      const heightsSet = new Set();
      videoFormats.forEach(f => {
        f.label = getLabelForHeight(f.height);
        if (f.label) heightsSet.add(f.label);
      });

      // Sort the standard display heights in descending order
      const heightsOrder = ['2160p', '1440p', '1080p', '720p', '480p', '360p', '240p', '144p'];
      const availableHeights = heightsOrder.filter(h => heightsSet.has(h));

      const videoExts = Array.from(new Set(videoFormats.map(f => f.ext))).filter(e => e === 'mp4' || e === 'mkv' || e === 'webm');
      const audioExts = Array.from(new Set(audioFormats.map(f => f.ext))).filter(e => e === 'mp3' || e === 'm4a' || e === 'opus');

      console.log(`[Format Retrieval] Success:`);
      console.log(`  - Number of formats returned: ${formats.length}`);
      console.log(`  - Filtered video formats with standard heights: ${videoFormats.length}`);
      console.log(`  - Available heights: ${availableHeights.join(', ')}`);

      // Log Raw height, Display label, format_id (Requirement 7)
      videoFormats.forEach(f => {
        console.log(`height=${f.height} label=${f.label} format_id=${f.format_id}`);
      });

      const rawFormats = formats.map(f => {
        const label = f.vcodec !== 'none' && f.height ? getLabelForHeight(f.height) : null;
        return {
          format_id: f.format_id,
          height: f.height || null,
          width: f.width || null,
          label: label,
          ext: f.ext,
          vcodec: f.vcodec || 'none',
          acodec: f.acodec || 'none',
          tbr: f.tbr || null
        };
      });

      res.json({
        title: parsed.title,
        duration: parsed.duration,
        heights: availableHeights,
        videoFormats: videoExts.length > 0 ? videoExts : ['mp4', 'mkv'],
        audioFormats: audioExts.length > 0 ? audioExts : ['mp3', 'm4a'],
        rawFormats
      });
    } catch (parseErr) {
      console.error('[Formats] Failed to parse JSON:', parseErr);
      res.status(500).json({ error: 'Failed to process format list.' });
    }
  });
  } catch (err) {
    console.error('[Formats] Unexpected error:', err);
    sendTelegramAlert('Format Retrieval Exception', req.query.url, 'N/A', 'N/A', err.stack || err.message, 'N/A');
    res.status(500).json({ error: 'Failed to retrieve video formats.' });
  }
});

// Active extraction jobs registry
const activeJobs = new Map();

// Step 1: Initiate job, cache parameters, write temporary cookie file if provided
app.post('/api/extract/initiate', (req, res) => {
  try {
    const { url, start, end, format, quality, format_id, cookies } = req.body;
    
    const loggedBody = { ...req.body };
    if (loggedBody.cookies) {
      loggedBody.cookies = '[REDACTED]';
    }
    console.log(`[Initiate Backend Log] Request body received:`, JSON.stringify(loggedBody, null, 2));

    if (!url || !start || !end) {
      return res.status(400).json({ error: 'Missing required parameters: url, start, end timestamps.' });
    }

    console.log(`[Initiate] Job request: quality=${quality}, format_id=${format_id || 'none'}`);

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
    sendTelegramAlert('Initiate Job Exception', req.body.url, req.body.quality, req.body.format_id, err.stack || err.message, 'N/A');
    return res.status(500).json({ error: 'Clip extraction failed. Please try again.' });
  }
});

// Step 2: Stream logs via SSE using the cached job settings
app.get('/api/extract/stream', async (req, res) => {
  try {
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
  // SSE connection established

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
    console.error(`[Extract] Dependency resolution failed: ${err.message}`);
    logToClient('error', 'Service temporarily unavailable. Please try again later.');
    return res.end();
  }

  const targetFormat = format || 'mp4';
  const isAudio = targetFormat === 'mp3' || targetFormat === 'm4a' || targetFormat === 'opus' || targetFormat === 'webm-audio';
  let outputFilename = `croptube_${fileId}.${targetFormat === 'webm-audio' ? 'webm' : targetFormat}`;
  const outputPath = path.join(tempDir, outputFilename);

  console.log(`[Extract] Starting: quality=${quality}, format_id=${format_id || 'none'}`);

  // format_id is required — refuse extraction if missing
  if (!format_id || format_id === 'none') {
    console.error(`[Extract] Missing format_id — aborting.`);
    sendTelegramAlert('Extraction - Missing Format', url, quality, format_id, 'Missing format_id parameter', fileId);
    logToClient('error', 'Unable to fetch video information. Please reload and try again.');
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

  console.log(`[Extract] Format selector: "${formatSelector}"`);

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

  // Cloud auth cookies present (server-side only, not exposed to client)

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

  logToClient('status', 'Preparing clip...');

  const child = spawn(ytdlpCmd, args, { env: ytdlpEnv() });
  let stderrBuffer = '';

  child.stdout.on('data', (data) => {
    const lines = data.toString().split('\n');
    lines.forEach(line => {
      const trimmed = line.trim();
      if (!trimmed) return;
      // Server-side diagnostic logging — never forward raw output to client
      console.log(`[yt-dlp] ${trimmed}`);
      // Map to user-friendly client status updates
      if (/\[download\]/.test(trimmed)) {
        const pctMatch = trimmed.match(/(\d+(?:\.\d+)?)%/);
        if (pctMatch) {
          logToClient('progress', { stage: 'Downloading stream...', pct: parseFloat(pctMatch[1]) });
        } else {
          logToClient('status', 'Downloading stream...');
        }
      } else if (/\[Merger\]|\[ffmpeg\]|\[ExtractAudio\]/i.test(trimmed)) {
        logToClient('status', 'Finalizing clip...');
      }
    });
  });

  child.stderr.on('data', (data) => {
    const lines = data.toString().split('\n');
    lines.forEach(line => {
      const trimmed = line.trim();
      if (trimmed) {
        stderrBuffer += trimmed + '\n';
        // Server-side only — never expose stderr output to client
        console.error(`[yt-dlp stderr] ${trimmed}`);
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

    if (!hasCookies && fs.existsSync(globalCookiePath)) {
      console.log(`[Cookies] Preserved global cookie file`);
    }

    if (hasCookies && fs.existsSync(cookiePath)) {
      try {
        fs.unlinkSync(cookiePath);
        console.log(`[Cookies] Deleted temporary job cookie file`);
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
    console.error(`[Extract] Process error: ${err.message}`);
    sendTelegramAlert('Extraction - Spawn Error', url, quality, format_id, err.message, fileId);
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'Clip extraction failed. Please try again.' })}\n\n`, 'utf8', () => {
        finish();
      });
      if (typeof res.flush === 'function') {
        res.flush();
      }
    } else {
      finish();
    }
  });

  child.on('close', (code) => {
    if (code === 0 && fs.existsSync(outputPath)) {
      const fileRes = getFileResolution(outputPath);
      // Server-side diagnostic logging only
      console.log(`[Final Output] resolution=${fileRes}, postprocessor=${postprocessorArgs || 'none'}`);
      if (!res.writableEnded) {
        res.write(`event: completed\ndata: ${JSON.stringify({ success: true })}\n\n`, 'utf8', () => {
          finish();
        });
        if (typeof res.flush === 'function') {
          res.flush();
        }
      } else {
        finish();
      }
    } else {
      console.error(`[Extract] Process terminated (code ${code}). Output exists: ${fs.existsSync(outputPath)}`);
      sendTelegramAlert('Extraction - Process Error', url, quality, format_id, `Exit Code: ${code}\nStderr: ${stderrBuffer.substring(0, 300)}`, fileId);
      const isCookieError = stderrBuffer.includes("Sign in to confirm you're not a bot") ||
                            stderrBuffer.includes('Sign in to confirm your age') ||
                            stderrBuffer.includes('cookies have');
      if (isCookieError) {
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify({ type: 'cookie_error', message: 'Authentication cookies may be expired. Please update your session cookies in Settings.' })}\n\n`, 'utf8', () => {
            finish();
          });
          if (typeof res.flush === 'function') {
            res.flush();
          }
        } else {
          finish();
        }
      } else {
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify({ type: 'error', message: 'Clip extraction failed. Please try again.' })}\n\n`, 'utf8', () => {
            finish();
          });
          if (typeof res.flush === 'function') {
            res.flush();
          }
        } else {
          finish();
        }
      }
    }
  });

  req.on('close', () => {
    console.log(`[Abort] SSE client closed connection for Job: ${fileId}`);
    finish();
  });
  } catch (err) {
    console.error('[Extract Stream] Unexpected error:', err);
    sendTelegramAlert('Extraction - Stream Exception', req.query.url, 'N/A', 'N/A', err.stack || err.message, req.query.fileId);
  }
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

// Controlled Telegram monitoring verification endpoint (development-only)
if (process.env.NODE_ENV !== 'production') {
  app.get('/api/test-telegram-error', (req, res) => {
    console.log('[Test Route] Triggering controlled Telegram alert tests...');
    
    // 1. Standard test alert
    sendTelegramAlert(
      'Test Diagnostic Alert', 
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 
      '1080p', 
      '137', 
      'Standard diagnostic error: Operation failed successfully.'
    );

    // 2. HTTP cookie format sanitization test
    sendTelegramAlert(
      'Test HTTP Cookie Sanitization', 
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 
      '1080p', 
      '137', 
      'Failed authentication header: Cookie: SID=abcdef123; __Secure-3PSID=xyz789; othercookie=visible;'
    );

    // 3. Netscape cookie format sanitization test
    sendTelegramAlert(
      'Test Netscape Cookie Sanitization', 
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 
      '1080p', 
      '137', 
      'Cookie parsing failed on line: .youtube.com\tTRUE\t/\tTRUE\t1745678900\tSID\tsecretcookievalue'
    );

    // 4. Rate-limiting / Duplicate suppression verification
    // Send two identical errors. The first should be delivered, the second should be suppressed.
    sendTelegramAlert(
      'Test Duplicate Suppression', 
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 
      '1080p', 
      '137', 
      'Duplicate error message that should trigger only once: error code 0x9f.'
    );
    sendTelegramAlert(
      'Test Duplicate Suppression', 
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 
      '1080p', 
      '137', 
      'Duplicate error message that should trigger only once: error code 0x9f.'
    );

    res.json({
      success: true,
      message: 'Controlled Telegram alerts triggered. Check server console and Telegram chat for results.'
    });
  });
}

// ----------------------------------------------------
// TELEGRAM AUTOMATIC ERROR REPORTING
// ----------------------------------------------------
const errorCache = new Map();

function sendTelegramAlert(stage, url, quality, format_id, errorMessage, jobId = 'N/A') {
  // 1. Sanitize the error message first
  const rawMsg = errorMessage || 'Unknown error';
  const sanitized = rawMsg
    // A. Redact HTTP and Netscape cookies for sensitive YouTube auth keys
    .replace(/(?:SID|HSID|SSID|APISID|SAPISID|LOGIN_INFO|VISITOR_INFO1_LIVE|YSC|__Secure-[a-zA-Z0-9\-_]+)\b(?:=|\t|\s+)[^\s;\t]+/gi, '[redacted]')
    // Also redact raw Netscape cookie lines
    .replace(/^(?:(?!\s).)*youtube\.com\s+[\w]+\s+\/\s+[\w]+\s+\d+\s+(?:SID|HSID|SSID|APISID|SAPISID|LOGIN_INFO|VISITOR_INFO1_LIVE|YSC|__Secure-[a-zA-Z0-9\-_]+)\s+[^\r\n]+/gm, '[redacted_netscape_cookie_line]')
    // B. Sanitize absolute Windows paths
    .replace(/[A-Za-z]:\\[\w\s.\-_\\+]+/g, '[path]')
    // C. Sanitize Unix and absolute paths
    .replace(/\/[\w.\-_\\+]+/g, '[path]')
    // D. Sanitize IP addresses
    .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[ip]')
    // E. Sanitize long auth tokens / base64 strings (40+ characters)
    .replace(/[A-Za-z0-9+/=]{40,}/g, '[redacted]')
    .substring(0, 500);

  // 2. Generate duplicate cache hash based on SANITIZED payload
  const hash = `${stage}|${url || 'N/A'}|${sanitized}`;
  const now = Date.now();
  if (errorCache.has(hash)) {
    if (now - errorCache.get(hash) < 10 * 60 * 1000) {
      console.log(`[Telegram Alert] Duplicate suppressed: stage=${stage}, error=${sanitized}`);
      return;
    }
  }
  errorCache.set(hash, now);

  const text = [
    '🚨 CropTube Error', '',
    `Time: ${new Date().toISOString()}`,
    `Environment: ${process.env.NODE_ENV || 'production'}`,
    `Stage: ${stage}`,
    `Job ID: ${jobId}`,
    `URL: ${url || 'N/A'}`,
    `Quality: ${quality || 'N/A'}`,
    `Format ID: ${format_id || 'N/A'}`,
    '', 'Error:', sanitized
  ].join('\n');

  console.log(`[Telegram Alert Debug] Calculated message payload:\n${text}\n-------------------`);

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    console.log('[Telegram Alert] Skip api.telegram.org post: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not configured.');
    return;
  }

  const payload = JSON.stringify({ chat_id: chatId, text });
  const options = {
    hostname: 'api.telegram.org',
    path: `/bot${botToken}/sendMessage`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
  };

  const tgReq = https.request(options, (tgRes) => {
    let data = '';
    tgRes.on('data', chunk => { data += chunk; });
    tgRes.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        if (parsed.ok) console.log('[Telegram Alert] Sent successfully');
        else console.log(`[Telegram Alert] Failed: ${parsed.description}`);
      } catch (_) { console.log('[Telegram Alert] Failed: Invalid response'); }
    });
  });

  tgReq.on('error', (err) => console.log(`[Telegram Alert] Failed: ${err.message}`));
  tgReq.write(payload);
  tgReq.end();
}

// Download Endpoint - Downloads clip then immediately cleans it up
app.get('/api/download/:fileId', (req, res) => {
  try {
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

  console.log(`[Delivery] Serving clip (fileId: ${fileId}) to client`);
  
  res.download(filePath, `CropTube_Clip_${fileId}${ext}`, (err) => {
    if (err) {
      console.error(`[Delivery] Error downloading file:`, err);
      sendTelegramAlert('Delivery - Download Error', 'N/A', 'N/A', 'N/A', err.message, fileId);
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
  } catch (err) {
    sendTelegramAlert('Delivery - Exception', 'N/A', 'N/A', 'N/A', err.stack || err.message, req.params.fileId);
  }
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
  console.log(`  yt-dlp: ${ytdlpCmd ? 'OK' : 'NOT FOUND'}`);
  console.log(`  ffmpeg: ${resolvedFFmpegPath ? 'OK' : 'NOT FOUND'}`);
  console.log(`  cookies: ${fs.existsSync(globalCookiePath) ? 'loaded ✓' : 'not found'}`);
  console.log(`  report: ${process.env.TELEGRAM_BOT_TOKEN ? 'configured ✓' : 'not configured'}`);
  console.log(`=================================================`);
});
