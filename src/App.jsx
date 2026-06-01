import React, { useState, useEffect, useRef } from 'react';
import { 
  Scissors, 
  Play, 
  Download, 
  Video, 
  Clock, 
  Terminal as TerminalIcon, 
  AlertCircle, 
  CheckCircle2, 
  Loader2, 
  RefreshCw,
  ExternalLink,
  Info
} from 'lucide-react';

export default function App() {
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [videoId, setVideoId] = useState('');
  const [startTime, setStartTime] = useState('00:00:00');
  const [endTime, setEndTime] = useState('00:00:00');
  const [duration, setDuration] = useState(0);
  const [extracting, setExtracting] = useState(false);
  const [logs, setLogs] = useState([]);
  const [clipsHistory, setClipsHistory] = useState([]);
  const [currentStep, setCurrentStep] = useState(0); // 0: Idle, 1: Loading, 2: Streaming, 3: Completed
  const [errorMsg, setErrorMsg] = useState('');
  const [quality, setQuality] = useState('best');
  const [cookies, setCookies] = useState(() => localStorage.getItem('croptube_cookies') || '');
  const [showCookies, setShowCookies] = useState(false);

  useEffect(() => {
    localStorage.setItem('croptube_cookies', cookies);
  }, [cookies]);

  const playerRef = useRef(null);
  const terminalEndRef = useRef(null);

  // Parse YouTube ID on URL change
  useEffect(() => {
    if (!youtubeUrl) {
      setVideoId('');
      setDuration(0);
      setStartTime('00:00:00');
      setEndTime('00:00:00');
      setErrorMsg('');
      return;
    }

    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = youtubeUrl.match(regExp);
    
    if (match && match[2].length === 11) {
      setVideoId(match[2]);
      setErrorMsg('');
    } else {
      setVideoId('');
      setErrorMsg('Invalid YouTube URL format. Please paste a standard watch or share link.');
    }
  }, [youtubeUrl]);

  // Load YouTube IFrame Player API
  useEffect(() => {
    if (!window.YT) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      const firstScriptTag = document.getElementsByTagName('script')[0];
      firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
    }
  }, []);

  // Initialize/Update player instance
  useEffect(() => {
    if (!videoId || !window.YT) return;

    const createPlayer = () => {
      // Clean up existing player if any
      if (playerRef.current && typeof playerRef.current.destroy === 'function') {
        try {
          playerRef.current.destroy();
        } catch (e) {
          console.error('[Player Cleanup] Error destroying player:', e);
        }
      }

      playerRef.current = new window.YT.Player('youtube-player-element', {
        height: '100%',
        width: '100%',
        videoId: videoId,
        playerVars: {
          autoplay: 0,
          modestbranding: 1,
          rel: 0,
          controls: 1
        },
        events: {
          onReady: (event) => {
            const videoDuration = event.target.getDuration();
            setDuration(videoDuration);
            setStartTime('00:00:00');
            setEndTime(formatSecondsToHMS(videoDuration));
          },
          onError: (err) => {
            console.error('[Player API] Embed error:', err);
            setErrorMsg('Unable to embed this YouTube video. The publisher may have restricted playback.');
          }
        }
      });
    };

    if (window.YT && window.YT.Player) {
      createPlayer();
    } else {
      window.onYouTubeIframeAPIReady = createPlayer;
    }
  }, [videoId]);

  // Scroll to bottom of terminal
  useEffect(() => {
    if (terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  // Helpers: Formatting time representation
  const formatSecondsToHMS = (seconds) => {
    if (isNaN(seconds) || seconds < 0) return '00:00:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return [
      h.toString().padStart(2, '0'),
      m.toString().padStart(2, '0'),
      s.toString().padStart(2, '0')
    ].join(':');
  };

  const hmsToSeconds = (hms) => {
    const parts = hms.split(':').map(Number);
    if (parts.length !== 3 || parts.some(isNaN)) return 0;
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  };

  // Button Event Handlers: Dynamic Grab from video time
  const handleGrabStart = () => {
    if (playerRef.current && typeof playerRef.current.getCurrentTime === 'function') {
      const time = playerRef.current.getCurrentTime();
      setStartTime(formatSecondsToHMS(time));
    }
  };

  const handleGrabEnd = () => {
    if (playerRef.current && typeof playerRef.current.getCurrentTime === 'function') {
      const time = playerRef.current.getCurrentTime();
      setEndTime(formatSecondsToHMS(time));
    }
  };

  // Safe manual adjustments
  const handleTimeChange = (type, index, val) => {
    const rawVal = val.replace(/\D/g, '').substring(0, 2);
    const currentHMS = type === 'start' ? startTime.split(':') : endTime.split(':');
    currentHMS[index] = rawVal.padStart(2, '0');
    const finalHMS = currentHMS.join(':');
    if (type === 'start') {
      setStartTime(finalHMS);
    } else {
      setEndTime(finalHMS);
    }
  };

  // Triggers SSE surgical stream extraction with cookie-POST handshake
  const handleExtractClip = () => {
    if (!youtubeUrl || !videoId) return;

    const startSec = hmsToSeconds(startTime);
    const endSec = hmsToSeconds(endTime);

    if (endSec <= startSec) {
      setErrorMsg('Validation Error: End time must be strictly after the Start time.');
      return;
    }

    if (endSec > duration && duration > 0) {
      setErrorMsg(`Validation Error: End time exceeds the video's total duration of ${formatSecondsToHMS(duration)}.`);
      return;
    }

    setErrorMsg('');
    setExtracting(true);
    setCurrentStep(1); // Loading
    setLogs([
      { text: `[CropTube Initialize] Launching clip slicing agent...`, type: 'system' },
      { text: `[Parameters] Target video URL: ${youtubeUrl}`, type: 'info' },
      { text: `[Parameters] Segment range: ${startTime} ➔ ${endTime} (${formatSecondsToHMS(endSec - startSec)})`, type: 'info' }
    ]);

    // Step 1: Initiate job via secure POST (safely handles large cookie headers)
    fetch('/api/extract/initiate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url: youtubeUrl,
        start: startTime,
        end: endTime,
        quality: quality,
        cookies: cookies
      })
    })
    .then(response => {
      if (!response.ok) {
        return response.json().then(errData => { throw new Error(errData.error || 'Job initiation failed.'); });
      }
      return response.json();
    })
    .then(data => {
      const { fileId } = data;
      setCurrentStep(2); // Slicing active

      // Step 2: Open SSE stream using the generated Job File ID
      const eventSource = new EventSource(`/api/extract/stream?fileId=${fileId}`);

      eventSource.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);

          if (payload.type === 'log') {
            setLogs((prev) => [
              ...prev,
              { text: payload.message, type: 'info' }
            ]);
          } 
          
          else if (payload.type === 'error') {
            setLogs((prev) => [
              ...prev,
              { text: `[FATAL EXCEPTION] ${payload.message}`, type: 'error' }
            ]);
            setExtracting(false);
            setCurrentStep(0);
            eventSource.close();
          } 
          
          else if (payload.type === 'complete') {
            const { fileId, filename } = payload.message;
            setCurrentStep(3); // Completed
            setLogs((prev) => [
              ...prev,
              { text: `🎉 [SUCCESS] Surgical cut completed successfully. Sliced file cached as ID ${fileId}.`, type: 'success' },
              { text: `💾 Triggering browser file transfer...`, type: 'system' }
            ]);

            setClipsHistory((prev) => [
              {
                id: fileId,
                title: `Clip (${startTime} - ${endTime})`,
                url: youtubeUrl,
                videoId,
                start: startTime,
                end: endTime,
                duration: formatSecondsToHMS(endSec - startSec),
                timestamp: new Date().toLocaleTimeString()
              },
              ...prev
            ]);

            // Trigger download attachment route
            window.location.href = `/api/download/${fileId}`;

            setTimeout(() => {
              setExtracting(false);
              setCurrentStep(0);
            }, 3000);

            eventSource.close();
          }
        } catch (e) {
          console.error('[SSE Output Parser Error]', e);
        }
      };

      eventSource.onerror = (err) => {
        console.error('[SSE Connection Exception]', err);
        setLogs((prev) => [
          ...prev,
          { text: `⚠️ Connection with SSE logging tunnel was severed. Slicing may still be completing on local backend.`, type: 'error' }
        ]);
        setExtracting(false);
        setCurrentStep(0);
        eventSource.close();
      };
    })
    .catch(err => {
      setLogs((prev) => [
        ...prev,
        { text: `❌ [INITIATION ERROR] ${err.message}`, type: 'error' }
      ]);
      setExtracting(false);
      setCurrentStep(0);
    });
  };

  const startSec = hmsToSeconds(startTime);
  const endSec = hmsToSeconds(endTime);
  const clipLength = Math.max(0, endSec - startSec);

  return (
    <div className="flex-1 w-full bg-slate-950 radial-glow pb-12 flex flex-col justify-start items-center">
      {/* Header Area */}
      <header className="w-full max-w-7xl px-6 pt-8 pb-4 flex justify-between items-center border-b border-slate-900">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex justify-center items-center neon-glow-indigo">
            <Scissors className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-sans font-extrabold text-2xl tracking-tight text-white flex items-center">
              Crop<span className="text-indigo-400">Tube</span>
            </h1>
            <p className="text-xs text-slate-500">Surgical Network Stream-Seeking Slicer</p>
          </div>
        </div>
        <div className="flex items-center space-x-2 text-xs bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-lg text-slate-400">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          <span>Local Node API: Active</span>
        </div>
      </header>

      {/* Main Grid Dashboard */}
      <main className="w-full max-w-7xl px-6 mt-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left Column: Media & Input (7 cols) */}
        <section className="lg:col-span-7 space-y-6">
          {/* Paste URL Panel */}
          <div className="bg-slate-900/60 backdrop-blur-md border border-slate-800/80 rounded-2xl p-6 shadow-xl space-y-4">
            <h2 className="text-sm font-semibold tracking-wider text-slate-400 uppercase flex items-center gap-2">
              <Video className="w-4 h-4 text-indigo-400" />
              1. Load YouTube Video
            </h2>
            <div className="relative">
              <input 
                type="text" 
                value={youtubeUrl}
                onChange={(e) => setYoutubeUrl(e.target.value)}
                placeholder="Paste standard watch link (e.g. https://www.youtube.com/watch?v=...)"
                className="w-full pl-4 pr-12 py-3 bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl outline-none text-sm text-slate-200 placeholder-slate-600 transition-all font-sans focus:ring-1 focus:ring-indigo-500/20"
                disabled={extracting}
              />
              {youtubeUrl && (
                <button
                  onClick={() => setYoutubeUrl('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs transition-colors"
                  disabled={extracting}
                >
                  Clear
                </button>
              )}
            </div>
            {errorMsg && (
              <div className="flex items-start space-x-2 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs p-3 rounded-lg">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}
          </div>

          {/* YouTube Player Embed */}
          <div className="bg-slate-900/60 backdrop-blur-md border border-slate-800/80 rounded-2xl p-4 shadow-xl overflow-hidden aspect-video relative flex flex-col justify-center items-center">
            {videoId ? (
              <div id="youtube-player-element" className="w-full h-full rounded-xl overflow-hidden bg-black shadow-inner"></div>
            ) : (
              <div className="text-center p-8 space-y-3">
                <div className="w-16 h-16 rounded-full bg-slate-950 border border-slate-800 flex justify-center items-center mx-auto text-slate-600">
                  <Play className="w-6 h-6 animate-pulse" />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-slate-400">Preview Player Idle</p>
                  <p className="text-xs text-slate-600 max-w-sm mx-auto">
                    Paste a valid YouTube watch link above to auto-embed the official HTML5 iframe component.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Grab Markers panel */}
          <div className="bg-slate-900/60 backdrop-blur-md border border-slate-800/80 rounded-2xl p-6 shadow-xl space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-sm font-semibold tracking-wider text-slate-400 uppercase flex items-center gap-2">
                <Clock className="w-4 h-4 text-indigo-400" />
                2. Set Timeline Markers
              </h2>
              {duration > 0 && (
                <span className="text-xs text-slate-500 bg-slate-950 px-2.5 py-1 rounded-md border border-slate-900">
                  Total Length: {formatSecondsToHMS(duration)}
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Start Time Selection Card */}
              <div className="bg-slate-950 border border-slate-900 p-4 rounded-xl space-y-3 flex flex-col justify-between">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-medium text-slate-400">Crop Start Marker</span>
                  <span className="text-[10px] text-slate-600 font-mono">HH:MM:SS</span>
                </div>
                {/* Time Form inputs */}
                <div className="flex justify-center items-center space-x-1.5 py-2">
                  <input
                    type="text"
                    value={startTime.split(':')[0]}
                    onChange={(e) => handleTimeChange('start', 0, e.target.value)}
                    className="w-12 text-center bg-slate-900 border border-slate-800 text-lg font-mono text-indigo-400 py-1.5 rounded-lg focus:border-indigo-500 outline-none"
                    disabled={!videoId || extracting}
                  />
                  <span className="text-slate-600 font-bold">:</span>
                  <input
                    type="text"
                    value={startTime.split(':')[1]}
                    onChange={(e) => handleTimeChange('start', 1, e.target.value)}
                    className="w-12 text-center bg-slate-900 border border-slate-800 text-lg font-mono text-indigo-400 py-1.5 rounded-lg focus:border-indigo-500 outline-none"
                    disabled={!videoId || extracting}
                  />
                  <span className="text-slate-600 font-bold">:</span>
                  <input
                    type="text"
                    value={startTime.split(':')[2]}
                    onChange={(e) => handleTimeChange('start', 2, e.target.value)}
                    className="w-12 text-center bg-slate-900 border border-slate-800 text-lg font-mono text-indigo-400 py-1.5 rounded-lg focus:border-indigo-500 outline-none"
                    disabled={!videoId || extracting}
                  />
                </div>
                <button
                  onClick={handleGrabStart}
                  className="w-full py-2 text-xs font-semibold bg-slate-900 hover:bg-slate-800 border border-slate-850 text-slate-300 rounded-lg hover:text-white transition-all flex justify-center items-center gap-1.5"
                  disabled={!videoId || extracting}
                >
                  <Clock className="w-3.5 h-3.5" />
                  Grab Player Time
                </button>
              </div>

              {/* End Time Selection Card */}
              <div className="bg-slate-950 border border-slate-900 p-4 rounded-xl space-y-3 flex flex-col justify-between">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-medium text-slate-400">Crop End Marker</span>
                  <span className="text-[10px] text-slate-600 font-mono">HH:MM:SS</span>
                </div>
                {/* Time Form inputs */}
                <div className="flex justify-center items-center space-x-1.5 py-2">
                  <input
                    type="text"
                    value={endTime.split(':')[0]}
                    onChange={(e) => handleTimeChange('end', 0, e.target.value)}
                    className="w-12 text-center bg-slate-900 border border-slate-800 text-lg font-mono text-indigo-400 py-1.5 rounded-lg focus:border-indigo-500 outline-none"
                    disabled={!videoId || extracting}
                  />
                  <span className="text-slate-600 font-bold">:</span>
                  <input
                    type="text"
                    value={endTime.split(':')[1]}
                    onChange={(e) => handleTimeChange('end', 1, e.target.value)}
                    className="w-12 text-center bg-slate-900 border border-slate-800 text-lg font-mono text-indigo-400 py-1.5 rounded-lg focus:border-indigo-500 outline-none"
                    disabled={!videoId || extracting}
                  />
                  <span className="text-slate-600 font-bold">:</span>
                  <input
                    type="text"
                    value={endTime.split(':')[2]}
                    onChange={(e) => handleTimeChange('end', 2, e.target.value)}
                    className="w-12 text-center bg-slate-900 border border-slate-800 text-lg font-mono text-indigo-400 py-1.5 rounded-lg focus:border-indigo-500 outline-none"
                    disabled={!videoId || extracting}
                  />
                </div>
                <button
                  onClick={handleGrabEnd}
                  className="w-full py-2 text-xs font-semibold bg-slate-900 hover:bg-slate-800 border border-slate-850 text-slate-300 rounded-lg hover:text-white transition-all flex justify-center items-center gap-1.5"
                  disabled={!videoId || extracting}
                >
                  <Clock className="w-3.5 h-3.5" />
                  Grab Player Time
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Right Column: Execution & Terminal (5 cols) */}
        <section className="lg:col-span-5 space-y-6">
          {/* Action Trigger Card */}
          <div className="bg-slate-900/60 backdrop-blur-md border border-slate-800/80 rounded-2xl p-6 shadow-xl space-y-6 relative overflow-hidden">
            {/* Background absolute elements for visual look */}
            <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/10 rounded-full blur-2xl"></div>

            <h2 className="text-sm font-semibold tracking-wider text-slate-400 uppercase flex items-center gap-2">
              <Scissors className="w-4 h-4 text-indigo-400 animate-pulse" />
              3. Process Slicing Request
            </h2>

            {/* Video Quality Selection Selector */}
            <div className="space-y-2">
              <label className="text-xs font-semibold tracking-wider text-slate-500 uppercase flex items-center gap-1.5">
                <Video className="w-3.5 h-3.5 text-indigo-400" />
                Target Video Quality
              </label>
              <select
                value={quality}
                onChange={(e) => setQuality(e.target.value)}
                disabled={extracting}
                className="w-full bg-slate-950 border border-slate-900 focus:border-indigo-500 text-slate-300 py-2.5 px-3.5 rounded-xl outline-none font-sans text-xs transition-colors"
              >
                <option value="best">Highest Available Quality (4K / 2K / 1080p+)</option>
                <option value="1080p">Full HD (1080p)</option>
                <option value="720p">High Quality (720p)</option>
                <option value="480p">Medium Quality (480p)</option>
                <option value="360p">Low Quality / Fast Download (360p)</option>
              </select>
            </div>

            {/* YouTube Session Cookies (Collapsible) */}
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setShowCookies(!showCookies)}
                className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold flex items-center space-x-1 transition-colors outline-none"
              >
                <span>{showCookies ? '▼ Hide' : '▶ Show'} Cloud Auth Cookies (Optional)</span>
              </button>
              
              {showCookies && (
                <div className="space-y-1.5 p-3.5 bg-slate-950 border border-slate-900 rounded-xl transition-all">
                  <div className="flex justify-between items-center text-[10px] text-slate-500">
                    <span>Paste YouTube Netscape Cookies</span>
                    <span className="text-[9px] text-indigo-400 font-mono">Persistent Cache</span>
                  </div>
                  <textarea
                    value={cookies}
                    onChange={(e) => setCookies(e.target.value)}
                    placeholder="# Netscape HTTP Cookie File&#10;.youtube.com&#9;TRUE&#9;/&#9;TRUE&#9;1745437890&#9;SID&#9;..."
                    className="w-full h-[90px] p-2 bg-slate-900 border border-slate-850 focus:border-indigo-500 text-[10px] text-slate-400 font-mono rounded-lg outline-none resize-none placeholder-slate-700"
                    disabled={extracting}
                  />
                  <p className="text-[9px] text-slate-600 leading-normal font-sans">
                    Cloud servers get bot-challenged by YouTube. Paste exported cookies using extensions like <strong>Get cookies.txt LOCALLY</strong> to bypass. Cookies are deleted automatically on execution.
                  </p>
                </div>
              )}
            </div>

            {/* Timings summary */}
            <div className="bg-slate-950/80 border border-slate-900 rounded-xl p-4 space-y-3.5">
              <div className="flex justify-between items-center text-xs border-b border-slate-900 pb-2">
                <span className="text-slate-500">Selected Range</span>
                <span className="font-mono text-slate-300">
                  {startTime} ➔ {endTime}
                </span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-slate-500">Extraction Length</span>
                <span className={`font-mono font-bold ${clipLength > 0 ? 'text-indigo-400' : 'text-rose-500'}`}>
                  {formatSecondsToHMS(clipLength)}
                </span>
              </div>
              <div className="flex items-start space-x-2 text-[10px] text-slate-600 bg-slate-900/40 p-2 rounded border border-slate-900/50">
                <Info className="w-3.5 h-3.5 flex-shrink-0 text-slate-500 mt-0.5" />
                <span>
                  Using surgical stream-seek command. Preceding chunks are bypassed. You will download only this exact range.
                </span>
              </div>
            </div>

            <button
              onClick={handleExtractClip}
              disabled={extracting || !videoId || clipLength <= 0}
              className={`w-full py-4 rounded-xl font-bold flex justify-center items-center gap-2.5 transition-all text-sm ${
                extracting
                  ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
                  : !videoId || clipLength <= 0
                  ? 'bg-slate-900/40 text-slate-600 border border-slate-900 cursor-not-allowed'
                  : 'bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white shadow-lg neon-glow-indigo active:scale-[0.98]'
              }`}
            >
              {extracting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin text-indigo-400" />
                  <span>
                    {currentStep === 1 ? 'Initializing Agent...' : 'Surgically Slicing Stream...'}
                  </span>
                </>
              ) : (
                <>
                  <Download className="w-5 h-5" />
                  <span>Extract & Download Clip</span>
                </>
              )}
            </button>
          </div>

          {/* Slicing Terminal Logs */}
          <div className="bg-slate-900/60 backdrop-blur-md border border-slate-800/80 rounded-2xl shadow-xl overflow-hidden flex flex-col h-[280px]">
            <div className="bg-slate-950 px-4 py-3 border-b border-slate-900 flex justify-between items-center flex-shrink-0">
              <div className="flex items-center space-x-2">
                <TerminalIcon className="w-4 h-4 text-indigo-400" />
                <span className="text-xs font-mono font-bold text-slate-300">yt-dlp_agent@croptube:~$</span>
              </div>
              {extracting && (
                <div className="flex items-center space-x-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-ping"></span>
                  <span className="text-[10px] font-mono text-indigo-400">Stream-Seeking</span>
                </div>
              )}
            </div>

            {/* Terminal Outputs */}
            <div className="flex-1 p-4 bg-slate-950 font-mono text-xs overflow-y-auto space-y-2 selection:bg-indigo-600 selection:text-white">
              {logs.length === 0 ? (
                <p className="text-slate-600 italic">Terminal waiting. Launch clip extraction to capture real-time subprocess stdout logs...</p>
              ) : (
                logs.map((log, index) => {
                  let colorClass = 'text-slate-400';
                  if (log.type === 'error') colorClass = 'text-rose-400 bg-rose-950/20 border-l-2 border-rose-500 pl-2 py-0.5';
                  else if (log.type === 'success') colorClass = 'text-emerald-400 font-bold bg-emerald-950/20 border-l-2 border-emerald-500 pl-2 py-0.5';
                  else if (log.type === 'system') colorClass = 'text-cyan-400 border-l-2 border-cyan-500 pl-2';
                  else if (log.type === 'info') {
                    if (log.text.startsWith('[stderr]') || log.text.startsWith('[Warning')) colorClass = 'text-amber-500/80';
                    else if (log.text.includes('%')) colorClass = 'text-indigo-300';
                    else if (log.text.includes('download')) colorClass = 'text-indigo-400';
                    else if (log.text.includes('[ffmpeg]')) colorClass = 'text-violet-400';
                  }

                  return (
                    <div key={index} className={`leading-relaxed break-all ${colorClass}`}>
                      {log.text}
                    </div>
                  );
                })
              )}
              <div ref={terminalEndRef} />
            </div>
          </div>

          {/* Session history clips */}
          {clipsHistory.length > 0 && (
            <div className="bg-slate-900/60 backdrop-blur-md border border-slate-800/80 rounded-2xl p-5 shadow-xl space-y-3.5">
              <h3 className="text-xs font-semibold tracking-wider text-slate-400 uppercase flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                Extracted Clips (Session History)
              </h3>
              <div className="space-y-2 max-h-[140px] overflow-y-auto">
                {clipsHistory.map((clip) => (
                  <div key={clip.id} className="flex justify-between items-center bg-slate-950 border border-slate-900 px-3.5 py-2.5 rounded-xl hover:border-slate-850 transition-colors">
                    <div className="flex flex-col space-y-0.5">
                      <span className="text-xs font-medium text-slate-300">{clip.title}</span>
                      <div className="flex space-x-2 text-[10px] text-slate-500 font-mono">
                        <span>Duration: {clip.duration}</span>
                        <span>•</span>
                        <span>{clip.timestamp}</span>
                      </div>
                    </div>
                    <a 
                      href={`/api/download/${clip.id}`} 
                      className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center space-x-1 font-semibold"
                      title="Request redownload if still cached"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download</span>
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

      </main>

      {/* Aesthetic Footer */}
      <footer className="mt-12 text-center text-[10px] text-slate-600 max-w-sm px-6">
        <p>CropTube — Private Personal Tool. Slices video and audio packets directly from network streams. Auto-cleanup immediately destroys server storage footprints on delivery completion.</p>
      </footer>
    </div>
  );
}
