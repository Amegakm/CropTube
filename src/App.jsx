import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Scissors, Play, Download, Video, Clock,
  Terminal as TerminalIcon, AlertCircle, CheckCircle2,
  Loader2, Info, Crosshair, SkipBack, SkipForward, Trash2
} from 'lucide-react';

// ─── Helpers ────────────────────────────────────────────────────────────────

function secsToHMS(s) {
  if (isNaN(s) || s < 0) return '00:00:00';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return [h, m, sec].map(n => String(n).padStart(2, '0')).join(':');
}

function hmsToSecs(hms) {
  if (!hms) return 0;
  const parts = hms.split(':').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return 0;
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

// Validates and normalises a raw string → HH:MM:SS (returns null if invalid)
function normaliseHMS(raw) {
  const cleaned = raw.replace(/[^\d:]/g, '');
  const parts = cleaned.split(':');
  if (parts.length !== 3) return null;
  const [h, m, s] = parts.map(Number);
  if ([h, m, s].some(isNaN)) return null;
  if (m > 59 || s > 59) return null;
  return [h, m, s].map(n => String(n).padStart(2, '0')).join(':');
}

// ─── TimeMarker: single HH:MM:SS input with Grab + Seek buttons ─────────────

function TimeMarker({ label, accent, value, onChange, onGrab, onSeek, disabled, playerReady }) {
  const [grabbed, setGrabbed]   = useState(false);
  const [seeked,  setSeeked]    = useState(false);
  const [raw,     setRaw]       = useState(value);
  const [valid,   setValid]     = useState(true);

  // Keep raw in sync when parent changes value (e.g. on grab)
  useEffect(() => { setRaw(value); setValid(true); }, [value]);

  const handleChange = (e) => {
    const v = e.target.value;
    setRaw(v);
    const norm = normaliseHMS(v);
    if (norm) { setValid(true); onChange(norm); }
    else        setValid(false);
  };

  const handleBlur = () => {
    const norm = normaliseHMS(raw);
    if (norm) { setRaw(norm); setValid(true); onChange(norm); }
    else       { setRaw(value); setValid(true); }           // revert on bad input
  };

  const handleGrab = () => {
    onGrab();
    setGrabbed(true);
    setTimeout(() => setGrabbed(false), 950);
  };

  const handleSeek = () => {
    onSeek();
    setSeeked(true);
    setTimeout(() => setSeeked(false), 600);
  };

  const borderClass = grabbed
    ? 'grab-flash border-emerald-500'
    : !valid
    ? 'border-rose-500'
    : 'border-slate-700 focus-within:border-indigo-500';

  return (
    <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3">
      <div className="flex justify-between items-center">
        <span className={`text-xs font-semibold uppercase tracking-wider ${accent}`}>{label}</span>
        {grabbed && (
          <span className="text-[10px] text-emerald-400 font-mono animate-pulse">✓ Grabbed!</span>
        )}
        {!grabbed && !valid && (
          <span className="text-[10px] text-rose-400 font-mono">Invalid format</span>
        )}
      </div>

      {/* Single HH:MM:SS input */}
      <input
        type="text"
        value={raw}
        onChange={handleChange}
        onBlur={handleBlur}
        placeholder="HH:MM:SS"
        maxLength={8}
        disabled={!playerReady || disabled}
        className={`w-full text-center text-2xl font-mono font-bold tracking-widest bg-transparent border-b-2 pb-1
          outline-none transition-all duration-200 text-slate-100
          disabled:opacity-40 disabled:cursor-not-allowed
          ${borderClass}`}
      />

      <div className="grid grid-cols-2 gap-2">
        {/* Grab current player time */}
        <button
          onClick={handleGrab}
          disabled={!playerReady || disabled}
          title="Capture current player time"
          className="flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold
            bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-700
            text-slate-300 hover:text-white transition-all
            disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Crosshair className="w-3.5 h-3.5" />
          Grab Time
        </button>

        {/* Seek player to this marker */}
        <button
          onClick={handleSeek}
          disabled={!playerReady || disabled}
          title="Seek player to this time"
          className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold
            bg-indigo-950/50 hover:bg-indigo-900/60 border border-indigo-900/50 hover:border-indigo-700
            text-indigo-300 hover:text-indigo-100 transition-all
            disabled:opacity-40 disabled:cursor-not-allowed
            ${seeked ? 'seek-pulse' : ''}`}
        >
          <Play className="w-3.5 h-3.5" />
          Seek to ▶
        </button>
      </div>
    </div>
  );
}

// ─── Log line noise filter ────────────────────────────────────────────────────
// Hides verbose ffmpeg metadata lines that clutter the terminal output.
const NOISE_PATTERNS = [
  /^Input #\d/,
  /^\s+Metadata:/,
  /major_brand/,
  /minor_version/,
  /compatible_brands/,
  /creation_time/,
  /handler_name/,
  /vendor_id/,
  /encoder\s*:/i,
  /^\s+Stream #\d.*Video:/,
  /^\s+Stream #\d.*Audio:/,
  /Output #\d/,
  /^\s+Stream #0:\d.*\(und\)/,
  /Side data:/,
  /cpb: bitrate/,
  /^\s+Duration: \d/,
  /Press \[q\]/,
  /using cpu capabilities/,
  /profile High/,
  /264 - core \d/,
  /options: cabac/,
  /using SAR/,
  /^Stream mapping:/,
  /Stream #\d:\d -> #\d:\d/,
];

function isNoisyLine(text) {
  return NOISE_PATTERNS.some(p => p.test(text));
}

// ─── Main App ────────────────────────────────────────────────────────────────

export default function App() {
  const [youtubeUrl, setYoutubeUrl]       = useState('');
  const [videoId, setVideoId]             = useState('');
  const [startTime, setStartTime]         = useState('00:00:00');
  const [endTime, setEndTime]             = useState('00:00:00');
  const [duration, setDuration]           = useState(0);
  const [playerReady, setPlayerReady]     = useState(false);
  const [extracting, setExtracting]       = useState(false);
  const [logs, setLogs]                   = useState([]);
  const [clipsHistory, setClipsHistory]   = useState([]);
  const [currentStep, setCurrentStep]     = useState(0);
  const [errorMsg, setErrorMsg]           = useState('');
  const [quality, setQuality]             = useState('1080p');
  const [cookies, setCookies]             = useState(() => localStorage.getItem('croptube_cookies') || '');
  const [showCookies, setShowCookies]     = useState(false);
  const [hasGlobalCookies, setHasGlobalCookies] = useState(false);
  const [cookiesExpired, setCookiesExpired]     = useState(false);

  const playerRef      = useRef(null);
  const terminalEndRef = useRef(null);
  const ytApiReady     = useRef(false);

  // Persist cookies
  useEffect(() => { localStorage.setItem('croptube_cookies', cookies); }, [cookies]);

  // Check server cookies on mount
  useEffect(() => {
    fetch('/api/settings/cookies/check')
      .then(r => r.json())
      .then(d => setHasGlobalCookies(d.hasGlobalCookies))
      .catch(() => {});
  }, []);

  // Auto-scroll terminal
  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // ── Parse YouTube video ID from URL ──────────────────────────────────────
  useEffect(() => {
    if (!youtubeUrl) {
      setVideoId(''); setDuration(0); setPlayerReady(false);
      setStartTime('00:00:00'); setEndTime('00:00:00'); setErrorMsg('');
      return;
    }
    const m = youtubeUrl.match(/(?:youtu\.be\/|[?&]v=)([A-Za-z0-9_-]{11})/);
    if (m) { setVideoId(m[1]); setErrorMsg(''); }
    else    { setVideoId(''); setErrorMsg('Invalid YouTube URL. Paste a standard watch or share link.'); }
  }, [youtubeUrl]);

  // ── Load YouTube IFrame API once ──────────────────────────────────────────
  useEffect(() => {
    if (ytApiReady.current) return;
    ytApiReady.current = true;

    if (!window.YT) {
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(script);
    }
  }, []);

  // ── Create / replace YouTube player when videoId changes ─────────────────
  useEffect(() => {
    if (!videoId) { setPlayerReady(false); return; }

    setPlayerReady(false);

    const initPlayer = () => {
      // Destroy old player if exists
      if (playerRef.current && typeof playerRef.current.destroy === 'function') {
        try { playerRef.current.destroy(); } catch (_) {}
        playerRef.current = null;
      }

      // Recreate mount div (player API replaces the element)
      const container = document.getElementById('yt-player-wrap');
      if (!container) return;
      container.innerHTML = '';
      const el = document.createElement('div');
      el.id = 'yt-player-el';
      container.appendChild(el);

      playerRef.current = new window.YT.Player('yt-player-el', {
        height: '100%', width: '100%',
        videoId,
        playerVars: { autoplay: 0, modestbranding: 1, rel: 0, controls: 1 },
        events: {
          onReady: (e) => {
            const dur = e.target.getDuration();
            setDuration(dur);
            setStartTime('00:00:00');
            setEndTime(secsToHMS(dur));
            setPlayerReady(true);
          },
          onError: () => {
            setErrorMsg('Could not embed this video — the publisher may have restricted embedding.');
            setPlayerReady(false);
          }
        }
      });
    };

    if (window.YT && window.YT.Player) {
      initPlayer();
    } else {
      window.onYouTubeIframeAPIReady = initPlayer;
    }
  }, [videoId]);

  // ── Grab time from player ────────────────────────────────────────────────
  const grabTime = useCallback((setter) => {
    const player = playerRef.current;
    if (player && typeof player.getCurrentTime === 'function') {
      setter(secsToHMS(player.getCurrentTime()));
    }
  }, []);

  // ── Seek player to a time string ─────────────────────────────────────────
  const seekPlayer = useCallback((hms) => {
    const player = playerRef.current;
    if (player && typeof player.seekTo === 'function') {
      player.seekTo(hmsToSecs(hms), true);
    }
  }, []);

  // ── Cookie handlers ──────────────────────────────────────────────────────
  const saveCookies = () => {
    if (!cookies.trim()) { alert('Paste cookie text first.'); return; }
    fetch('/api/settings/cookies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cookies })
    })
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(() => {
        setHasGlobalCookies(true);
        setCookiesExpired(false);
        alert('✅ Cookies registered on cloud server! Works from all devices now.');
      })
      .catch(() => alert('Failed to save cookies.'));
  };

  const deleteCookies = () => {
    if (!confirm('Delete cloud cookies?')) return;
    fetch('/api/settings/cookies', { method: 'DELETE' })
      .then(r => r.json())
      .then(() => { setHasGlobalCookies(false); setCookies(''); })
      .catch(() => {});
  };

  // ── Extract clip ─────────────────────────────────────────────────────────
  const handleExtract = () => {
    if (!videoId) return;
    const s = hmsToSecs(startTime), e = hmsToSecs(endTime);
    if (e <= s) { setErrorMsg('End time must be after start time.'); return; }
    if (duration > 0 && e > duration) {
      setErrorMsg(`End time exceeds video duration (${secsToHMS(duration)}).`);
      return;
    }

    setErrorMsg('');
    setExtracting(true);
    setCurrentStep(1);
    setLogs([
      { text: '[CropTube Initialize] Launching clip slicing agent...', type: 'system' },
      { text: `[Parameters] Target video URL: ${youtubeUrl}`, type: 'info' },
      { text: `[Parameters] Segment range: ${startTime} ➔ ${endTime} (${secsToHMS(e - s)})`, type: 'info' },
    ]);

    // Step 1: Initiate job
    fetch('/api/extract/initiate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: youtubeUrl, start: startTime, end: endTime, quality, cookies })
    })
      .then(r => { if (!r.ok) return r.json().then(d => { throw new Error(d.error); }); return r.json(); })
      .then(({ fileId }) => {
        setCurrentStep(2);
        const es = new EventSource(`/api/extract/stream?fileId=${fileId}`);

        es.onmessage = (evt) => {
          try {
            const payload = JSON.parse(evt.data);

            if (payload.type === 'log') {
              const msg = payload.message;
              // Detect expired cookies
              if (msg.includes('no longer valid') || msg.includes('cookies have')) {
                setCookiesExpired(true);
                setShowCookies(true);
                setHasGlobalCookies(false);
              }
              // Filter ffmpeg metadata noise
              if (isNoisyLine(msg)) return;
              setLogs(p => [...p, { text: msg, type: 'info' }]);

            } else if (payload.type === 'error') {
              setLogs(p => [...p, { text: `❌ ${payload.message}`, type: 'error' }]);
              setExtracting(false); setCurrentStep(0); es.close();

            } else if (payload.type === 'complete') {
              const { fileId: fid, filename } = payload.message;
              setCurrentStep(3);
              setLogs(p => [
                ...p,
                { text: '✅ Clip ready! Triggering download...', type: 'success' },
              ]);
              setClipsHistory(p => [{
                id: fid, title: `Clip (${startTime} – ${endTime})`,
                url: youtubeUrl, videoId, start: startTime, end: endTime,
                duration: secsToHMS(e - s), timestamp: new Date().toLocaleTimeString()
              }, ...p]);
              window.location.href = `/api/download/${fid}`;
              setTimeout(() => { setExtracting(false); setCurrentStep(0); }, 3000);
              es.close();
            }
          } catch (_) {}
        };

        es.onerror = () => {
          setLogs(p => [...p, {
            text: '⚠️ SSE tunnel dropped — extraction may still be running on the server.',
            type: 'error'
          }]);
          setExtracting(false); setCurrentStep(0); es.close();
        };
      })
      .catch(err => {
        setLogs(p => [...p, { text: `❌ ${err.message}`, type: 'error' }]);
        setExtracting(false); setCurrentStep(0);
      });
  };

  // ── Derived values ───────────────────────────────────────────────────────
  const clipLen = Math.max(0, hmsToSecs(endTime) - hmsToSecs(startTime));
  const pct = duration > 0
    ? ((hmsToSecs(endTime) - hmsToSecs(startTime)) / duration) * 100
    : 0;

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen w-full bg-slate-950 radial-glow flex flex-col items-center pb-16">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="w-full max-w-7xl px-4 sm:px-6 pt-6 pb-4 flex justify-between items-center border-b border-slate-900">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center neon-glow-indigo flex-shrink-0">
            <Scissors className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-extrabold text-2xl tracking-tight text-white">
              Crop<span className="text-indigo-400">Tube</span>
            </h1>
            <p className="text-[10px] text-slate-500">Surgical YouTube Clip Extractor</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-lg text-slate-400">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="hidden sm:block">Cloud API Active</span>
        </div>
      </header>

      {/* ── Cookie-expired banner ────────────────────────────────────────── */}
      {cookiesExpired && (
        <div className="w-full max-w-7xl px-4 sm:px-6 mt-4">
          <div className="flex items-start gap-3 bg-amber-950/40 border border-amber-500/40 rounded-xl p-4">
            <span className="text-amber-400 text-lg flex-shrink-0">⚠️</span>
            <div className="flex-1 min-w-0">
              <p className="text-amber-300 text-sm font-bold">YouTube cookies have expired (rotated by Google)</p>
              <ol className="text-amber-400/80 text-xs mt-1.5 space-y-0.5 list-decimal list-inside">
                <li>Open <strong>youtube.com</strong> in Chrome (logged in)</li>
                <li>Click <strong>Get cookies.txt LOCALLY</strong> extension → Export</li>
                <li>Paste text below in <strong>Cloud Auth Settings</strong> → Register</li>
              </ol>
            </div>
            <button onClick={() => setCookiesExpired(false)} className="text-amber-600 hover:text-amber-300 text-xs flex-shrink-0">✕</button>
          </div>
        </div>
      )}

      {/* ── Main Grid ───────────────────────────────────────────────────── */}
      <main className="w-full max-w-7xl px-4 sm:px-6 mt-6 grid grid-cols-1 lg:grid-cols-12 gap-6">

        {/* ── Left column: URL + Player + Time Markers ─── */}
        <section className="lg:col-span-7 space-y-5">

          {/* URL Input */}
          <div className="bg-slate-900/60 backdrop-blur-md border border-slate-800/80 rounded-2xl p-5 space-y-3">
            <h2 className="text-xs font-semibold tracking-widest text-slate-400 uppercase flex items-center gap-2">
              <Video className="w-4 h-4 text-indigo-400" />
              1. Load YouTube Video
            </h2>
            <div className="relative">
              <input
                type="text"
                value={youtubeUrl}
                onChange={e => setYoutubeUrl(e.target.value)}
                placeholder="Paste YouTube link — youtube.com/watch?v=... or youtu.be/..."
                disabled={extracting}
                className="w-full pl-4 pr-14 py-3 bg-slate-950 border border-slate-800 focus:border-indigo-500
                  rounded-xl outline-none text-sm text-slate-200 placeholder-slate-600
                  transition-all focus:ring-1 focus:ring-indigo-500/20 disabled:opacity-50"
              />
              {youtubeUrl && !extracting && (
                <button
                  onClick={() => setYoutubeUrl('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-rose-400 text-xs transition-colors flex items-center gap-1"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Clear
                </button>
              )}
            </div>
            {errorMsg && (
              <div className="flex items-start gap-2 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs p-3 rounded-lg">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                {errorMsg}
              </div>
            )}
          </div>

          {/* YouTube Player */}
          <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-3 shadow-xl overflow-hidden relative" style={{ aspectRatio: '16/9' }}>
            {videoId ? (
              <div id="yt-player-wrap" className="w-full h-full rounded-xl overflow-hidden bg-black" />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-slate-600">
                <div className="w-16 h-16 rounded-full bg-slate-950 border border-slate-800 flex items-center justify-center">
                  <Play className="w-6 h-6 animate-pulse" />
                </div>
                <p className="text-sm font-medium text-slate-500">Preview Player</p>
                <p className="text-xs text-slate-700 max-w-xs text-center">Paste a YouTube link above to embed the player and grab timestamps live</p>
              </div>
            )}
          </div>

          {/* Time Markers */}
          <div className="bg-slate-900/60 backdrop-blur-md border border-slate-800/80 rounded-2xl p-5 space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-xs font-semibold tracking-widest text-slate-400 uppercase flex items-center gap-2">
                <Clock className="w-4 h-4 text-indigo-400" />
                2. Set Clip Markers
              </h2>
              {duration > 0 && (
                <span className="text-[10px] text-slate-500 bg-slate-950 border border-slate-900 px-2 py-0.5 rounded font-mono">
                  Total: {secsToHMS(duration)}
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <TimeMarker
                label="Start"
                accent="text-emerald-400"
                value={startTime}
                onChange={setStartTime}
                onGrab={() => grabTime(setStartTime)}
                onSeek={() => seekPlayer(startTime)}
                disabled={extracting}
                playerReady={playerReady}
              />
              <TimeMarker
                label="End"
                accent="text-rose-400"
                value={endTime}
                onChange={setEndTime}
                onGrab={() => grabTime(setEndTime)}
                onSeek={() => seekPlayer(endTime)}
                disabled={extracting}
                playerReady={playerReady}
              />
            </div>

            {/* Visual range bar */}
            {duration > 0 && (
              <div className="space-y-1.5">
                <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden relative">
                  <div
                    className="absolute h-full bg-gradient-to-r from-indigo-500 to-violet-500 rounded-full transition-all"
                    style={{
                      left: `${(hmsToSecs(startTime) / duration) * 100}%`,
                      width: `${Math.max(0.5, (clipLen / duration) * 100)}%`
                    }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-slate-600 font-mono">
                  <span>{startTime}</span>
                  <span className="text-indigo-400 font-bold">{secsToHMS(clipLen)} selected</span>
                  <span>{endTime}</span>
                </div>
              </div>
            )}

            <p className="text-[10px] text-slate-600 flex items-start gap-1.5">
              <Info className="w-3 h-3 flex-shrink-0 mt-0.5 text-slate-500" />
              Play the video, pause at the moment you want, then click <strong className="text-slate-500">Grab Time</strong>. Use <strong className="text-slate-500">Seek to ▶</strong> to jump the player back to a saved marker.
            </p>
          </div>
        </section>

        {/* ── Right column: Settings + Terminal + History ─── */}
        <section className="lg:col-span-5 space-y-5">

          {/* Extraction controls */}
          <div className="bg-slate-900/60 backdrop-blur-md border border-slate-800/80 rounded-2xl p-5 space-y-5 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/5 rounded-full blur-3xl pointer-events-none" />

            <h2 className="text-xs font-semibold tracking-widest text-slate-400 uppercase flex items-center gap-2">
              <Scissors className="w-4 h-4 text-indigo-400 animate-pulse" />
              3. Extract Clip
            </h2>

            {/* Quality */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold tracking-widest text-slate-500 uppercase">Quality</label>
              <select
                value={quality}
                onChange={e => setQuality(e.target.value)}
                disabled={extracting}
                className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 text-slate-300
                  py-2.5 px-3 rounded-xl outline-none text-xs transition-colors disabled:opacity-50"
              >
                <option value="4K">4K (2160p)</option>
                <option value="2K">2K (1440p)</option>
                <option value="1080p">1080p (Full HD)</option>
                <option value="720p">720p (HD)</option>
                <option value="480p">480p (Standard)</option>
                <option value="360p">360p (Low)</option>
              </select>
            </div>

            {/* Cloud Auth */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <button
                  onClick={() => setShowCookies(v => !v)}
                  className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold flex items-center gap-1 transition-colors"
                >
                  {showCookies ? '▼' : '▶'} Cloud Auth Settings
                </button>
                {hasGlobalCookies && (
                  <span className="text-[9px] text-emerald-400 bg-emerald-950/40 border border-emerald-900 px-2 py-0.5 rounded-full flex items-center gap-1 animate-pulse">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Active
                  </span>
                )}
              </div>
              {showCookies && (
                <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
                  <p className="text-[10px] text-slate-500">Paste Netscape-format YouTube cookies (from <strong>Get cookies.txt LOCALLY</strong> Chrome extension)</p>
                  <textarea
                    value={cookies}
                    onChange={e => setCookies(e.target.value)}
                    placeholder={'# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t...\tSID\t...'}
                    rows={4}
                    disabled={extracting}
                    className="w-full p-2 bg-slate-900 border border-slate-800 focus:border-indigo-500
                      text-[10px] text-slate-400 font-mono rounded-lg outline-none resize-none
                      placeholder-slate-700 disabled:opacity-50"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={saveCookies}
                      disabled={!cookies.trim() || extracting}
                      className="flex-1 py-1.5 rounded-lg text-[10px] font-semibold transition-colors
                        disabled:bg-slate-900 disabled:text-slate-600 disabled:cursor-not-allowed
                        enabled:bg-indigo-600 enabled:hover:bg-indigo-500 enabled:text-white"
                    >
                      Register to Cloud Server
                    </button>
                    {hasGlobalCookies && (
                      <button
                        onClick={deleteCookies}
                        disabled={extracting}
                        className="px-3 py-1.5 bg-rose-950/20 hover:bg-rose-950/40 border border-rose-900/40
                          text-rose-400 rounded-lg text-[10px] font-semibold transition-all"
                      >
                        Purge
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Range summary */}
            <div className="bg-slate-950/80 border border-slate-900 rounded-xl p-4 space-y-2.5">
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">Range</span>
                <span className="font-mono text-slate-300">{startTime} ➔ {endTime}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">Clip length</span>
                <span className={`font-mono font-bold ${clipLen > 0 ? 'text-indigo-400' : 'text-rose-500'}`}>
                  {secsToHMS(clipLen)}
                </span>
              </div>
              {clipLen > 300 && (
                <p className="text-[10px] text-amber-400/80 flex items-start gap-1">
                  <AlertCircle className="w-3 h-3 flex-shrink-0 mt-0.5" />
                  Clips longer than 5 min may take a while on the free server tier.
                </p>
              )}
            </div>

            {/* Extract button */}
            <button
              onClick={handleExtract}
              disabled={extracting || !videoId || clipLen <= 0}
              className={`w-full py-4 rounded-xl font-bold flex items-center justify-center gap-2.5 text-sm transition-all
                ${extracting
                  ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
                  : !videoId || clipLen <= 0
                  ? 'bg-slate-900/40 text-slate-600 border border-slate-900 cursor-not-allowed'
                  : 'bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white shadow-lg neon-glow-indigo active:scale-[0.98]'
                }`}
            >
              {extracting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin text-indigo-400" />
                  {currentStep === 1 ? 'Initialising...' : 'Slicing Stream...'}
                </>
              ) : (
                <>
                  <Download className="w-5 h-5" />
                  Extract &amp; Download Clip
                </>
              )}
            </button>
          </div>

          {/* Terminal */}
          <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl overflow-hidden flex flex-col" style={{ height: 300 }}>
            <div className="bg-slate-950 px-4 py-3 border-b border-slate-900 flex justify-between items-center flex-shrink-0">
              <div className="flex items-center gap-2">
                <TerminalIcon className="w-4 h-4 text-indigo-400" />
                <span className="text-xs font-mono font-bold text-slate-300">yt-dlp@croptube:~$</span>
              </div>
              {extracting && (
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-ping" />
                  <span className="text-[10px] font-mono text-indigo-400">Live</span>
                </div>
              )}
            </div>
            <div className="flex-1 p-4 bg-slate-950 font-mono text-xs overflow-y-auto space-y-1.5 selection:bg-indigo-600">
              {logs.length === 0 ? (
                <p className="text-slate-700 italic">Waiting for extraction... logs appear here in real-time.</p>
              ) : (
                logs.map((log, i) => {
                  let cls = 'text-slate-400';
                  if (log.type === 'error')   cls = 'text-rose-400 bg-rose-950/20 border-l-2 border-rose-500 pl-2';
                  if (log.type === 'success') cls = 'text-emerald-400 font-bold bg-emerald-950/20 border-l-2 border-emerald-500 pl-2';
                  if (log.type === 'system')  cls = 'text-cyan-400 border-l-2 border-cyan-500 pl-2';
                  if (log.type === 'info') {
                    if (log.text.includes('WARNING') || log.text.includes('[Warning')) cls = 'text-amber-500/80';
                    else if (log.text.includes('ERROR')) cls = 'text-rose-400';
                    else if (log.text.includes('%'))     cls = 'text-indigo-300';
                    else if (log.text.includes('[download]')) cls = 'text-indigo-400';
                    else if (log.text.includes('[ffmpeg]'))  cls = 'text-violet-400';
                    else if (log.text.startsWith('frame='))  cls = 'text-sky-400';
                  }
                  return (
                    <div key={i} className={`leading-relaxed break-all ${cls}`}>{log.text}</div>
                  );
                })
              )}
              <div ref={terminalEndRef} />
            </div>
          </div>

          {/* Session history */}
          {clipsHistory.length > 0 && (
            <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4 space-y-3">
              <h3 className="text-xs font-semibold tracking-widest text-slate-400 uppercase flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                Session History
              </h3>
              <div className="space-y-2 max-h-36 overflow-y-auto">
                {clipsHistory.map(clip => (
                  <div key={clip.id} className="flex justify-between items-center bg-slate-950 border border-slate-900 px-3 py-2.5 rounded-xl hover:border-slate-800 transition-colors">
                    <div>
                      <p className="text-xs font-medium text-slate-300">{clip.title}</p>
                      <p className="text-[10px] text-slate-600 font-mono">
                        {clip.duration} · {clip.timestamp}
                      </p>
                    </div>
                    <a href={`/api/download/${clip.id}`} className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 font-semibold">
                      <Download className="w-3.5 h-3.5" /> Re-download
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </main>

      <footer className="mt-12 text-center text-[10px] text-slate-700 max-w-xs px-4">
        CropTube — Private clip extractor. Files are deleted from server immediately after download.
      </footer>
    </div>
  );
}
