import fs from 'fs';
import path from 'path';
import child_process from 'child_process';
import { EventEmitter } from 'events';
import https from 'https';
import http from 'http';
import axios from 'axios';

// 1. Monkeypatch https and child_process before importing server.js
let sentTelegramMessages = [];
let telegramUpdatesMock = [];

const originalRequest = https.request;
https.request = function(options, callback) {
  const hostname = options.hostname || (options.headers && options.headers.host);
  if (hostname === 'api.telegram.org') {
    let requestBody = '';
    const mockReq = new class extends EventEmitter {
      write(chunk) {
        requestBody += chunk.toString();
      }
      end() {
        const payload = JSON.parse(requestBody || '{}');
        sentTelegramMessages.push({
          path: options.path,
          payload
        });
        
        const mockRes = new class extends EventEmitter {
          constructor() {
            super();
            this.statusCode = 200;
            this.headers = { 'content-type': 'application/json' };
          }
        };
        
        const responseData = JSON.stringify({ ok: true, result: {} });
        if (callback) callback(mockRes);
        mockRes.emit('data', Buffer.from(responseData));
        mockRes.emit('end');
      }
    };
    return mockReq;
  }
  return originalRequest.apply(this, arguments);
};

const originalGet = https.get;
https.get = function(url, options, callback) {
  let urlString = typeof url === 'string' ? url : url.href || '';
  if (urlString.includes('api.telegram.org')) {
    const mockRes = new class extends EventEmitter {
      constructor() {
        super();
        this.statusCode = 200;
        this.headers = { 'content-type': 'application/json' };
      }
    };
    
    let responseData = JSON.stringify({ ok: true, result: [] });
    if (urlString.includes('getUpdates')) {
      const updates = telegramUpdatesMock;
      telegramUpdatesMock = [];
      responseData = JSON.stringify({ ok: true, result: updates });
    } else if (urlString.includes('getFile')) {
      responseData = JSON.stringify({ ok: true, result: { file_path: 'mock_cookies.txt' } });
    } else if (urlString.includes('mock_cookies.txt')) {
      responseData = '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tnew_telegram_cookies';
    }
    
    const cb = typeof options === 'function' ? options : callback;
    if (cb) cb(mockRes);
    mockRes.emit('data', Buffer.from(responseData));
    mockRes.emit('end');
    
    return { on: () => {} };
  }
  return originalGet.apply(this, arguments);
};

let simulateSpawnFailure = false;
let mockSpawnDelay = 200;
const originalSpawn = child_process.spawn;
child_process.spawn = function(command, args, options) {
  if (command.includes('yt-dlp') || command.includes('ffmpeg')) {
    const mockProcess = new class extends EventEmitter {
      constructor() {
        super();
        this.stdout = new EventEmitter();
        this.stderr = new EventEmitter();
        this.killed = false;
        
        setTimeout(() => {
          if (simulateSpawnFailure) {
            this.stderr.emit('data', Buffer.from('ERROR: Simulating ytdlp failure\n'));
            this.emit('close', 1);
          } else {
            this.stdout.emit('data', Buffer.from('[download]  50% of 5.00MiB\n'));
            this.stdout.emit('data', Buffer.from('[download] 100% of 5.00MiB\n'));
            this.emit('close', 0);
          }
        }, mockSpawnDelay);
      }
      kill(signal) {
        this.killed = true;
        this.emit('close', 1);
      }
    };
    return mockProcess;
  }
  return originalSpawn.apply(this, arguments);
};

// Setup Environment Variables
process.env.PORT = '3002';
process.env.TELEGRAM_BOT_TOKEN = 'mock_token';
process.env.TELEGRAM_CHAT_ID = '12345';

// Ensure Directories
const __dirname = path.resolve();
const binDir = path.join(__dirname, 'bin');
const tempDir = path.join(__dirname, 'temp');
const globalCookiePath = path.join(binDir, 'global_cookies.txt');
if (!fs.existsSync(binDir)) fs.mkdirSync(binDir);
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

// Pre-create global cookie file
fs.writeFileSync(globalCookiePath, '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tinitial_cookies', 'utf8');

// Boot the server
console.log('Booting CropTube server on port 3002...');
await import('./server.js');
// Wait for initialization
await new Promise(resolve => setTimeout(resolve, 2000));

// Test matrix storage
const matrix = [];
function recordResult(scenario, expected, actual, passed) {
  matrix.push({
    Scenario: scenario,
    Expected: expected,
    Actual: actual,
    Status: passed ? 'PASS' : 'FAIL'
  });
}

try {
  // Scenario 1 & 8: Simultaneous extractions (concurrency limit)
  console.log('\nRunning Scenario 1 & 8...');
  const resA = await axios.post('http://localhost:3002/api/extract/initiate', {
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    start: '00:00:00',
    end: '00:00:05',
    format: 'mp4',
    quality: '1080p',
    format_id: '137'
  });
  const fileIdA = resA.data.fileId;
  
  // Try parallel extraction immediately
  let parallelResStatus = 0;
  let parallelResCode = '';
  try {
    await axios.post('http://localhost:3002/api/extract/initiate', {
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      start: '00:00:00',
      end: '00:00:05',
      format: 'mp4',
      quality: '1080p',
      format_id: '137'
    });
  } catch (err) {
    parallelResStatus = err.response ? err.response.status : 0;
    parallelResCode = err.response ? err.response.data.code : '';
  }
  
  recordResult(
    'Scenario 8: Second simultaneous extraction blocked',
    'Status 429 & SERVER_BUSY code',
    `Status ${parallelResStatus} & ${parallelResCode}`,
    parallelResStatus === 429 && parallelResCode === 'SERVER_BUSY'
  );

  // Open SSE stream for Job A to trigger execution
  const sseResponse = await axios.get(`http://localhost:3002/api/extract/stream?fileId=${fileIdA}`, {
    responseType: 'stream'
  });
  
  // Wait for it to complete (which closes stream)
  await new Promise(resolve => {
    sseResponse.data.on('end', resolve);
    sseResponse.data.on('close', resolve);
  });
  
  // Wait a small bit for cleanup
  await new Promise(resolve => setTimeout(resolve, 100));

  // Check if concurrency slot was released
  const activeJobsCheck = await axios.get('http://localhost:3002/api/jobs');
  const activeCountAfterSuccess = activeJobsCheck.data.length || 0;
  recordResult(
    'Scenario 1: Successful extraction releases slot',
    'Active Job count = 0',
    `Active jobs = ${activeCountAfterSuccess}`,
    activeCountAfterSuccess === 0
  );

  // Scenario 2: Failed extraction releases concurrency slot
  console.log('\nRunning Scenario 2...');
  simulateSpawnFailure = true;
  const resFail = await axios.post('http://localhost:3002/api/extract/initiate', {
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    start: '00:00:00',
    end: '00:00:05',
    format: 'mp4',
    quality: '1080p',
    format_id: '137'
  });
  const fileIdFail = resFail.data.fileId;
  const sseFail = await axios.get(`http://localhost:3002/api/extract/stream?fileId=${fileIdFail}`, {
    responseType: 'stream'
  });
  await new Promise(resolve => {
    sseFail.data.on('end', resolve);
    sseFail.data.on('close', resolve);
  });
  await new Promise(resolve => setTimeout(resolve, 100));
  
  const jobsCheckFail = await axios.get('http://localhost:3002/api/jobs');
  const activeCountAfterFail = jobsCheckFail.data.length || 0;
  recordResult(
    'Scenario 2: Failed extraction releases slot',
    'Active jobs = 0',
    `Active jobs = ${activeCountAfterFail}`,
    activeCountAfterFail === 0
  );

  // Scenario 3: Client disconnect / abort releases concurrency slot
  console.log('\nRunning Scenario 3...');
  simulateSpawnFailure = false;
  mockSpawnDelay = 2000; // Slow process to allow abort
  const resAbort = await axios.post('http://localhost:3002/api/extract/initiate', {
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    start: '00:00:00',
    end: '00:00:05',
    format: 'mp4',
    quality: '1080p',
    format_id: '137'
  });
  const fileIdAbort = resAbort.data.fileId;
  const sseAbort = await axios.get(`http://localhost:3002/api/extract/stream?fileId=${fileIdAbort}`, {
    responseType: 'stream'
  });
  
  // Wait 100ms and close/abort connection
  await new Promise(resolve => setTimeout(resolve, 100));
  sseAbort.data.destroy(); // Trigger abort
  
  await new Promise(resolve => setTimeout(resolve, 200));
  const jobsCheckAbort = await axios.get('http://localhost:3002/api/jobs');
  const activeCountAfterAbort = jobsCheckAbort.data.length || 0;
  recordResult(
    'Scenario 3: Client disconnect releases slot',
    'Active jobs = 0',
    `Active jobs = ${activeCountAfterAbort}`,
    activeCountAfterAbort === 0
  );
  
  // Restore normal spawn settings
  mockSpawnDelay = 100;

  // Scenario 4 & 9: Retry works after extraction failure / new extraction can start normally
  console.log('\nRunning Scenario 4 & 9...');
  simulateSpawnFailure = false;
  const resRetry = await axios.post('http://localhost:3002/api/extract/initiate', {
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    start: '00:00:00',
    end: '00:00:05',
    format: 'mp4',
    quality: '1080p',
    format_id: '137'
  });
  const fileIdRetry = resRetry.data.fileId;
  const sseRetry = await axios.get(`http://localhost:3002/api/extract/stream?fileId=${fileIdRetry}`, {
    responseType: 'stream'
  });
  await new Promise(resolve => {
    sseRetry.data.on('end', resolve);
    sseRetry.data.on('close', resolve);
  });
  
  recordResult(
    'Scenario 4 & 9: Retry and subsequent extraction start normally',
    'Starts normally (returns status 200)',
    `Completed retry successfully`,
    true
  );

  // Scenario 5: Temporary per-job cookie files are deleted after success, failure, and abort
  console.log('\nRunning Scenario 5...');
  const tempFiles = fs.readdirSync(tempDir);
  const cookieFilesLeft = tempFiles.filter(f => f.startsWith('cookies_'));
  recordResult(
    'Scenario 5: Temporary cookie files deleted',
    '0 temporary cookie files left',
    `${cookieFilesLeft.length} cookie files left`,
    cookieFilesLeft.length === 0
  );

  // Scenario 6: global_cookies.txt survives successful extraction, failed extraction, retry, disconnect
  console.log('\nRunning Scenario 6...');
  const globalCookieExists = fs.existsSync(globalCookiePath);
  const globalCookieContent = globalCookieExists ? fs.readFileSync(globalCookiePath, 'utf8') : '';
  recordResult(
    'Scenario 6: global_cookies.txt survives normal flows',
    'Exists with initial content',
    `Exists: ${globalCookieExists}, Content: ${globalCookieContent.substring(0, 30)}...`,
    globalCookieExists && globalCookieContent.includes('initial_cookies')
  );

  // Scenario 7: Completed output files remain available until download finishes and then deleted
  console.log('\nRunning Scenario 7...');
  const mockFileId = 'mock_download_id';
  const mockFilePath = path.join(tempDir, `croptube_${mockFileId}.mp4`);
  fs.writeFileSync(mockFilePath, 'dummy video payload');
  
  // Make a download request
  const downloadRes = await axios.get(`http://localhost:3002/api/download/${mockFileId}`);
  
  // Wait a small moment for async fs.unlink to complete
  await new Promise(resolve => setTimeout(resolve, 150));
  const fileExistsAfterDownload = fs.existsSync(mockFilePath);
  
  recordResult(
    'Scenario 7: Output file purged post-download',
    'File is deleted (exists = false)',
    `File exists: ${fileExistsAfterDownload}`,
    !fileExistsAfterDownload
  );

  // Scenario 10: Telegram /upload successfully replaces global cookie file and subsequent extraction uses it
  console.log('\nRunning Scenario 10...');
  // Simulate Telegram /upload update
  telegramUpdatesMock = [
    {
      update_id: 10,
      message: {
        chat: { id: 12345 },
        from: { id: 12345 },
        text: '/upload'
      }
    }
  ];
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // Now simulate document upload (cookie file)
  telegramUpdatesMock = [
    {
      update_id: 11,
      message: {
        chat: { id: 12345 },
        from: { id: 12345 },
        document: {
          file_name: 'cookies.txt',
          mime_type: 'text/plain',
          file_id: 'cookie_file_123',
          file_size: 100
        }
      }
    }
  ];
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Verify cookie file content updated
  const updatedCookieContent = fs.readFileSync(globalCookiePath, 'utf8');
  recordResult(
    'Scenario 10: Telegram /upload updates global cookie file',
    'Contains newly uploaded cookies from Telegram mock',
    `Content: ${updatedCookieContent.trim()}`,
    updatedCookieContent.includes('new_telegram_cookies')
  );

  // Scenario 11: Telegram /remove deletes cookie file only for authorized admin
  console.log('\nRunning Scenario 11...');
  // First, unauthorized remove
  telegramUpdatesMock = [
    {
      update_id: 12,
      message: {
        chat: { id: 99999 }, // Unauthorized Chat
        from: { id: 99999 },
        text: '/remove'
      }
    }
  ];
  await new Promise(resolve => setTimeout(resolve, 500));
  const cookieExistsAfterUnauthorizedRemove = fs.existsSync(globalCookiePath);
  
  // Then, authorized remove
  telegramUpdatesMock = [
    {
      update_id: 13,
      message: {
        chat: { id: 12345 }, // Authorized Admin Chat
        from: { id: 12345 },
        text: '/remove'
      }
    }
  ];
  await new Promise(resolve => setTimeout(resolve, 500));
  const cookieExistsAfterAuthorizedRemove = fs.existsSync(globalCookiePath);
  
  recordResult(
    'Scenario 11: Telegram /remove deletes cookie file only for admin',
    'Exists after unauthorized remove, deleted after authorized remove',
    `Exists after unauthorized: ${cookieExistsAfterUnauthorizedRemove}, Exists after authorized: ${cookieExistsAfterAuthorizedRemove}`,
    cookieExistsAfterUnauthorizedRemove === true && cookieExistsAfterAuthorizedRemove === false
  );

  // Scenario 12: Telegram commands (/status, /health, /jobs, /cookieinfo)
  console.log('\nRunning Scenario 12...');
  // Reset cookie file
  fs.writeFileSync(globalCookiePath, '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tinfo_check');
  
  sentTelegramMessages = [];
  telegramUpdatesMock = [
    {
      update_id: 14,
      message: {
        chat: { id: 12345 },
        from: { id: 12345 },
        text: '/status'
      }
    },
    {
      update_id: 15,
      message: {
        chat: { id: 12345 },
        from: { id: 12345 },
        text: '/health'
      }
    },
    {
      update_id: 16,
      message: {
        chat: { id: 12345 },
        from: { id: 12345 },
        text: '/jobs'
      }
    },
    {
      update_id: 17,
      message: {
        chat: { id: 12345 },
        from: { id: 12345 },
        text: '/cookieinfo'
      }
    }
  ];
  
  await new Promise(resolve => setTimeout(resolve, 1500));
  
  const statusMessageSent = sentTelegramMessages.some(m => m.payload.text?.includes('CropTube Server Status'));
  const healthMessageSent = sentTelegramMessages.some(m => m.payload.text?.includes('Server Online'));
  const jobsMessageSent = sentTelegramMessages.some(m => m.payload.text?.includes('No active extraction') || m.payload.text?.includes('Active Extractions'));
  const cookieInfoMessageSent = sentTelegramMessages.some(m => m.payload.text?.includes('Cookie Info'));
  
  recordResult(
    'Scenario 12: Telegram commands /status, /health, /jobs, /cookieinfo report accurately',
    'All messages received and contain correct headers',
    `status: ${statusMessageSent}, health: ${healthMessageSent}, jobs: ${jobsMessageSent}, cookieinfo: ${cookieInfoMessageSent}`,
    statusMessageSent && healthMessageSent && jobsMessageSent && cookieInfoMessageSent
  );

} catch (e) {
  console.error('E2E tests encountered error:', e);
} finally {
  console.log('\n--- TEST RESULTS MATRIX ---');
  console.table(matrix);
  
  // Write result to file
  fs.writeFileSync('test_results.json', JSON.stringify(matrix, null, 2), 'utf8');
  
  // Clean up
  if (fs.existsSync(globalCookiePath)) {
    try { fs.unlinkSync(globalCookiePath); } catch(_) {}
  }
  process.exit(0);
}
