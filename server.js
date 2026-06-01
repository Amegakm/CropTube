import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { spawn, execSync } from 'child_process';
import axios from 'axios';

// Initialize __dirname for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

// Create necessary folders
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
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

// SSE Clip Extraction Stream
app.get('/api/extract', async (req, res) => {
  const { url, start, end, quality } = req.query;

  // Set headers for Server-Sent Events (SSE)
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const logToClient = (type, message) => {
    res.write(`data: ${JSON.stringify({ type, message })}\n\n`);
  };

  logToClient('log', '⚡ Establishing SSE tunnel with CropTube extraction backend...');

  if (!url || !start || !end) {
    logToClient('error', 'Missing required parameters: url, start, end timestamps.');
    return res.end();
  }

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

  const fileId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  const outputFilename = `croptube_${fileId}.mp4`;
  const outputPath = path.join(tempDir, outputFilename);

  // Map quality constraints
  let formatSelector = 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]'; // Default best (1080p+)
  if (quality === '720p') {
    formatSelector = 'bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]';
  } else if (quality === '480p') {
    formatSelector = 'bv*[height<=480][ext=mp4]+ba[ext=m4a]/b[height<=480][ext=mp4]';
  } else if (quality === '360p') {
    formatSelector = 'bv*[height<=360][ext=mp4]+ba[ext=m4a]/b[height<=360][ext=mp4]';
  }

  // Exact syntax structure requested by user with dynamic quality selection and sync desync correction
  const args = [
    '--download-sections', `*${start}-${end}`,
    '--force-keyframes-at-cuts',
    '-f', formatSelector,
    '--merge-output-format', 'mp4',
    url,
    '-o', outputPath
  ];

  logToClient('log', `🎬 Initiating surgical stream-seek for duration [${start} to ${end}]`);
  logToClient('log', `🚀 Executing: yt-dlp --download-sections "*${start}-${end}" --force-keyframes-at-cuts -f "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]" [URL]`);

  const child = spawn(ytdlpCmd, args);

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

  child.on('error', (err) => {
    logToClient('error', `Process execution failed: ${err.message}`);
    res.end();
  });

  child.on('close', (code) => {
    if (code === 0 && fs.existsSync(outputPath)) {
      logToClient('log', '✅ Stream cutting & output merging completed successfully!');
      logToClient('complete', { fileId, filename: outputFilename });
    } else {
      logToClient('error', `yt-dlp process terminated with exit code: ${code}. Check logs above for details.`);
    }
    res.end();
  });

  // If the user aborts/closes the page, terminate the spawned yt-dlp process
  req.on('close', () => {
    if (child && !child.killed) {
      console.log(`[Abort] SSE client disconnected. Terminating child process PID: ${child.pid}`);
      child.kill('SIGKILL');
    }
  });
});

// Download Endpoint - Downloads clip then immediately cleans it up
app.get('/api/download/:fileId', (req, res) => {
  const { fileId } = req.params;
  const filePath = path.join(tempDir, `croptube_${fileId}.mp4`);

  if (!fs.existsSync(filePath)) {
    return res.status(404).send('Error: Clip file not found or has already been deleted.');
  }

  console.log(`[Delivery] Serving file to client: ${filePath}`);
  
  res.download(filePath, `CropTube_Clip_${fileId}.mp4`, (err) => {
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
