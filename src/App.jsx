import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Scissors, Play, Download, AlertCircle, CheckCircle2,
  Loader2, Crosshair, Trash2, Search
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
  const [grabbed, setGrabbed] = useState(false);
  const [seeked, setSeeked] = useState(false);
  const [raw, setRaw] = useState(value);
  const [valid, setValid] = useState(true);

  // Keep raw in sync when parent changes value (e.g. on grab)
  useEffect(() => { setRaw(value); setValid(true); }, [value]);

  const handleChange = (e) => {
    const v = e.target.value;
    setRaw(v);
    const norm = normaliseHMS(v);
    if (norm) { setValid(true); onChange(norm); }
    else setValid(false);
  };

  const handleBlur = () => {
    const norm = normaliseHMS(raw);
    if (norm) { setRaw(norm); setValid(true); onChange(norm); }
    else { setRaw(value); setValid(true); }           // revert on bad input
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
    <div className="bg-slate-900/40 border border-slate-800/80 rounded-xl p-3 space-y-2">
      <div className="flex justify-between items-center">
        <span className={`text-[10px] font-semibold uppercase tracking-wider ${accent}`}>{label}</span>
        {grabbed && (
          <span className="text-[9px] text-emerald-400 font-mono animate-pulse">✓ Grabbed!</span>
        )}
        {!grabbed && !valid && (
          <span className="text-[9px] text-rose-400 font-mono">Invalid</span>
        )}
      </div>

      <input
        type="text"
        value={raw}
        onChange={handleChange}
        onBlur={handleBlur}
        placeholder="HH:MM:SS"
        maxLength={8}
        disabled={!playerReady || disabled}
        className={`w-full text-center text-lg font-mono font-bold tracking-widest bg-transparent border-b pb-0.5
          outline-none transition-all duration-200 text-slate-100
          disabled:opacity-40 disabled:cursor-not-allowed
          ${borderClass}`}
      />

      <div className="grid grid-cols-2 gap-1.5">
        <button
          onClick={handleGrab}
          disabled={!playerReady || disabled}
          className="flex items-center justify-center gap-1 py-1 rounded-lg text-[10px] font-semibold
            bg-slate-950 hover:bg-slate-800 border border-slate-800
            text-slate-300 hover:text-white transition-all
            disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Crosshair className="w-2.5 h-2.5" />
          Grab
        </button>

        <button
          onClick={handleSeek}
          disabled={!playerReady || disabled}
          className={`flex items-center justify-center gap-1 py-1 rounded-lg text-[10px] font-semibold
            bg-indigo-950/45 hover:bg-indigo-900/60 border border-indigo-900/50
            text-indigo-300 hover:text-indigo-100 transition-all
            disabled:opacity-40 disabled:cursor-not-allowed
            ${seeked ? 'seek-pulse' : ''}`}
        >
          Seek ▶
        </button>
      </div>
    </div>
  );
}

// ─── Main App ────────────────────────────────────────────────────────────────

export default function App() {
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [videoId, setVideoId] = useState('');
  const [startTime, setStartTime] = useState('00:00:00');
  const [endTime, setEndTime] = useState('00:00:00');
  const [duration, setDuration] = useState(0);
  const [playerReady, setPlayerReady] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [extractionFailed, setExtractionFailed] = useState(false);
  const [extractionComplete, setExtractionComplete] = useState(false);
  const [lastError, setLastError] = useState('');
  const [showReportPanel, setShowReportPanel] = useState(false);
  const [reportSent, setReportSent] = useState(null);
  const [clipsHistory, setClipsHistory] = useState([]);
  const [currentStep, setCurrentStep] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [selectedFormat, setSelectedFormat] = useState('mp4');
  const [selectedQuality, setSelectedQuality] = useState('1080p');
  const [selectedFormatId, setSelectedFormatId] = useState('none');
  const [availableVideoFormats, setAvailableVideoFormats] = useState(['mp4', 'mkv']);
  const [availableAudioFormats, setAvailableAudioFormats] = useState(['mp3', 'm4a']);
  const [availableResolutions, setAvailableResolutions] = useState(['2160p', '1440p', '1080p', '720p', '480p', '360p']);
  const [rawFormats, setRawFormats] = useState([]);
  const [isLoadingFormats, setIsLoadingFormats] = useState(false);
  const [cookies, setCookies] = useState(() => localStorage.getItem('croptube_cookies') || '');
  const [showCookies, setShowCookies] = useState(false);
  const [hasGlobalCookies, setHasGlobalCookies] = useState(false);
  const [cookiesExpired, setCookiesExpired] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [progress, setProgress] = useState(0);
  const [showDashboard, setShowDashboard] = useState(false);
  const [activeModal, setActiveModal] = useState(null);

  const playerRef = useRef(null);
  const ytApiReady = useRef(false);

  const handleSearch = () => {
    if (!youtubeUrl.trim()) return;
    setIsSearching(true);
    setErrorMsg('');
    fetch(`/api/search?q=${encodeURIComponent(youtubeUrl)}`)
      .then(r => {
        if (!r.ok) throw new Error('Search failed');
        return r.json();
      })
      .then(data => {
        setSearchResults(data.entries || []);
        if ((data.entries || []).length === 0) {
          setErrorMsg('No results found.');
        }
      })
      .catch(err => {
        setErrorMsg('Failed to fetch search results.');
      })
      .finally(() => {
        setIsSearching(false);
      });
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      const isUrl = /(?:youtu\.be\/|[?&]v=)([A-Za-z0-9_-]{11})/.test(youtubeUrl) || youtubeUrl.startsWith('http');
      if (!isUrl) {
        handleSearch();
      }
    }
  };

  // Persist cookies
  useEffect(() => { localStorage.setItem('croptube_cookies', cookies); }, [cookies]);

  // Check server cookies on mount
  useEffect(() => {
    fetch('/api/settings/cookies/check')
      .then(r => r.json())
      .then(d => setHasGlobalCookies(d.hasGlobalCookies))
      .catch(() => { });
  }, []);


  // ── Parse YouTube video ID from URL ──────────────────────────────────────
  useEffect(() => {
    if (!youtubeUrl) {
      setVideoId(''); setDuration(0); setPlayerReady(false);
      setStartTime('00:00:00'); setEndTime('00:00:00'); setErrorMsg('');
      return;
    }
    const m = youtubeUrl.match(/(?:youtu\.be\/|[?&]v=)([A-Za-z0-9_-]{11})/);
    if (m) {
      setVideoId(m[1]);
      setErrorMsg('');
    } else {
      setVideoId('');
      const isAttemptingUrl = youtubeUrl.startsWith('http') || youtubeUrl.includes('.') || youtubeUrl.includes('/') || youtubeUrl.includes('youtube') || youtubeUrl.includes('youtu');
      if (isAttemptingUrl) {
        setErrorMsg('Invalid YouTube URL. Paste a standard watch or share link.');
      } else {
        setErrorMsg('');
      }
    }
  }, [youtubeUrl]);

  // ── Debounced Search Effect ───────────────────────────────────────────────
  useEffect(() => {
    if (!youtubeUrl.trim()) {
      setSearchResults([]);
      return;
    }

    const isUrl = /(?:youtu\.be\/|[?&]v=)([A-Za-z0-9_-]{11})/.test(youtubeUrl) || youtubeUrl.startsWith('http');
    if (isUrl) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(() => {
      setIsSearching(true);
      setErrorMsg('');
      fetch(`/api/search?q=${encodeURIComponent(youtubeUrl)}`)
        .then(r => {
          if (!r.ok) throw new Error('Search failed');
          return r.json();
        })
        .then(data => {
          setSearchResults(data.entries || []);
          if ((data.entries || []).length === 0) {
            setErrorMsg('No results found.');
          }
        })
        .catch(err => {
          setErrorMsg('Failed to fetch search results.');
        })
        .finally(() => {
          setIsSearching(false);
        });
    }, 500);

    return () => clearTimeout(timer);
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
        try { playerRef.current.destroy(); } catch (_) { }
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

  // ── Fetch formats and qualities dynamically on videoId change ───────────
  useEffect(() => {
    if (!videoId) {
      setAvailableVideoFormats(['mp4', 'mkv']);
      setAvailableAudioFormats(['mp3', 'm4a']);
      setAvailableResolutions(['2160p', '1440p', '1080p', '720p', '480p', '360p']);
      setSelectedFormat('mp4');
      setSelectedQuality('1080p');
      setRawFormats([]);
      return;
    }

    setIsLoadingFormats(true);
    setErrorMsg('');
    fetch(`/api/formats?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`)
      .then(async r => {
        const isJson = r.headers.get('content-type')?.includes('application/json');
        const data = isJson ? await r.json() : null;
        if (!r.ok) {
          throw new Error(data?.error || `Failed to fetch format metadata (${r.status})`);
        }
        return data;
      })
      .then(data => {
        if (data.rawFormats) {
          setRawFormats(data.rawFormats);
        } else {
          setRawFormats([]);
        }

        if (data.videoFormats && data.videoFormats.length > 0) {
          setAvailableVideoFormats(data.videoFormats);
        }
        if (data.audioFormats && data.audioFormats.length > 0) {
          setAvailableAudioFormats(data.audioFormats);
        }
        if (data.heights && data.heights.length > 0) {
          setAvailableResolutions(data.heights);
        }

        const defaultVideo = data.videoFormats && data.videoFormats.includes('mp4') ? 'mp4' : (data.videoFormats?.[0] || 'mp4');
        setSelectedFormat(defaultVideo);

        const defaultQual = data.heights && data.heights.includes('1080p') ? '1080p' : (data.heights?.[0] || '1080p');
        setSelectedQuality(defaultQual);
      })
      .catch((err) => {
        setErrorMsg(err.message || 'Failed to fetch format metadata.');
        setAvailableVideoFormats([]);
        setAvailableAudioFormats([]);
        setAvailableResolutions([]);
        setRawFormats([]);
      })
      .finally(() => {
        setIsLoadingFormats(false);
      });
  }, [videoId, hasGlobalCookies]);

  // ── Resolve exact yt-dlp format_id reactively ──────────────────────────────
  useEffect(() => {
    console.log(`[Format Resolution] selectedQuality: ${selectedQuality}, selectedFormat: ${selectedFormat}, rawFormats count: ${rawFormats.length}`);
    if (!rawFormats || rawFormats.length === 0) {
      setSelectedFormatId('none');
      console.log(`[Format Resolution] Resolved selectedFormatId: none (empty rawFormats)`);
      return;
    }

    const isAudio = selectedFormat === 'mp3' || selectedFormat === 'm4a' || selectedFormat === 'opus' || selectedFormat === 'webm-audio';

    if (isAudio) {
      const audioExt = selectedFormat === 'webm-audio' ? 'webm' : (selectedFormat === 'mp3' ? 'mp3' : selectedFormat);
      const match = rawFormats.find(f => f.acodec !== 'none' && f.vcodec === 'none' && f.ext === audioExt) ||
                    rawFormats.find(f => f.acodec !== 'none' && f.vcodec === 'none');
      const resolvedId = match ? match.format_id : 'bestaudio';
      setSelectedFormatId(resolvedId);
      console.log(`[Format Resolution] Resolved selectedFormatId (audio): ${resolvedId}`);
    } else {
      const targetHeight = parseInt(selectedQuality) || 1080;
      const matchingHeight = rawFormats.filter(f => (f.label === selectedQuality || f.height === targetHeight) && f.vcodec !== 'none');
      
      const containerMatch = matchingHeight.find(f => f.ext === selectedFormat) || 
                            matchingHeight[0] ||
                            rawFormats.find(f => f.label === selectedQuality || f.height === targetHeight) ||
                            rawFormats.find(f => f.vcodec !== 'none');
                            
      const resolvedId = containerMatch ? containerMatch.format_id : 'none';
      setSelectedFormatId(resolvedId);
      console.log(`[Format Resolution] Resolved selectedFormatId (video): ${resolvedId}, targetHeight: ${targetHeight}, matchingHeight count: ${matchingHeight.length}`);
    }
  }, [selectedFormat, selectedQuality, rawFormats]);

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
      .then(async r => {
        if (!r.ok) {
          const errData = await r.json().catch(() => ({}));
          throw new Error(errData.error || 'Failed to save cookies.');
        }
        return r.json();
      })
      .then(() => {
        setHasGlobalCookies(true);
        setCookiesExpired(false);
        alert('✅ Cookies registered on cloud server! Works from all devices now.');
      })
      .catch((err) => alert(err.message));
  };

  const deleteCookies = () => {
    if (!confirm('Delete cloud cookies?')) return;
    fetch('/api/settings/cookies', { method: 'DELETE' })
      .then(r => r.json())
      .then(() => { setHasGlobalCookies(false); setCookies(''); })
      .catch(() => { });
  };

  // ── Report Issue ────────────────────────────────────────────────────────────────────────────────
  const handleReport = () => {
    const reportData = {
      timestamp: new Date().toISOString(),
      youtubeUrl: youtubeUrl,
      quality: selectedQuality,
      format: selectedFormat,
      browser: navigator.userAgent.substring(0, 150),
      platform: navigator.platform,
      stage: currentStep === 1 ? 'Preparing' : currentStep === 2 ? 'Extracting' : 'Unknown',
      errorMessage: lastError
    };

    fetch('/api/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reportData)
    })
      .then(r => r.json())
      .then(data => setReportSent(data.success ? 'success' : 'error'))
      .catch(() => setReportSent('error'));
  };

  // ── Extract clip ────────────────────────────────────────────────────────────────────────────────
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
    setProgress(0);
    setStatusMessage('Preparing clip...');
    setExtractionFailed(false);
    setExtractionComplete(false);
    setShowReportPanel(false);
    setReportSent(null);
    setLastError('');

    // Step 1: Initiate job
    const payload = {
      url: youtubeUrl,
      start: startTime,
      end: endTime,
      format: selectedFormat,
      quality: selectedQuality,
      format_id: selectedFormatId,
      cookies: cookies
    };

    console.log(`[Initiate Payload Log] Sending payload:`, JSON.stringify(payload, null, 2));


    fetch('/api/extract/initiate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(async r => {
        const text = await r.text();
        let d;
        try { d = JSON.parse(text); } catch (_) { throw new Error(`Server returned invalid response (${r.status}): ${text.slice(0, 200)}`); }
        if (!r.ok) throw new Error(d.error || `Server error ${r.status}`);
        return d;
      })
      .then(({ fileId }) => {
        setCurrentStep(2);
        const es = new EventSource(`/api/extract/stream?fileId=${fileId}`);
        let isCompleted = false;

        es.onopen = () => {
          console.log('[Frontend SSE] connected');
        };

        es.onmessage = (evt) => {
          try {
            const data = JSON.parse(evt.data);

            if (data.type === 'status') {
              setStatusMessage(data.message);
            } else if (data.type === 'progress') {
              console.log('[Frontend SSE] progress update');
              const { stage, pct } = data.message;
              setStatusMessage(stage);
              setProgress(pct);
            } else if (data.type === 'cookie_error') {
              setCookiesExpired(true);
              setShowCookies(true);
              setHasGlobalCookies(false);
              setExtractionFailed(true);
              setLastError(data.message);
              setStatusMessage('');
              setExtracting(false);
              setCurrentStep(0);
              es.close();
              console.log('[Frontend SSE] eventsource closed');
            } else if (data.type === 'error') {
              setExtractionFailed(true);
              setLastError(data.message);
              setStatusMessage('');
              setExtracting(false);
              setCurrentStep(0);
              es.close();
              console.log('[Frontend SSE] eventsource closed');
            }
          } catch (_) { }
        };

        es.addEventListener('completed', (evt) => {
          console.log('[Frontend SSE] completed event received');
          isCompleted = true;
          setExtractionComplete(true);
          setExtractionFailed(false);
          setLastError('');
          setProgress(100);
          setStatusMessage('Download ready.');

          setClipsHistory(p => [{
            id: fileId, title: `Clip (${startTime} – ${endTime})`,
            url: youtubeUrl, videoId, start: startTime, end: endTime,
            duration: secsToHMS(e - s), timestamp: new Date().toLocaleTimeString()
          }, ...p]);

          const dlExt = selectedFormat === 'webm-audio' ? 'webm' : (selectedFormat === 'mp3' ? 'mp3' : selectedFormat);
          const link = document.createElement('a');
          link.href = `/api/download/${fileId}`;
          link.download = `CropTube_Clip_${fileId}.${dlExt}`;
          document.body.appendChild(link);

          // Short delay to let browser process click before cleanup
          setTimeout(() => {
            console.log('[Frontend SSE] download triggered');
            link.click();
            document.body.removeChild(link);
          }, 100);

          // Delay SSE close and state reset so the download request reaches the server first
          setTimeout(() => {
            setExtracting(false);
            setCurrentStep(0);
            es.close();
            console.log('[Frontend SSE] eventsource closed');
          }, 1000);
        });

        es.onerror = () => {
          console.log('[Frontend SSE] onerror triggered');
          if (isCompleted) {
            es.close();
            console.log('[Frontend SSE] eventsource closed');
            return;
          }
          setExtractionFailed(true);
          setLastError('Connection lost. The clip may still be processing on the server.');
          setStatusMessage('');
          setExtracting(false);
          setCurrentStep(0);
          es.close();
          console.log('[Frontend SSE] eventsource closed');
        };
      })
      .catch(err => {
        setExtractionFailed(true);
        setLastError(err.message || 'Unable to initiate clip extraction. Please try again.');
        setStatusMessage('');
        setExtracting(false);
        setCurrentStep(0);
      });
  };

  // ── Derived values ───────────────────────────────────────────────────────
  const clipLen = Math.max(0, hmsToSecs(endTime) - hmsToSecs(startTime));
  const pct = duration > 0
    ? ((hmsToSecs(endTime) - hmsToSecs(startTime)) / duration) * 100
    : 0;

  // ── Render Modal Overlay ──────────────────────────────────────────────────
  const renderModal = () => {
    if (!activeModal) return null;

    const modalData = {
      about: {
        title: 'About CropTube',
        content: 'CropTube is a premium open-source tool built to extract high-quality clips and formats from YouTube links without downloading entire video streams. It uses advanced backend technology with yt-dlp and FFmpeg to slice segments on-demand, saving bandwidth and local storage.'
      },
      works: {
        title: 'How It Works',
        content: '1. Paste a valid YouTube URL.\n2. Load the preview stream.\n3. Adjust the Start and End markers using playhead time grabs.\n4. Choose your format (MP4, MKV, MP3, M4A) and dynamic resolution.\n5. Click Extract & Download to receive your high-quality file instantly.'
      },
      services: {
        title: 'Services & API',
        content: 'CropTube provides cloud extraction nodes, high-bandwidth processing servers, Netscape cookie support for premium links, and developer APIs to integrate video slicing directly into media pipelines.'
      },
      docs: {
        title: 'Developer Guide',
        content: 'Access CLI features, API specs, deployment scripts, and yt-dlp configurations. Learn how to configure local proxies and Netscape cookie authentication to optimize extraction speeds across different network topologies.'
      },
      privacy: {
        title: 'Privacy Policy',
        content: 'CropTube respects user privacy. We do not store downloaded videos or track user inputs. Sliced video files are stored in temporary memory on the server and are purged immediately after the download completes.'
      },
      terms: {
        title: 'Terms of Service',
        content: 'This tool is intended for personal and educational use. Users are responsible for complying with the terms of service of the video platform they are downloading content from. We do not host or distribute copy-protected material.'
      }
    };

    const data = modalData[activeModal];
    if (!data) return null;

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md">
        <div className="w-full max-w-md glass-panel p-6 rounded-[24px] space-y-4 relative animate-fade-in-up border border-white/10 shadow-2xl">
          <div className="flex justify-between items-center border-b border-white/5 pb-2.5">
            <h3 className="font-bold text-sm text-white tracking-tight">{data.title}</h3>
            <button
              onClick={() => setActiveModal(null)}
              className="text-white/40 hover:text-white transition-colors text-xs font-bold w-6 h-6 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center"
            >
              ✕
            </button>
          </div>
          <div className="text-xs text-white/70 leading-relaxed whitespace-pre-line">
            {data.content}
          </div>
          <div className="pt-2 flex justify-end">
            <button
              onClick={() => setActiveModal(null)}
              className="px-4 py-1.5 bg-white text-slate-950 hover:bg-slate-100 font-semibold text-[10px] rounded-full transition-all"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ── Render ───────────────────────────────────────────────────────────────
  if (!showDashboard) {
    return (
      <div className="min-h-screen w-full dynamic-mesh-bg flex items-center justify-center p-4 sm:p-6 md:p-8 lg:p-10 font-sans antialiased text-slate-200">
        {renderModal()}
        <div className="w-full max-w-2xl lg:max-w-[1400px] aspect-[16/10] glass-panel rounded-[32px] p-6 sm:p-10 flex flex-col justify-between overflow-hidden relative">
          {/* Subtle top decoration */}
          <div className="absolute top-0 left-0 w-full h-32 bg-gradient-to-b from-black/40 to-transparent pointer-events-none" />

          {/* Header Navigation */}
          <div className="flex justify-between items-center text-xs text-white/50 z-10 animate-fade-in-up">
            <span className="font-bold tracking-widest text-[10px] text-white">CROPTUBE</span>
            <div className="flex gap-6">
              <span onClick={() => setActiveModal('about')} className="hover:text-white cursor-pointer transition-colors">About</span>
              <span onClick={() => setActiveModal('works')} className="hover:text-white cursor-pointer transition-colors">Works</span>
              <span onClick={() => setActiveModal('services')} className="hover:text-white cursor-pointer transition-colors">Services</span>
            </div>
            <button 
              onClick={() => setActiveModal('docs')}
              className="px-3.5 py-1.5 border border-white/10 hover:border-white/30 hover:bg-white/5 rounded-full transition-all text-[10px] font-medium text-white flex items-center gap-1"
            >
              Docs &amp; Guide ↗
            </button>
          </div>

          {/* Central Pitch */}
          <div className="space-y-6 text-center my-auto z-10">
            <h2 className="text-4xl sm:text-5.5xl text-white font-semibold font-sans tracking-tight leading-[1.15] animate-fade-in-up animation-delay-100">
              The tool that makes your <br />
              <span className="italic font-serif-accent text-indigo-300 text-5xl sm:text-6xl">videos &amp; clips</span> surgical
            </h2>

            <p className="text-xs sm:text-sm text-white/50 text-center max-w-md mx-auto leading-relaxed animate-fade-in-up animation-delay-200">
              Extract high-quality segments from YouTube instantly. No full file downloads, no bandwidth waste, just code-clean slicing.
            </p>

            <div className="animate-fade-in-up animation-delay-300 flex justify-center">
              <button
                onClick={() => setShowDashboard(true)}
                className="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 text-white text-xs px-6 py-3.5 rounded-full transition-all shadow-md active:scale-[0.98]"
              >
                <Play className="w-3.5 h-3.5 fill-white text-white" />
                See How It Works
              </button>
            </div>
          </div>

          {/* Footer Grid */}
          <div className="w-full border-t border-white/5 pt-4 flex flex-col sm:flex-row justify-between items-center gap-2 text-[10px] text-white/30 z-10 animate-fade-in-up animation-delay-300">
            <div>
              &copy; {new Date().getFullYear()} CropTube. All rights reserved.
            </div>
            <div className="flex gap-4">
              <button onClick={() => setActiveModal('privacy')} className="hover:text-white transition-colors">Privacy Policy</button>
              <button onClick={() => setActiveModal('terms')} className="hover:text-white transition-colors">Terms of Service</button>
              <button onClick={() => setActiveModal('about')} className="hover:text-white transition-colors">About Us</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full dynamic-mesh-bg flex items-center justify-center p-4 sm:p-6 md:p-8 font-sans antialiased text-slate-200">
      {renderModal()}
      <div className="w-full max-w-2xl lg:max-w-[1480px] glass-panel rounded-[32px] p-6 sm:p-8 space-y-6 relative overflow-hidden">

        {/* Subtle top decoration */}
        <div className="absolute top-0 left-0 w-full h-32 bg-gradient-to-b from-black/40 to-transparent pointer-events-none" />

        {/* Header & Status */}
        <div className="flex justify-between items-center z-10 relative">
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => setShowDashboard(false)}
              className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center text-white/70 hover:text-white transition-all text-xs font-bold"
              title="Return to Home Page"
            >
              ←
            </button>
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center neon-glow-indigo">
              <Scissors className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="font-extrabold text-lg tracking-tight text-white font-sans">
                Crop<span className="text-indigo-400">Tube</span>
              </h1>
              <p className="text-[9px] text-slate-500 uppercase tracking-widest font-semibold">Surgical Extractor</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-[9px] bg-slate-900 border border-slate-800 px-2.5 py-1 rounded-full text-slate-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>Cloud API Active</span>
          </div>
        </div>

        {/* Cookies Expired Warning */}
        {cookiesExpired && (
          <div className="bg-amber-950/40 border border-amber-500/40 rounded-xl p-3 text-[10px] text-amber-400 space-y-1 relative z-10">
            <div className="flex justify-between items-center font-bold">
              <span>⚠️ Cookies Expired</span>
              <button onClick={() => setCookiesExpired(false)} className="text-amber-600 hover:text-amber-300">✕</button>
            </div>
            <p className="text-[9px] text-amber-400/80 leading-normal">
              Export Netscape cookies from Chrome using extension and register them in Cloud Auth settings.
            </p>
          </div>
        )}

        {/* Main Layout Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 relative z-10">
          
          {/* Left Column: URL, Formats, Preview and Slicing Range (7/12 cols on desktop) */}
          <div className="lg:col-span-7 space-y-6">
            {/* 1. LOAD VIDEO */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold tracking-widest text-slate-500 uppercase">1. Load Video URL</label>
              <div className="relative">
                <input
                  type="text"
                  value={youtubeUrl}
                  onChange={e => {
                    setYoutubeUrl(e.target.value);
                    if (!e.target.value) setSearchResults([]);
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder="Paste YouTube link or type search keywords..."
                  disabled={extracting}
                  className="w-full pl-3 pr-20 py-2.5 bg-slate-900/40 border border-slate-800 focus:border-indigo-500
                    rounded-xl outline-none text-xs text-slate-200 placeholder-slate-600
                    transition-all focus:ring-1 focus:ring-indigo-500/20 disabled:opacity-50"
                />
                <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
                  {youtubeUrl && !extracting && (
                    <button
                      onClick={() => { setYoutubeUrl(''); setSearchResults([]); }}
                      className="text-slate-500 hover:text-rose-400 text-xs transition-colors p-1"
                      title="Clear"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                  <button
                    onClick={handleSearch}
                    disabled={extracting || isSearching || !youtubeUrl.trim()}
                    className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-lg p-1.5 transition-colors"
                    title="Search YouTube"
                  >
                    {isSearching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {/* Search results dropdown */}
              {searchResults.length > 0 && (
                <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden mt-1.5 max-h-48 overflow-y-auto divide-y divide-slate-900 relative z-20">
                  {searchResults.map(video => (
                    <button
                      key={video.id}
                      onClick={() => {
                        setYoutubeUrl(video.url);
                        setSearchResults([]);
                      }}
                      className="w-full text-left p-2.5 hover:bg-slate-900 flex items-center gap-2.5 transition-colors text-[11px] text-slate-300"
                    >
                      <img
                        src={video.thumbnails[0]?.url || `https://i.ytimg.com/vi/${video.id}/mqdefault.jpg`}
                        alt={video.title}
                        className="w-16 aspect-video rounded object-cover bg-slate-900 flex-shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-slate-200 truncate">{video.title}</p>
                        <p className="text-slate-500 text-[10px] mt-0.5">{video.uploader} · {secsToHMS(video.duration)}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {errorMsg && (
                <div className="flex items-start gap-1.5 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-[10px] p-2.5 rounded-lg">
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                  {errorMsg}
                </div>
              )}
            </div>

            {/* 2. VIDEO STREAM PREVIEW */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold tracking-widest text-slate-500 uppercase">2. Video Stream Preview</label>
              {videoId ? (
                <div className="w-full aspect-video rounded-2xl overflow-hidden shadow-2xl border border-white/5 bg-black relative">
                  <div id="yt-player-wrap" className="w-full h-full" />
                </div>
              ) : (
                <div className="w-full aspect-video rounded-2xl border border-dashed border-slate-800 bg-slate-950/50 flex flex-col justify-center items-center gap-3 text-center p-6">
                  <div className="w-12 h-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center shadow-lg">
                    <Play className="w-5 h-5 text-white/50 animate-pulse" />
                  </div>
                  <p className="text-xs text-white/40 max-w-xs leading-relaxed">
                    Paste a YouTube URL above to load the video preview stream.
                  </p>
                  <button
                    onClick={() => setShowDashboard(false)}
                    className="mt-1 text-[10px] text-indigo-300 hover:text-indigo-200 border border-indigo-900/50 bg-indigo-950/25 px-3 py-1 rounded-full transition-all"
                  >
                    ← Return to Home
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Auth, Action Button, History (5/12 cols on desktop) */}
          <div className="lg:col-span-5 space-y-6 flex flex-col justify-between">
            <div className="space-y-6">
              
              {/* 3. SET RANGE MARKERS */}
              <div className="space-y-2">
                <label className="text-[10px] font-bold tracking-widest text-slate-500 uppercase">3. Set Range Markers</label>
                <div className="grid grid-cols-2 gap-2.5">
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

                {/* Visual Range Bar */}
                {duration > 0 && (
                  <div className="space-y-1.5 pt-1">
                    <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden relative">
                      <div
                        className="absolute h-full bg-gradient-to-r from-indigo-500 to-violet-500 rounded-full transition-all"
                        style={{
                          left: `${(hmsToSecs(startTime) / duration) * 100}%`,
                          width: `${Math.max(0.5, (clipLen / duration) * 100)}%`
                        }}
                      />
                    </div>
                    <div className="flex justify-between text-[9px] text-slate-500 font-mono">
                      <span>{startTime}</span>
                      <span className="text-indigo-400 font-bold">{secsToHMS(clipLen)} selected</span>
                      <span>{endTime}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* 4. QUALITY & FORMAT DUAL SELECTORS */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold tracking-widest text-slate-500 uppercase">4. Format</label>
                  <select
                    value={selectedFormat}
                    onChange={e => {
                      const fmt = e.target.value;
                      setSelectedFormat(fmt);
                      if (fmt === 'mp3' || fmt === 'm4a') {
                        setSelectedQuality('audio-320');
                      } else {
                        setSelectedQuality(availableResolutions.includes('1080p') ? '1080p' : (availableResolutions[0] || '1080p'));
                      }
                    }}
                    disabled={extracting}
                    className="w-full bg-slate-900/40 border border-slate-800 focus:border-indigo-500 text-slate-300
                      py-2.5 px-3 rounded-xl outline-none text-xs transition-colors disabled:opacity-50"
                  >
                    <optgroup label="Video Formats">
                      {availableVideoFormats.map(f => (
                        <option key={f} value={f}>{f.toUpperCase()}</option>
                      ))}
                    </optgroup>
                    <optgroup label="Audio Formats">
                      {availableAudioFormats.map(f => (
                        <option key={f} value={f}>{f.toUpperCase()}</option>
                      ))}
                    </optgroup>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold tracking-widest text-slate-500 uppercase">Quality</label>
                  <select
                    value={selectedQuality}
                    onChange={e => setSelectedQuality(e.target.value)}
                    disabled={extracting}
                    className="w-full bg-slate-900/40 border border-slate-800 focus:border-indigo-500 text-slate-300
                      py-2.5 px-3 rounded-xl outline-none text-xs transition-colors disabled:opacity-50"
                  >
                    {selectedFormat === 'mp3' || selectedFormat === 'm4a' ? (
                      <optgroup label="Audio Quality">
                        <option value="audio-320">320kbps (High)</option>
                        <option value="audio-256">256kbps</option>
                        <option value="audio-192">192kbps (Medium)</option>
                        <option value="audio-128">128kbps (Standard)</option>
                        <option value="audio-m4a">Original Quality</option>
                      </optgroup>
                    ) : (
                      <optgroup label="Video Quality">
                        {availableResolutions.map(r => (
                          <option key={r} value={r}>
                            {r === '2160p' || r === '4K' ? '4K (2160p Video)' :
                             r === '1440p' || r === '2K' ? '2K (1440p Video)' :
                             r === '1080p' ? '1080p (Full HD Video)' :
                             r === '720p' ? '720p (HD Video)' :
                             r === '480p' ? '480p (Standard Video)' :
                             r === '360p' ? '360p (Low Video)' : r}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </div>
              </div>


              {/* ── YouTube Auth (required on cloud IPs) ───────────────── */}
              <div className="space-y-1.5">
                <button
                  onClick={() => setShowCookies(v => !v)}
                  className="w-full flex justify-between items-center px-3 py-2 rounded-xl bg-slate-900/40 border border-slate-800 hover:border-amber-700/50 transition-all group"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold tracking-widest text-slate-400 uppercase group-hover:text-amber-400 transition-colors">
                      🔑 YouTube Auth (Cookies)
                    </span>
                    {hasGlobalCookies ? (
                      <span className="text-[9px] text-emerald-400 bg-emerald-950/50 border border-emerald-800/60 px-1.5 py-0.5 rounded-full flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Active
                      </span>
                    ) : (
                      <span className="text-[9px] text-amber-400 bg-amber-950/40 border border-amber-800/40 px-1.5 py-0.5 rounded-full">
                        Required for cloud
                      </span>
                    )}
                  </div>
                  <span className="text-slate-600 text-[10px]">{showCookies ? '▲' : '▼'}</span>
                </button>

                {showCookies && (
                  <div className="p-3 bg-slate-950/60 border border-amber-900/30 rounded-xl space-y-2.5">
                    <div className="text-[9px] text-amber-400/80 bg-amber-950/20 border border-amber-900/30 rounded-lg p-2 leading-relaxed">
                      <strong className="text-amber-400">⚠ Required on cloud servers.</strong> YouTube blocks datacenter IPs.
                      Export cookies using <span className="font-mono bg-black/40 px-1 rounded">"Get cookies.txt LOCALLY"</span> Chrome extension → paste below → Register.
                    </div>
                    <textarea
                      value={cookies}
                      onChange={e => setCookies(e.target.value)}
                      placeholder={'# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t...\tSID\t...'}
                      rows={4}
                      disabled={extracting}
                      className="w-full p-2 bg-black/50 border border-slate-800 focus:border-amber-700/60
                        text-[9px] text-slate-400 font-mono rounded-lg outline-none resize-none
                        placeholder-slate-700 disabled:opacity-50 transition-colors"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={saveCookies}
                        disabled={!cookies.trim() || extracting}
                        className="flex-1 py-1.5 rounded-lg text-[9px] font-bold transition-all
                          bg-amber-600 hover:bg-amber-500 text-white
                          disabled:bg-slate-900 disabled:text-slate-600 disabled:cursor-not-allowed"
                      >
                        Register on Server
                      </button>
                      {hasGlobalCookies && (
                        <button
                          onClick={deleteCookies}
                          disabled={extracting}
                          className="px-2.5 py-1.5 bg-rose-950/20 hover:bg-rose-950/40 border border-rose-900/40
                            text-rose-400 rounded-lg text-[9px] font-semibold transition-all"
                        >
                          Purge
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Action Trigger / Progress Button */}
              <div className="pt-2 border-t border-slate-900/40">
              {(extracting || extractionFailed || extractionComplete) ? (
                  <div className="w-full bg-slate-900/50 border border-slate-800 rounded-xl p-3.5 space-y-2.5 shadow-inner">
                    {/* Status header */}
                    <div className="flex justify-between items-center text-xs">
                      <div className="flex items-center gap-2 font-semibold">
                        {extracting ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                            <span className="text-indigo-400">{statusMessage || 'Processing...'}</span>
                          </>
                        ) : extractionFailed ? (
                          <span className="text-rose-400 flex items-center gap-1">
                            <AlertCircle className="w-3.5 h-3.5" />
                            Extraction Failed
                          </span>
                        ) : (
                          <span className="text-emerald-400 flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            {statusMessage}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {!extracting && (
                          <button
                            onClick={() => {
                              setExtractionFailed(false);
                              setExtractionComplete(false);
                              setStatusMessage('');
                              setProgress(0);
                              setShowReportPanel(false);
                              setReportSent(null);
                              setLastError('');
                            }}
                            className="text-[9px] font-mono text-rose-400 hover:text-rose-300 border border-rose-950/40 px-2 py-0.5 rounded bg-rose-950/20 transition-colors font-bold"
                          >
                            Close
                          </button>
                        )}
                        <span className="font-mono font-bold text-slate-400">{progress.toFixed(1)}%</span>
                      </div>
                    </div>

                    {/* Progress bar */}
                    <div className="w-full h-2 bg-slate-950 rounded-full overflow-hidden relative border border-slate-900">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ease-out relative ${
                          extractionFailed
                            ? 'bg-rose-600'
                            : 'bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500'
                        }`}
                        style={{ width: `${progress}%` }}
                      >
                        {!extractionFailed && <div className="absolute inset-0 bg-white/20 animate-pulse" />}
                      </div>
                    </div>

                    {/* Time progress */}
                    <div className="flex justify-between text-[9px] text-slate-500 font-mono">
                      <span>Processed: {secsToHMS(Math.round((progress / 100) * clipLen))}</span>
                      <span>Target: {secsToHMS(clipLen)}</span>
                    </div>

                    {/* Human-readable error message */}
                    {extractionFailed && lastError && (
                      <div className="bg-rose-950/20 border border-rose-900/40 rounded-lg p-2.5 text-[10px] text-rose-300 leading-relaxed">
                        {lastError}
                      </div>
                    )}

                    {/* Report Issue */}
                    {extractionFailed && (
                      <div className="pt-0.5">
                        {!showReportPanel ? (
                          <button
                            onClick={() => setShowReportPanel(true)}
                            className="w-full py-1.5 rounded-lg text-[9px] font-semibold border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-600 hover:bg-slate-800/40 transition-all"
                          >
                            Report Issue
                          </button>
                        ) : reportSent === 'success' ? (
                          <div className="text-center text-[9px] text-emerald-400 py-1.5 border border-emerald-900/40 rounded-lg bg-emerald-950/20">
                            ✓ Report sent successfully.
                          </div>
                        ) : reportSent === 'error' ? (
                          <div className="text-center text-[9px] text-rose-400 py-1.5 border border-rose-900/40 rounded-lg bg-rose-950/20">
                            ✗ Unable to send report.
                          </div>
                        ) : (
                          <div className="flex gap-2">
                            <button
                              onClick={handleReport}
                              className="flex-1 py-1.5 rounded-lg text-[9px] font-bold bg-rose-800/60 hover:bg-rose-700/70 border border-rose-700/50 text-rose-200 hover:text-white transition-all"
                            >
                              Send Report
                            </button>
                            <button
                              onClick={() => setShowReportPanel(false)}
                              className="px-3 py-1.5 rounded-lg text-[9px] text-slate-400 hover:text-white border border-slate-800 hover:border-slate-600 transition-all"
                            >
                              Cancel
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <button
                    onClick={handleExtract}
                    disabled={!videoId || clipLen <= 0 || selectedFormatId === 'none' || selectedFormatId === '' || isLoadingFormats}
                    className={`w-full py-3.5 rounded-xl font-bold flex items-center justify-center gap-2 text-xs transition-all duration-200
                      ${!videoId || clipLen <= 0 || selectedFormatId === 'none' || selectedFormatId === '' || isLoadingFormats
                        ? 'bg-slate-900/40 text-slate-600 border border-slate-900 cursor-not-allowed'
                        : 'bg-white hover:bg-slate-100 text-slate-950 shadow-lg hover:scale-[1.01] active:scale-[0.99]'
                      }`}
                  >
                    <Download className="w-4 h-4" />
                    Extract &amp; Download Clip
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-6 pt-4 border-t border-slate-900/60">
              {/* Session History or Footer */}
              <div className="mt-4 border-t border-slate-900 pt-4">
                {clipsHistory.length > 0 ? (
                  <div className="space-y-3">
                    <h3 className="text-[10px] font-semibold tracking-widest text-white/60 uppercase flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      Session History
                    </h3>
                    <div className="space-y-1.5">
                      {clipsHistory.map(clip => (
                        <div key={clip.id} className="flex justify-between items-center bg-black/40 border border-white/5 px-3 py-2 rounded-xl hover:border-white/10 transition-colors">
                          <div>
                            <p className="text-[11px] font-medium text-white/80">{clip.title}</p>
                            <p className="text-[9px] text-slate-400 font-mono">
                              <span className="text-emerald-400 font-semibold mr-1">✓ Success</span> · {clip.duration} · {clip.timestamp}
                            </p>
                          </div>
                          <a href={`/api/download/${clip.id}`} className="text-[10px] text-indigo-300 hover:text-indigo-200 flex items-center gap-1 font-semibold">
                            <Download className="w-3 h-3" /> Re-download
                          </a>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="w-full flex flex-col sm:flex-row justify-between items-center gap-2 text-[10px] text-white/30">
                    <span>&copy; {new Date().getFullYear()} CropTube. All rights reserved.</span>
                    <div className="flex gap-4">
                      <button onClick={() => setActiveModal('privacy')} className="hover:text-white transition-colors">Privacy Policy</button>
                      <button onClick={() => setActiveModal('terms')} className="hover:text-white transition-colors">Terms of Service</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

        </div>

      </div>
    </div>
  );
}

