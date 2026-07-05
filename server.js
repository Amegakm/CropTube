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
// ─── Phase 7 Centralized Configuration & Utilities ──────────────────────────
const CONFIG = {
  MAX_CONCURRENT_EXTRACTIONS: 1, // Single-extraction mode for Render Free tier memory stability
  MAX_CLIP_DURATION: 600, // 10 minutes (in seconds)
  JOB_EXPIRY_MS: 15 * 60 * 1000 // 15 minutes
};

function hmsToSecs(hms) {
  if (!hms) return 0;
  const parts = hms.split(':').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return 0;
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

function isSupportedYouTubeUrl(urlStr) {
  try {
    const parsed = new URL(urlStr);
    const host = parsed.hostname.toLowerCase();
    return host === 'youtube.com' || 
           host.endsWith('.youtube.com') || 
           host === 'youtu.be' || 
           host.endsWith('.youtu.be');
  } catch (e) {
    return false;
  }
}

function validateExtractionParams(url, start, end) {
  if (!url) {
    return { valid: false, error: 'Missing video URL.', code: 'INVALID_URL' };
  }
  if (!isSupportedYouTubeUrl(url)) {
    return { valid: false, error: 'Invalid or unsupported YouTube URL.', code: 'INVALID_URL' };
  }
  const timeRegex = /^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;
  if (!start || !timeRegex.test(start)) {
    return { valid: false, error: 'Start time must be formatted exactly as HH:MM:SS.', code: 'INVALID_START_TIME' };
  }
  if (!end || !timeRegex.test(end)) {
    return { valid: false, error: 'End time must be formatted exactly as HH:MM:SS.', code: 'INVALID_END_TIME' };
  }
  
  const startSecs = hmsToSecs(start);
  const endSecs = hmsToSecs(end);
  if (endSecs <= startSecs) {
    return { valid: false, error: 'End time must be after start time.', code: 'INVALID_TIME_RANGE' };
  }
  
  const duration = endSecs - startSecs;
  if (duration <= 0) {
    return { valid: false, error: 'Clip duration must be greater than 0 seconds.', code: 'INVALID_DURATION' };
  }
  
  if (duration > CONFIG.MAX_CLIP_DURATION) {
    return { valid: false, error: `Clip duration exceeds the maximum allowed limit of ${CONFIG.MAX_CLIP_DURATION / 60} minutes.`, code: 'DURATION_LIMIT_EXCEEDED' };
  }
  
  return { valid: true };
}

const app = express();
const PORT = process.env.PORT || 3001;

// Middlewares
app.use(cors());
app.use(express.json());

// ─── Rate Limiter Storage & Middleware (Best-Effort, In-Memory Only) ────────
// Note: This is a best-effort protection mechanism. It is non-persistent
// and is not distributed-safe (stores IP states in a local Javascript Map in-memory).
const rateLimitDb = new Map();

function rateLimiter({ windowMs, max, message, code }) {
  return (req, res, next) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const now = Date.now();
    
    if (!rateLimitDb.has(ip)) {
      rateLimitDb.set(ip, []);
    }
    
    let requests = rateLimitDb.get(ip);
    requests = requests.filter(timestamp => now - timestamp < windowMs);
    
    if (requests.length >= max) {
      console.warn(`[Rate Limit] Rejected request from IP: ${ip} for path: ${req.path}`);
      return res.status(429).json({
        success: false,
        error: message || 'Too many requests. Please slow down.',
        code: code || 'RATE_LIMIT_EXCEEDED'
      });
    }
    
    requests.push(now);
    rateLimitDb.set(ip, requests);
    next();
  };
}

const searchLimiter = rateLimiter({
  windowMs: 60 * 1000,
  max: 10,
  message: 'Too many search requests. Please wait a minute.',
  code: 'RATE_LIMIT_EXCEEDED'
});

const formatsLimiter = rateLimiter({
  windowMs: 60 * 1000,
  max: 15,
  message: 'Too many format retrieval requests. Please wait a minute.',
  code: 'RATE_LIMIT_EXCEEDED'
});

const extractLimiter = rateLimiter({
  windowMs: 60 * 1000,
  max: 5,
  message: 'Too many extraction requests. Please wait a minute.',
  code: 'RATE_LIMIT_EXCEEDED'
});

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
app.get('/api/search', searchLimiter, async (req, res) => {
  const { q } = req.query;
  if (!q) {
    return res.status(400).json({
      success: false,
      error: 'Missing search query.',
      code: 'MISSING_QUERY'
    });
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
      return res.status(500).json({
        success: false,
        error: 'Search failed. Please try again.',
        code: 'SEARCH_FAILED'
      });
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
      res.status(500).json({
        success: false,
        error: 'Failed to process search results.',
        code: 'PARSE_ERROR'
      });
    }
  });
});

// GET /api/formats: Get available resolutions and formats for a YouTube video
app.get('/api/formats', formatsLimiter, async (req, res) => {
  try {
  const { url } = req.query;
  if (!url) {
    return res.status(400).json({
      success: false,
      error: 'Missing video URL.',
      code: 'MISSING_URL'
    });
  }
  if (!isSupportedYouTubeUrl(url)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid or unsupported YouTube URL.',
      code: 'INVALID_URL'
    });
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

      return res.status(isBot ? 403 : 500).json({
        success: false,
        error: errorMsg,
        code: isBot ? 'BOT_DETECTION' : 'FORMATS_FAILED'
      });
    }

    try {
      const parsed = JSON.parse(stdoutData);
      const formats = parsed.formats || [];
      
      // 1. Log the first 10 raw formats returned by yt-dlp per Requirement 1
      console.log("[Formats Debug] First 10 raw formats returned by yt-dlp:");
      formats.slice(0, 10).forEach((f, idx) => {
        console.log(`  [Raw Format #${idx + 1}] format_id: ${f.format_id}, ext: ${f.ext}, width: ${f.width || 'N/A'}, height: ${f.height || 'N/A'}, resolution: ${f.resolution || 'N/A'}, vcodec: ${f.vcodec || 'none'}, acodec: ${f.acodec || 'none'}`);
      });

      // Helper function to classify format quality based on format_note, resolution, and width/height aspect ratios
      const classifyFormatQuality = (f) => {
        if (!f) return null;

        const STANDARD_HEIGHTS = [144, 240, 360, 480, 720, 1080, 1440, 2160];

        // Helper to map an arbitrary height to the nearest standard label
        const getNearestStandardLabel = (height) => {
          if (!height) return null;
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

        // Priority 1: Use yt-dlp format_note if it contains a standard label (e.g. 2160p, 1080p, 1080p60)
        if (f.format_note) {
          const noteMatch = String(f.format_note).match(/(\d{3,4})p/i);
          if (noteMatch) {
            const pVal = parseInt(noteMatch[1], 10);
            if (STANDARD_HEIGHTS.includes(pVal)) {
              return `${pVal}p`;
            }
          }
        }

        // Priority 2: Parse resolution metadata if width/height are missing (e.g. "3840x2160")
        let w = f.width;
        let h = f.height;
        if ((!w || !h) && f.resolution) {
          const resMatch = String(f.resolution).match(/(\d+)x(\d+)/);
          if (resMatch) {
            w = parseInt(resMatch[1], 10);
            h = parseInt(resMatch[2], 10);
          }
        }

        if (!w || !h) {
          // If we only have height, fall back to nearest standard mapping
          if (h) return getNearestStandardLabel(h);
          return null;
        }

        // Priority 3: Width/height aspect-ratio-aware classification
        const isVertical = h > w;
        const longSide = isVertical ? h : w;
        const shortSide = isVertical ? w : h;

        if (!isVertical) {
          // Horizontal / Cinematic Video (use width/longSide as classification anchor)
          if (longSide >= 3840) return '2160p';
          if (longSide >= 2560) return '1440p';
          if (longSide >= 1920) return '1080p';
          if (longSide >= 1280) return '720p';
          if (longSide >= 854) return '480p';
          if (longSide >= 640) return '360p';
          if (longSide >= 426) return '240p';
          return '144p';
        } else {
          // Vertical Video (Shorts) (use width/shortSide as classification anchor)
          if (shortSide >= 2160) return '2160p';
          if (shortSide >= 1440) return '1440p';
          if (shortSide >= 1080) return '1080p';
          if (shortSide >= 720) return '720p';
          if (shortSide >= 480) return '480p';
          if (shortSide >= 360) return '360p';
          if (shortSide >= 240) return '240p';
          return '144p';
        }
      };

      // Accept formats based on actual height (Requirement 4) and do not discard due to slight differences (Requirement 6)
      const videoFormats = formats.filter(f => f.vcodec !== 'none' && f.height);
      const audioFormats = formats.filter(f => f.acodec !== 'none' && f.vcodec === 'none');

      // Map display labels and collect unique ones
      const heightsSet = new Set();
      videoFormats.forEach(f => {
        f.label = classifyFormatQuality(f);
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
        const label = f.vcodec !== 'none' ? classifyFormatQuality(f) : null;
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
      res.status(500).json({
        success: false,
        error: 'Failed to process format list.',
        code: 'PARSE_ERROR'
      });
    }
  });
  } catch (err) {
    console.error('[Formats] Unexpected error:', err);
    sendTelegramAlert('Format Retrieval Exception', req.query.url, 'N/A', 'N/A', err.stack || err.message, 'N/A');
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve video formats.',
      code: 'UNEXPECTED_ERROR'
    });
  }
});

// Active extraction jobs registry
const activeJobs = new Map();

function getActiveExtractionsCount() {
  let count = 0;
  for (const job of activeJobs.values()) {
    if (job.status === 'running') {
      count++;
    }
  }
  return count;
}

// Periodic job and file sweeper statistics (useful for the detailed health endpoint)
const sweepStats = {
  totalSweepsRun: 0,
  totalFilesDeleted: 0,
  lastSweepTime: null,
  errorsCount: 0
};

function runStaleFileSweeper() {
  try {
    console.log('[Sweeper] Starting stale file sweep...');
    if (!fs.existsSync(tempDir)) {
      return;
    }
    
    const now = Date.now();
    const files = fs.readdirSync(tempDir);
    let filesDeleted = 0;
    
    files.forEach(file => {
      const filePath = path.join(tempDir, file);
      try {
        const stats = fs.statSync(filePath);
        
        // 1. Path Guard: Must be a file, not a directory (e.g. cacheDir)
        if (!stats.isFile()) {
          return;
        }
        
        // 2. Prefix Guard: Must strictly start with 'croptube_' or 'cookies_'
        let fileId = '';
        if (file.startsWith('croptube_')) {
          fileId = file.replace('croptube_', '').split('.')[0];
        } else if (file.startsWith('cookies_')) {
          fileId = file.replace('cookies_', '').split('.')[0];
        } else {
          // Ignore other files entirely (e.g. system files or random folders)
          return;
        }
        
        // 3. Active Job Guard: Verify file is not associated with an active job in the Map
        if (fileId && activeJobs.has(fileId)) {
          console.log(`[Sweeper] Skipping file ${file} because Job ${fileId} is currently active.`);
          return;
        }
        
        // 4. Age Guard: Must be older than 30 minutes
        const ageMs = now - stats.mtimeMs;
        if (ageMs > 30 * 60 * 1000) {
          fs.unlinkSync(filePath);
          filesDeleted++;
          console.log(`[Sweeper] Deleted stale file: ${file} (age: ${Math.round(ageMs / 1000 / 60)}m)`);
        }
      } catch (fileErr) {
        console.error(`[Sweeper] Error processing file ${file}:`, fileErr);
        sweepStats.errorsCount++;
      }
    });
    
    sweepStats.totalSweepsRun++;
    sweepStats.totalFilesDeleted += filesDeleted;
    sweepStats.lastSweepTime = new Date().toISOString();
    console.log(`[Sweeper] Sweep completed. Deleted ${filesDeleted} file(s).`);
  } catch (err) {
    console.error('[Sweeper] Sweeper failed:', err);
    sweepStats.errorsCount++;
  }
}

function runPeriodicCleanup() {
  const now = Date.now();
  console.log('[Cleanup] Starting periodic job & file cleanup...');
  
  // 1. Clean up stale jobs in activeJobs Map
  for (const [fileId, job] of activeJobs.entries()) {
    if (now - job.createdAt > CONFIG.JOB_EXPIRY_MS) {
      console.log(`[Cleanup] Expiring stale job ${fileId} (created ${Math.round((now - job.createdAt) / 1000 / 60)}m ago)`);
      
      // Kill hung process if still attached
      if (job.child && !job.child.killed) {
        try {
          job.child.kill('SIGKILL');
          console.log(`[Cleanup] Killed hung process for stale job ${fileId}`);
        } catch (e) {}
      }
      
      // Clean up temporary cookie file
      if (job.hasCookies && job.cookiePath && fs.existsSync(job.cookiePath)) {
        try {
          fs.unlinkSync(job.cookiePath);
          console.log(`[Cleanup] Deleted temporary cookie file for stale job ${fileId}`);
        } catch (e) {}
      }
      
      // Clean up temporary outputs if present
      const targetFormat = job.format || 'mp4';
      const outputFilename = `croptube_${fileId}.${targetFormat === 'webm-audio' ? 'webm' : targetFormat}`;
      const outputPath = path.join(tempDir, outputFilename);
      const partPath = `${outputPath}.part`;
      
      [outputPath, partPath].forEach(p => {
        if (fs.existsSync(p)) {
          try {
            fs.unlinkSync(p);
            console.log(`[Cleanup] Deleted temporary output file: ${p}`);
          } catch (e) {}
        }
      });
      
      activeJobs.delete(fileId);
    }
  }
  
  // 2. Scan tempDir for orphaned files
  runStaleFileSweeper();
}

// Run periodic cleanup every 10 minutes
setInterval(runPeriodicCleanup, 10 * 60 * 1000);

// Step 1: Initiate job, cache parameters, write temporary cookie file if provided
app.post('/api/extract/initiate', extractLimiter, (req, res) => {
  try {
    const { url, start, end, format, quality, format_id, cookies } = req.body;
    
    const loggedBody = { ...req.body };
    if (loggedBody.cookies) {
      loggedBody.cookies = '[REDACTED]';
    }
    console.log(`[Initiate Backend Log] Request body received:`, JSON.stringify(loggedBody, null, 2));

    // 1. Concurrent Extraction Protection
    const currentActiveCount = getActiveExtractionsCount();
    if (currentActiveCount >= CONFIG.MAX_CONCURRENT_EXTRACTIONS) {
      console.warn(`[Concurrency] Rejected extraction request: active extraction already running. Active count: ${currentActiveCount}`);
      return res.status(429).json({
        success: false,
        error: 'Another extraction is currently running. Please wait until it finishes.',
        code: 'SERVER_BUSY'
      });
    }

    // 2. Parameters & URL Validation
    const validation = validateExtractionParams(url, start, end);
    if (!validation.valid) {
      console.warn(`[Validation Failure] Rejecting request: ${validation.error}`);
      return res.status(400).json({
        success: false,
        error: validation.error,
        code: validation.code
      });
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
        return res.status(500).json({
          success: false,
          error: 'Failed to register authentication cookies on server.',
          code: 'COOKIE_WRITE_FAILED'
        });
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
      cookiePath,
      status: 'initiated',
      createdAt: Date.now()
    });

    console.log(`[Extraction Start] Job ID: ${fileId}, URL: ${url}, Range: ${start}-${end}, Quality: ${quality}, Format: ${format}`);

    // Automatically expire job parameters after config expiry limit to prevent memory leaks
    setTimeout(() => {
      if (activeJobs.has(fileId)) {
        const job = activeJobs.get(fileId);
        if (job.hasCookies && job.cookiePath && fs.existsSync(job.cookiePath)) {
          try { fs.unlinkSync(job.cookiePath); } catch (e) {}
        }
        activeJobs.delete(fileId);
      }
    }, CONFIG.JOB_EXPIRY_MS);

    return res.json({ success: true, fileId });
  } catch (err) {
    console.error('[Initiate] Unexpected error:', err);
    sendTelegramAlert('Initiate Job Exception', req.body.url, req.body.quality, req.body.format_id, err.stack || err.message, 'N/A');
    return res.status(500).json({
      success: false,
      error: 'Clip extraction failed. Please try again.',
      code: 'UNEXPECTED_ERROR'
    });
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
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ type, message })}\n\n`);
      if (typeof res.flush === 'function') res.flush();
    }
  };
  // SSE connection established

  if (!fileId || !activeJobs.has(fileId)) {
    logToClient('error', 'Job expired or invalid session ID. Please re-initiate extraction.');
    clearInterval(keepaliveInterval);
    return res.end();
  }

  // Verify concurrency limit before spawning
  if (getActiveExtractionsCount() >= CONFIG.MAX_CONCURRENT_EXTRACTIONS) {
    logToClient('error', 'Server is currently busy. Please wait for existing extraction jobs to complete.');
    clearInterval(keepaliveInterval);
    return res.end();
  }

  const job = activeJobs.get(fileId);
  const { url, start, end, format, quality, format_id, hasCookies, cookiePath } = job;

  // Basic validation of start/end format
  const timeRegex = /^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;
  if (!timeRegex.test(start) || !timeRegex.test(end)) {
    logToClient('error', 'Timestamps must be formatted exactly as HH:MM:SS.');
    clearInterval(keepaliveInterval);
    return res.end();
  }

  let localYtdlpCmd;
  try {
    localYtdlpCmd = resolveYtdlpPath();
  } catch (err) {
    console.error(`[Extract] Dependency resolution failed: ${err.message}`);
    logToClient('error', 'Service temporarily unavailable. Please try again later.');
    clearInterval(keepaliveInterval);
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

  const child = spawn(localYtdlpCmd, args, { env: ytdlpEnv() });
  // Set job status to running and attach child handle ONLY after successful spawn
  job.status = 'running';
  job.child = child;

  let stderrBuffer = '';

  // ── Two-pass progress tracking ───────────────────────────────────────────
  // For video+audio extractions, yt-dlp runs two download passes (video then
  // audio), each emitting 0→100%. We remap them to separate thirds so the
  // progress bar climbs smoothly instead of resetting.
  // Pass 0 = video  → display 0–47%
  // Pass 1 = audio  → display 48–94%
  // Merger / ffmpeg → display 97%
  // completed event → display 100%
  let downloadPass = 0;        // which stream pass we're in (0-indexed)
  let lastRawPct  = -1;        // last received raw pct to detect pass resets

  function remapPct(rawPct) {
    if (isAudio) {
      // Single audio-only pass: 0–94%
      return Math.min(rawPct * 0.94, 94);
    }
    if (downloadPass === 0) {
      // First pass (video): 0–47%
      return Math.min(rawPct * 0.47, 47);
    }
    // Second pass (audio): 48–94%
    return 48 + Math.min(rawPct * 0.46, 46);
  }

  function processOutputLine(line, isStderr) {
    const trimmed = line.trim();
    if (!trimmed) return;

    if (isStderr) {
      stderrBuffer += trimmed + '\n';
      console.log(`[yt-dlp stderr] ${trimmed}`);
    } else {
      console.log(`[yt-dlp stdout] ${trimmed}`);
    }

    // ── Progress lines ────────────────────────────────────────────────────
    if (/\[download\]/i.test(trimmed)) {
      const pctMatch = trimmed.match(/(\d+(?:\.\d+)?)%/);
      if (pctMatch) {
        const rawPct = parseFloat(pctMatch[1]);

        // Detect a new download pass: percentage reset to a value much lower
        // than the last seen value (e.g. 100→0 between video and audio pass)
        if (rawPct < lastRawPct - 30 && lastRawPct > 50) {
          downloadPass++;
          console.log(`[Progress] Detected new download pass: ${downloadPass}`);
        }
        lastRawPct = rawPct;

        const displayPct = remapPct(rawPct);
        logToClient('progress', { stage: 'Downloading stream...', pct: displayPct });

      } else if (trimmed.includes('Destination:')) {
        // New stream file started — treat as a new pass boundary if past first
        if (lastRawPct >= 99) {
          downloadPass++;
          lastRawPct = 0;
          console.log(`[Progress] New Destination detected — pass ${downloadPass}`);
        }
        logToClient('status', 'Fetching next stream...');
      } else {
        logToClient('status', 'Downloading stream...');
      }

    } else if (/\[Merger\]|\[ffmpeg\]|\[ExtractAudio\]/i.test(trimmed)) {
      logToClient('progress', { stage: 'Finalizing clip...', pct: 97 });
    }
  }

  child.stdout.on('data', (data) => {
    data.toString().split('\n').forEach(line => {
      processOutputLine(line, false);
    });
  });

  child.stderr.on('data', (data) => {
    data.toString().split('\n').forEach(line => {
      processOutputLine(line, true);
    });
  });


  let isFinished = false;
  let isCompletedSuccessfully = false;

  const finish = (errType = null) => {
    if (isFinished) return;
    isFinished = true;

    clearInterval(keepaliveInterval);

    // Update status in activeJobs
    if (isCompletedSuccessfully) {
      job.status = 'completed';
    } else if (errType === 'abort') {
      job.status = 'aborted';
    } else {
      job.status = 'failed';
    }

    if (child && !child.killed) {
      try {
        child.kill('SIGKILL');
      } catch (_) {}
    }

    // Clear process handle
    job.child = null;

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

    // Defensive cleanup of partial files on abort/failure
    if (!isCompletedSuccessfully) {
      const partPath = `${outputPath}.part`;
      [outputPath, partPath].forEach(p => {
        try {
          if (fs.existsSync(p)) {
            fs.unlinkSync(p);
            console.log(`[Cleanup] Deleted incomplete file: ${p}`);
          }
        } catch (unlinkErr) {
          console.error(`[Cleanup] Failed to delete incomplete file ${p}:`, unlinkErr);
        }
      });
    }

    // Remove job from active registry
    activeJobs.delete(fileId);

    if (!res.writableEnded) {
      res.end();
    }
  };

  child.on('error', (err) => {
    if (isFinished) return;
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
    if (isFinished) return;

    if (code === 0 && fs.existsSync(outputPath)) {
      const fileRes = getFileResolution(outputPath);
      console.log(`[Final Output] resolution=${fileRes}, postprocessor=${postprocessorArgs || 'none'}`);
      isCompletedSuccessfully = true;
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
      
      const isCookieError = stderrBuffer.includes("Sign in to confirm you're not a bot") ||
                            stderrBuffer.includes('Sign in to confirm your age') ||
                            stderrBuffer.includes('cookies have');
      
      // Filter out alerts for routine errors
      sendTelegramAlert('Extraction - Process Error', url, quality, format_id, `Exit Code: ${code}\nStderr: ${stderrBuffer.substring(0, 300)}`, fileId);
      
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
    if (isFinished) return;
    console.log(`[Abort] SSE client closed connection for Job: ${fileId}`);
    finish('abort');
  });

  } catch (err) {
    console.error('[Extract Stream] Unexpected error:', err);
    sendTelegramAlert('Extraction - Stream Exception', req.query.url, 'N/A', 'N/A', err.stack || err.message, req.query.fileId);
    if (!res.writableEnded) {
      try {
        res.write(`data: ${JSON.stringify({ type: 'error', message: 'An unexpected server error occurred.' })}\n\n`);
        res.end();
      } catch (e) {}
    }
  }
});

// Check if global pre-registered cookies exist
app.get('/api/settings/cookies/check', (req, res) => {
  const exists = fs.existsSync(globalCookiePath);
  res.json({ hasGlobalCookies: exists });
});

app.get('/api/debug/cookies', (req, res) => {
  res.json({
    dirname: __dirname,
    binDir,
    globalCookiePath,
    exists: fs.existsSync(globalCookiePath),
    binContents: fs.existsSync(binDir) ? fs.readdirSync(binDir) : []
  });
});


// GET /api/health: Public status diagnostics (no sensitive paths, directories, tokens, or arguments)
app.get('/api/health', (req, res) => {
  try {
    const ytDlpExists = !!ytdlpCmd && fs.existsSync(ytdlpCmd);
    const ffmpegExists = !!resolvedFFmpegPath && fs.existsSync(resolvedFFmpegPath);
    const cookiesPresent = fs.existsSync(globalCookiePath);
    
    res.json({
      status: 'ok',
      uptime: Math.round(process.uptime()),
      environment: process.env.NODE_ENV || 'development',
      timestamp: new Date().toISOString(),
      ytDlp: ytDlpExists,
      ffmpeg: ffmpegExists,
      activeJobs: getActiveExtractionsCount(),
      cookiesPresent: cookiesPresent
    });
  } catch (err) {
    console.error('[Health] Failed to get health status:', err);
    res.status(500).json({
      success: false,
      error: 'Health check failed',
      code: 'HEALTH_CHECK_FAILED'
    });
  }
});

// GET /api/health/detailed: Development detailed diagnostics (forbidden in production)
app.get('/api/health/detailed', (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({
      success: false,
      error: 'Forbidden in production environment.',
      code: 'FORBIDDEN'
    });
  }
  
  try {
    const activeJobIds = Array.from(activeJobs.keys());
    const detailedJobs = Array.from(activeJobs.entries()).map(([id, job]) => ({
      id,
      status: job.status,
      createdAt: job.createdAt,
      hasCookies: job.hasCookies,
      quality: job.quality,
      format: job.format
    }));
    
    res.json({
      status: 'ok',
      uptime: Math.round(process.uptime()),
      environment: process.env.NODE_ENV || 'development',
      timestamp: new Date().toISOString(),
      activeJobsCount: getActiveExtractionsCount(),
      activeJobIds,
      activeJobs: detailedJobs,
      memoryUsage: process.memoryUsage(),
      sweepStats
    });
  } catch (err) {
    console.error('[Health Detailed] Failed to fetch detailed health status:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch detailed health report',
      code: 'HEALTH_DETAILED_FAILED'
    });
  }
});


// Save global cookies permanently on the server
app.post('/api/settings/cookies', (req, res) => {
  const { cookies } = req.body;
  if (!cookies || !cookies.trim()) {
    return res.status(400).json({ success: false, error: 'Cookies content cannot be empty.', code: 'INVALID_COOKIES' });
  }

  try {
    fs.writeFileSync(globalCookiePath, cookies.trim(), 'utf8');
    console.log('[Settings] Pre-registered global server-side cookies file successfully.');
    res.json({ success: true });
  } catch (err) {
    console.error('[Settings] Failed to write global cookies file:', err);
    res.status(500).json({ success: false, error: `Failed to write cookies file on server: ${err.message}`, code: 'COOKIE_WRITE_FAILED' });
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
    res.status(500).json({ success: false, error: `Failed to purge cookies file on server: ${err.message}`, code: 'COOKIE_DELETE_FAILED' });
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
  
  // Filter out alerts for routine errors (validation failures, rate limits, bad requests, client aborts)
  const lowerMsg = rawMsg.toLowerCase();
  const isRoutineError = 
    lowerMsg.includes('private video') ||
    lowerMsg.includes('video is private') ||
    lowerMsg.includes('video unavailable') ||
    lowerMsg.includes('is unavailable') ||
    lowerMsg.includes('has been removed') ||
    lowerMsg.includes('copyright') ||
    lowerMsg.includes('rate limit') ||
    lowerMsg.includes('too many requests') ||
    lowerMsg.includes('abort') ||
    lowerMsg.includes('sigkill') ||
    lowerMsg.includes('econnreset') ||
    lowerMsg.includes('closed') ||
    lowerMsg.includes('connection reset');

  if (isRoutineError) {
    console.log(`[Telegram Alert] Suppressed routine alert: stage=${stage}, error=${rawMsg.substring(0, 80).replace(/\n/g, ' ')}`);
    return;
  }

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
    // Delete file immediately after response closes (always run cleanup)
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`[Delivery] Surgically purged temporary file: ${filePath}`);
      }
    } catch (unlinkErr) {
      console.error('[Delivery] Error deleting file:', unlinkErr);
    }

    if (err) {
      // Avoid Telegram alert on standard user cancel / abort
      if (err.code !== 'ECONNRESET' && !err.message?.includes('aborted')) {
        console.error(`[Delivery] Error downloading file:`, err);
        sendTelegramAlert('Delivery - Download Error', 'N/A', 'N/A', 'N/A', err.message, fileId);
      }
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
