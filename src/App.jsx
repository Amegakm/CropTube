import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Scissors, Play, Download, AlertCircle, CheckCircle2,
  Loader2, Crosshair, Trash2, Search, ChevronDown, Menu, X,
  Zap, Shield, Wifi, Clock, Ban, Music,
  Info, BookOpen, Briefcase, FileText, Lock, ChevronRight, Star
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

function normaliseHMS(raw) {
  const cleaned = raw.replace(/[^\d:]/g, '');
  const parts = cleaned.split(':');
  if (parts.length !== 3) return null;
  const [h, m, s] = parts.map(Number);
  if ([h, m, s].some(isNaN)) return null;
  if (m > 59 || s > 59) return null;
  return [h, m, s].map(n => String(n).padStart(2, '0')).join(':');
}

function isYouTubeUrl(str) {
  return /(?:youtu\.be\/|[?&]v=|shorts\/|embed\/)([A-Za-z0-9_-]{11})/.test(str) || str.startsWith('http');
}

// ─── TimeMarker ──────────────────────────────────────────────────────────────

function TimeMarker({ label, accent, value, onChange, onGrab, onSeek, disabled, playerReady }) {
  const [grabbed, setGrabbed] = useState(false);
  const [seeked, setSeeked] = useState(false);
  const [raw, setRaw] = useState(value);
  const [valid, setValid] = useState(true);
  const inputRef = useRef(null);

  useEffect(() => {
    if (document.activeElement !== inputRef.current) {
      setRaw(value);
      setValid(true);
    }
  }, [value]);

  const handleChange = (e) => {
    const v = e.target.value;
    setRaw(v);
    const norm = normaliseHMS(v);
    if (norm && v.length === 8) {
      setValid(true);
      onChange(norm);
    } else {
      setValid(!!norm);
    }
  };

  const handleBlur = () => {
    const norm = normaliseHMS(raw);
    if (norm) {
      setRaw(norm);
      setValid(true);
      onChange(norm);
    } else {
      setRaw(value);
      setValid(true);
    }
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
        ref={inputRef}
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
          className="flex items-center justify-center gap-1 py-2 sm:py-1 rounded-lg text-xs sm:text-[10px] font-semibold
            bg-slate-950 hover:bg-slate-800 border border-slate-800
            text-slate-300 hover:text-white transition-all
            disabled:opacity-40 disabled:cursor-not-allowed min-h-[36px] sm:min-h-0"
        >
          <Crosshair className="w-3 h-3 sm:w-2.5 sm:h-2.5" />
          Grab
        </button>

        <button
          onClick={handleSeek}
          disabled={!playerReady || disabled}
          className={`flex items-center justify-center gap-1 py-2 sm:py-1 rounded-lg text-xs sm:text-[10px] font-semibold
            bg-indigo-950/45 hover:bg-indigo-900/60 border border-indigo-900/50
            text-indigo-300 hover:text-indigo-100 transition-all
            disabled:opacity-40 disabled:cursor-not-allowed min-h-[36px] sm:min-h-0
            ${seeked ? 'seek-pulse' : ''}`}
        >
          Seek ▶
        </button>
      </div>
    </div>
  );
}

// ─── FAQ Accordion Item ───────────────────────────────────────────────────────

function FAQItem({ question, answer, isOpen, onToggle }) {
  return (
    <div className={`faq-item ${isOpen ? 'open' : ''}`}>
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-5 py-4 text-left"
      >
        <span className="font-body font-600 text-sm text-slate-200 pr-4">{question}</span>
        <ChevronDown
          className="w-4 h-4 text-indigo-400 flex-shrink-0 transition-transform duration-300"
          style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
        />
      </button>
      <div className={`faq-answer ${isOpen ? 'open' : ''}`}>
        <p className="px-5 pb-4 text-sm text-slate-400 leading-relaxed font-body">{answer}</p>
      </div>
    </div>
  );
}

// ─── Landing Page ─────────────────────────────────────────────────────────────

function LandingPage({ onEnterDashboard, setActiveModal, heroUrl, setHeroUrl }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState(null);
  const inputRef = useRef(null);




  const bentoFeatures = [
    {
      icon: <Zap className="w-6 h-6 text-yellow-400" />,
      title: 'No-Bloat Slicing',
      desc: 'Surgically extract only the segment you need. Zero overhead from unnecessary frames.',
      color: 'rgba(234,179,8,0.08)',
      border: 'rgba(234,179,8,0.15)',
    },
    {
      icon: <Shield className="w-6 h-6 text-emerald-400" />,
      title: 'Zero Quality Loss',
      desc: 'Stream-copy codec pipeline preserves every pixel. No re-encoding artifacts, ever.',
      color: 'rgba(52,211,153,0.08)',
      border: 'rgba(52,211,153,0.15)',
    },
    {
      icon: <Shield className="w-6 h-6 text-amber-400" />,
      title: 'Cloud Auth Support',
      desc: 'Netscape-format cookie injection bypasses datacenter IP blocks. Fully server-side.',
      color: 'rgba(251,146,60,0.08)',
      border: 'rgba(251,146,60,0.15)',
    },
    {
      icon: <Wifi className="w-6 h-6 text-indigo-400" />,
      title: 'Real-Time SSE Logs',
      desc: 'Live extraction progress via Server-Sent Events. Watch your clip materialise in real time.',
      color: 'rgba(99,102,241,0.08)',
      border: 'rgba(99,102,241,0.15)',
    },
    {
      icon: <Ban className="w-6 h-6 text-rose-400" />,
      title: 'No Full Downloads',
      desc: 'yt-dlp downloads only the exact byte range. Cloud bandwidth stays minimal.',
      color: 'rgba(244,63,94,0.08)',
      border: 'rgba(244,63,94,0.15)',
    },
    {
      icon: <Music className="w-6 h-6 text-violet-400" />,
      title: 'Audio Re-Sync & FFmpeg',
      desc: 'FFmpeg post-processes audio alignment and container merging for seamless playback.',
      color: 'rgba(167,139,250,0.08)',
      border: 'rgba(167,139,250,0.15)',
    },
  ];

  const faqItems = [
    {
      question: 'How does surgical slicing work?',
      answer: 'CropTube uses yt-dlp with a --download-sections flag to fetch only the byte range corresponding to your chosen timestamps directly from YouTube\'s CDN. FFmpeg then copies the stream into the final container without re-encoding — preserving original quality.'
    },
    {
      question: 'Why are YouTube cookies needed?',
      answer: 'YouTube\'s servers actively block requests originating from datacenter IP ranges. Uploading your browser\'s session cookies in Netscape format allows CropTube\'s cloud node to authenticate as your browser and bypass those blocks.'
    },
    {
      question: 'Does CropTube download the full video?',
      answer: 'No. CropTube instructs yt-dlp to stream only the byte range you specify. If your clip is 30 seconds of a 2-hour video, only those 30 seconds of data traverse the network.'
    },
    {
      question: 'Are 4K clips supported?',
      answer: 'Yes. CropTube dynamically fetches available resolutions from the video\'s manifest, including 2160p (4K) and 1440p (2K). You can choose the exact quality tier before extracting.'
    },
    {
      question: 'How are clips processed and delivered?',
      answer: 'Clips are processed in-memory on the cloud server and streamed directly to your browser via a download link. Files are purged from the server immediately after your download completes — nothing is stored.'
    },
  ];

  const handleCTA = () => {
    if (heroUrl.trim()) onEnterDashboard();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && heroUrl.trim()) onEnterDashboard();
  };

  const navLinks = [
    { label: 'About', modal: 'about' },
    { label: 'How It Works', id: 'how-it-works' },
    { label: 'Services', modal: 'services' },
    { label: 'FAQ', id: 'faq' },
  ];

  const scrollTo = (id) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setMobileMenuOpen(false);
  };

  return (
    <div className="min-h-screen w-full dynamic-mesh-bg font-body text-slate-200 overflow-x-hidden">

      {/* ── NAVBAR ──────────────────────────────────────────────── */}
      <nav className="nav-glass sticky top-0 z-50 w-full">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-12 sm:h-14">

            {/* Logo */}
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center neon-glow-indigo">
                <Scissors className="w-3.5 h-3.5 text-white" />
              </div>
              <span className="font-display font-800 text-[15px] tracking-tight text-white">
                Crop<span className="text-indigo-400">Tube</span>
              </span>
            </div>

            {/* Desktop links */}
            <div className="hidden md:flex items-center gap-7">
              {navLinks.map(l => (
                l.modal
                  ? <button key={l.label} onClick={() => setActiveModal(l.modal)} className="nav-link">{l.label}</button>
                  : <button key={l.label} onClick={() => scrollTo(l.id)} className="nav-link">{l.label}</button>
              ))}
            </div>

            {/* Docs button + mobile toggle */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => setActiveModal('docs')}
                className="hidden md:flex items-center gap-1.5 px-4 py-1.5 border border-white/10 hover:border-indigo-500/40 hover:bg-indigo-500/10
                  rounded-full text-[12px] font-semibold text-slate-300 hover:text-white transition-all"
              >
                Docs &amp; Guide ↗
              </button>
              <button
                className="md:hidden w-8 h-8 flex items-center justify-center text-slate-400 hover:text-white"
                onClick={() => setMobileMenuOpen(v => !v)}
                aria-label="Toggle menu"
              >
                {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
            </div>
          </div>

          {/* Mobile menu */}
          {mobileMenuOpen && (
            <div className="md:hidden pb-4 pt-2 space-y-1 border-t border-white/5 animate-fade-in">
              {navLinks.map(l => (
                l.modal
                  ? <button key={l.label} onClick={() => { setActiveModal(l.modal); setMobileMenuOpen(false); }}
                      className="block w-full text-left px-3 py-2.5 rounded-lg text-sm text-slate-300 hover:bg-white/5 hover:text-white transition-colors">
                      {l.label}
                    </button>
                  : <button key={l.label} onClick={() => scrollTo(l.id)}
                      className="block w-full text-left px-3 py-2.5 rounded-lg text-sm text-slate-300 hover:bg-white/5 hover:text-white transition-colors">
                      {l.label}
                    </button>
              ))}
              <button onClick={() => { setActiveModal('docs'); setMobileMenuOpen(false); }}
                className="block w-full text-left px-3 py-2.5 rounded-lg text-sm text-slate-300 hover:bg-white/5 hover:text-white transition-colors">
                Docs &amp; Guide ↗
              </button>
            </div>
          )}
        </div>
      </nav>

      {/* ── HERO ────────────────────────────────────────────────── */}
      <section className="relative px-4 sm:px-6 lg:px-8 pt-10 sm:pt-16 pb-8 sm:pb-16 max-w-4xl mx-auto text-center">
        {/* Glow ring behind headline */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-8 left-1/2 -translate-x-1/2 w-[520px] h-[320px] rounded-full opacity-20"
          style={{ background: 'radial-gradient(ellipse at center, rgba(99,102,241,0.5) 0%, transparent 70%)' }}
        />

        {/* Badge */}
        <div className="animate-fade-in inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-indigo-500/25
          bg-indigo-500/10 text-indigo-300 text-[11px] font-semibold tracking-wide mb-5 sm:mb-7">
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
          Cloud Extraction · No Full Downloads · 4K Supported
        </div>

        {/* Headline */}
        <h1 className="font-display animate-fade-in-up animation-delay-100
          text-[2rem] sm:text-5xl lg:text-[3.6rem] font-extrabold tracking-tight leading-[1.1] text-white mb-3 sm:mb-5">
          Surgical{' '}
          <span className="font-serif italic text-indigo-300">YouTube</span>
          <br />Clip Extraction
        </h1>

        {/* Sub-headline */}
        <p className="animate-fade-in-up animation-delay-200 text-slate-400 text-sm sm:text-lg leading-snug sm:leading-relaxed max-w-2xl mx-auto mb-6 sm:mb-10">
          Extract clips instantly. No full downloads. Zero quality loss. Up to 4K.
        </p>

        {/* Hero input + CTA */}
        <div className="animate-fade-in-up animation-delay-300 max-w-xl mx-auto space-y-2.5">
          <div className="hero-input-wrap flex items-center gap-2 px-4 py-2.5 sm:py-3">
            <Search className="w-4 h-4 text-slate-500 flex-shrink-0" />
            <input
              ref={inputRef}
              id="hero-url-input"
              type="text"
              value={heroUrl}
              onChange={e => setHeroUrl(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Paste YouTube URL or search…"
              className="flex-1 bg-transparent outline-none text-sm text-slate-200 placeholder-slate-600 min-w-0"
            />
            {heroUrl && (
              <button onClick={() => setHeroUrl('')} className="text-slate-600 hover:text-rose-400 transition-colors flex-shrink-0">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <button
            id="hero-cta-btn"
            onClick={handleCTA}
            disabled={!heroUrl.trim()}
            className="cta-btn w-full flex items-center justify-center gap-2"
          >
            <Scissors className="w-4 h-4" />
            Start Slicing
          </button>

          {/* Trust chips */}
          <div className="flex flex-wrap justify-center gap-1.5 pt-1">
            {['⬆ Up to 4K', '📱 Shorts Support', '⚡ No Full Downloads', '🔴 Real-Time Processing'].map(chip => (
              <span key={chip} className="text-[10px] text-slate-500 px-2.5 py-1 rounded-full border border-white/6 bg-white/2">
                {chip}
              </span>
            ))}
          </div>
        </div>

      </section>

      {/* ── BENTO FEATURE GRID ────────────────────────────────── */}
      <section className="px-4 sm:px-6 lg:px-8 pt-8 sm:pt-14 pb-20 max-w-6xl mx-auto">
        <div className="text-center mb-12">
          <h2 className="section-title text-3xl sm:text-4xl mb-3">Built Different</h2>
          <p className="text-slate-500 text-sm max-w-xl mx-auto">
            Every feature designed around one principle — extract exactly what you need, nothing more.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {bentoFeatures.map((f, i) => (
            <div
              key={f.title}
              className={`bento-card animate-fade-in-up`}
              style={{
                animationDelay: `${i * 80}ms`,
                '--card-bg': f.color,
                '--card-border': f.border,
              }}
            >
              <div
                className="w-11 h-11 rounded-xl flex items-center justify-center mb-4"
                style={{ background: f.color, border: `1px solid ${f.border}` }}
              >
                {f.icon}
              </div>
              <h3 className="font-display font-700 text-[15px] text-white mb-2">{f.title}</h3>
              <p className="text-slate-500 text-[13px] leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── HOW IT WORKS ─────────────────────────────────────── */}
      <section id="how-it-works" className="px-4 sm:px-6 lg:px-8 py-20 max-w-5xl mx-auto">
        <div className="text-center mb-14">
          <h2 className="section-title text-3xl sm:text-4xl mb-3">How It Works</h2>
          <p className="text-slate-500 text-sm max-w-md mx-auto">
            Three steps from URL to clip. No logins, no installs.
          </p>
        </div>

        {/* Desktop: horizontal timeline */}
        <div className="hidden md:flex items-start gap-0">
          {[
            {
              step: '01',
              title: 'Paste URL',
              desc: 'Drop a YouTube link into the hero input or search by keyword.',
              color: '#6366f1',
            },
            {
              step: '02',
              title: 'Select Range',
              desc: 'Use the video player to grab precise start and end timestamps.',
              color: '#8b5cf6',
            },
            {
              step: '03',
              title: 'Download Clip',
              desc: 'Hit Extract & Download. Your clip arrives in seconds.',
              color: '#a78bfa',
            },
          ].map((s, i, arr) => (
            <React.Fragment key={s.step}>
              <div className="flex flex-col items-center text-center flex-1 px-4">
                <div
                  className="w-12 h-12 rounded-2xl flex items-center justify-center text-white font-display font-800 text-[13px] mb-5 shadow-lg"
                  style={{ background: `linear-gradient(135deg, ${s.color}cc, ${s.color}88)`, boxShadow: `0 8px 24px -6px ${s.color}55` }}
                >
                  {s.step}
                </div>
                <h3 className="font-display font-700 text-white text-[16px] mb-2">{s.title}</h3>
                <p className="text-slate-500 text-[13px] leading-relaxed max-w-[200px]">{s.desc}</p>
              </div>
              {i < arr.length - 1 && (
                <div className="timeline-line mt-6 mx-2" />
              )}
            </React.Fragment>
          ))}
        </div>

        {/* Mobile: vertical timeline */}
        <div className="md:hidden space-y-6 relative pl-6">
          <div className="absolute left-5 top-0 bottom-0 w-px bg-gradient-to-b from-indigo-500/40 via-violet-500/30 to-transparent" />
          {[
            { step: '01', title: 'Paste URL', desc: 'Drop a YouTube link or search by keyword.', color: '#6366f1' },
            { step: '02', title: 'Select Range', desc: 'Grab precise start and end timestamps from the player.', color: '#8b5cf6' },
            { step: '03', title: 'Download Clip', desc: 'Hit Extract & Download. Clip arrives in seconds.', color: '#a78bfa' },
          ].map(s => (
            <div key={s.step} className="flex items-start gap-4 relative">
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-display font-700 text-xs flex-shrink-0 -ml-6 relative z-10"
                style={{ background: `linear-gradient(135deg, ${s.color}cc, ${s.color}88)`, boxShadow: `0 4px 16px -4px ${s.color}55` }}
              >
                {s.step}
              </div>
              <div className="pt-1">
                <h3 className="font-display font-700 text-white text-sm mb-1">{s.title}</h3>
                <p className="text-slate-500 text-[13px] leading-relaxed">{s.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────── */}
      <section id="faq" className="px-4 sm:px-6 lg:px-8 py-20 max-w-2xl mx-auto">
        <div className="text-center mb-12">
          <h2 className="section-title text-3xl sm:text-4xl mb-3">Frequently Asked</h2>
          <p className="text-slate-500 text-sm">Straight answers to real questions.</p>
        </div>
        <div className="space-y-2.5">
          {[
            {
              question: 'How does surgical slicing work?',
              answer: 'CropTube uses yt-dlp with a --download-sections flag to fetch only the byte range corresponding to your chosen timestamps directly from YouTube\'s CDN. FFmpeg then copies the stream into the final container without re-encoding — preserving original quality.'
            },
            {
              question: 'Why are YouTube cookies needed?',
              answer: 'YouTube\'s servers actively block requests originating from datacenter IP ranges. Uploading your browser\'s session cookies in Netscape format allows CropTube\'s cloud node to authenticate as your browser and bypass those blocks.'
            },
            {
              question: 'Does CropTube download the full video?',
              answer: 'No. CropTube instructs yt-dlp to stream only the byte range you specify. If your clip is 30 seconds of a 2-hour video, only those 30 seconds of data traverse the network.'
            },
            {
              question: 'Are 4K clips supported?',
              answer: 'Yes. CropTube dynamically fetches available resolutions from the video\'s manifest, including 2160p (4K) and 1440p (2K). You can choose the exact quality tier before extracting.'
            },
            {
              question: 'How are clips processed and delivered?',
              answer: 'Clips are processed in-memory on the cloud server and streamed directly to your browser via a download link. Files are purged from the server immediately after your download completes — nothing is stored.'
            },
          ].map((item, i) => (
            <FAQItem
              key={i}
              question={item.question}
              answer={item.answer}
              isOpen={openFaq === i}
              onToggle={() => setOpenFaq(openFaq === i ? null : i)}
            />
          ))}
        </div>
      </section>

      {/* ── FOOTER ──────────────────────────────────────────── */}
      <footer className="border-t border-white/5 px-4 sm:px-6 lg:px-8 py-10 max-w-7xl mx-auto">
        <div className="flex flex-col sm:flex-row justify-between items-center gap-4 text-[11px] text-slate-600">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-md bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center">
              <Scissors className="w-2.5 h-2.5 text-white" />
            </div>
            <span className="font-display font-600 text-slate-400">CropTube</span>
            <span>· © {new Date().getFullYear()} All rights reserved.</span>
          </div>
          <div className="flex flex-wrap justify-center gap-4 sm:gap-5">
            <button onClick={() => setActiveModal('privacy')} className="hover:text-white transition-colors">Privacy Policy</button>
            <button onClick={() => setActiveModal('terms')} className="hover:text-white transition-colors">Terms of Service</button>
            <button onClick={() => setActiveModal('about')} className="hover:text-white transition-colors">About</button>
            <button onClick={() => setActiveModal('docs')} className="hover:text-white transition-colors">Docs</button>
          </div>
        </div>
      </footer>
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
  const [isModalClosing, setIsModalClosing] = useState(false);
  // Hero URL state — shared with LandingPage so it pre-populates the dashboard input
  const [heroUrl, setHeroUrl] = useState('');

  const playerRef = useRef(null);
  const ytApiReady = useRef(false);

  // ── Close modal with exit animation ──────────────────────────────────────
  const closeModal = useCallback(() => {
    setIsModalClosing(true);
    setTimeout(() => {
      setActiveModal(null);
      setIsModalClosing(false);
    }, 220);
  }, []);

  // ── ESC key closes modal ──────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape' && activeModal) closeModal(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeModal, closeModal]);

  // ── Enter dashboard from hero ─────────────────────────────────────────────
  const handleEnterDashboard = useCallback(() => {
    if (heroUrl.trim()) {
      setYoutubeUrl(heroUrl.trim());
    }
    setShowDashboard(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [heroUrl]);

  const handleSearch = () => {
    if (isSearching) return;
    const trimmed = youtubeUrl.trim();
    if (!trimmed) {
      setSearchResults([]);
      return;
    }
    if (isYouTubeUrl(trimmed)) return;
    setIsSearching(true);
    setErrorMsg('');
    fetch(`/api/search?q=${encodeURIComponent(trimmed)}`)
      .then(r => {
        if (!r.ok) throw new Error('Search failed');
        return r.json();
      })
      .then(data => {
        setSearchResults(data.entries || []);
        if ((data.entries || []).length === 0) setErrorMsg('No results found.');
      })
      .catch(() => { setErrorMsg('Failed to fetch search results.'); })
      .finally(() => { setIsSearching(false); });
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      const trimmed = youtubeUrl.trim();
      if (!isYouTubeUrl(trimmed)) handleSearch();
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
    const m = youtubeUrl.match(/(?:youtu\.be\/|[?&]v=|shorts\/|embed\/)([A-Za-z0-9_-]{11})/);
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
      if (playerRef.current && typeof playerRef.current.destroy === 'function') {
        try { playerRef.current.destroy(); } catch (_) { }
        playerRef.current = null;
      }
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
        if (!r.ok) throw new Error(data?.error || `Failed to fetch format metadata (${r.status})`);
        return data;
      })
      .then(data => {
        if (data.rawFormats) setRawFormats(data.rawFormats);
        else setRawFormats([]);

        if (data.videoFormats && data.videoFormats.length > 0) setAvailableVideoFormats(data.videoFormats);
        if (data.audioFormats && data.audioFormats.length > 0) setAvailableAudioFormats(data.audioFormats);
        if (data.heights && data.heights.length > 0) setAvailableResolutions(data.heights);

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
      .finally(() => { setIsLoadingFormats(false); });
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
    setProgress(0);
    setStatusMessage('Preparing clip...');
    setExtractionFailed(false);
    setExtractionComplete(false);
    setLastError('');

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

        es.onopen = () => { console.log('[Frontend SSE] connected'); };

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
          setTimeout(() => {
            console.log('[Frontend SSE] download triggered');
            link.click();
            document.body.removeChild(link);
          }, 100);

          setTimeout(() => {
            setExtracting(false);
            setCurrentStep(0);
            es.close();
            console.log('[Frontend SSE] eventsource closed');
          }, 1000);
        });

        es.onerror = () => {
          console.log('[Frontend SSE] onerror triggered');
          if (isCompleted) { es.close(); console.log('[Frontend SSE] eventsource closed'); return; }
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

    const closing = isModalClosing;

    // ── MODAL CONTENT VARIANTS ──────────────────────────────────────────────
    const ModalAbout = () => (
      <>
        {/* Icon + title */}
        <div className="flex items-start gap-4 mb-6">
          <div className="modal-icon-badge" style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', boxShadow: '0 8px 24px -6px rgba(99,102,241,0.45)' }}>
            <Scissors className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="font-display text-xl font-800 text-white tracking-tight">About CropTube</h3>
            <p className="text-xs text-indigo-400 mt-0.5 font-medium">Surgical YouTube clip extraction</p>
          </div>
        </div>

        {/* Feature badges */}
        <div className="flex flex-wrap gap-2 mb-5">
          {['Open Source','4K Supported','Zero Storage','Cloud Auth','SSE Logs','FFmpeg Pipeline'].map(tag => (
            <span key={tag} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold border border-indigo-500/20 bg-indigo-500/8 text-indigo-300">
              <Star className="w-2.5 h-2.5" />{tag}
            </span>
          ))}
        </div>

        <p className="text-sm text-slate-400 leading-relaxed mb-5">
          CropTube is a premium open-source tool built to extract high-quality clips from YouTube without downloading entire video streams. Powered by <span className="text-slate-300 font-medium">yt-dlp</span> and <span className="text-slate-300 font-medium">FFmpeg</span>, it slices only the exact byte range you need — saving bandwidth and storage.
        </p>

        <div className="grid grid-cols-3 gap-3">
          {[{ label: 'Format Support', value: 'MP4 · MKV · MP3 · M4A' }, { label: 'Max Resolution', value: '4K (2160p)' }, { label: 'Clip Delivery', value: 'Instant download' }].map(s => (
            <div key={s.label} className="bg-white/3 border border-white/5 rounded-xl p-3 text-center">
              <div className="text-white font-display font-700 text-xs mb-1">{s.value}</div>
              <div className="text-slate-600 text-[10px]">{s.label}</div>
            </div>
          ))}
        </div>
      </>
    );

    const ModalWorks = () => (
      <>
        <div className="flex items-start gap-4 mb-6">
          <div className="modal-icon-badge" style={{ background: 'linear-gradient(135deg,#0ea5e9,#6366f1)', boxShadow: '0 8px 24px -6px rgba(14,165,233,0.35)' }}>
            <Play className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="font-display text-xl font-800 text-white tracking-tight">How It Works</h3>
            <p className="text-xs text-sky-400 mt-0.5 font-medium">Five steps from URL to clip</p>
          </div>
        </div>
        <div className="space-y-3">
          {[
            { n: '01', title: 'Paste a YouTube URL', desc: 'Drop any standard youtube.com/watch, youtu.be share, or Shorts link into the input.' },
            { n: '02', title: 'Load the Preview', desc: 'The embedded player streams the video so you can review it without downloading.' },
            { n: '03', title: 'Set Start & End Markers', desc: 'Hit Grab to capture the current playhead time, then seek to the end point and grab again.' },
            { n: '04', title: 'Choose Format & Quality', desc: 'Pick container (MP4, MKV, MP3, M4A) and resolution up to 4K — options are dynamically fetched.' },
            { n: '05', title: 'Extract & Download', desc: 'One click kicks off a cloud extraction job. Your clip downloads automatically when ready.' },
          ].map(step => (
            <div key={step.n} className="flex gap-3 items-start">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-600 to-violet-600 flex items-center justify-center text-white font-display font-700 text-[10px] flex-shrink-0 mt-0.5">{step.n}</div>
              <div>
                <p className="text-sm font-semibold text-slate-200 mb-0.5">{step.title}</p>
                <p className="text-xs text-slate-500 leading-relaxed">{step.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </>
    );

    const ModalServices = () => (
      <>
        <div className="flex items-start gap-4 mb-6">
          <div className="modal-icon-badge" style={{ background: 'linear-gradient(135deg,#f59e0b,#ef4444)', boxShadow: '0 8px 24px -6px rgba(245,158,11,0.35)' }}>
            <Briefcase className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="font-display text-xl font-800 text-white tracking-tight">Services &amp; API</h3>
            <p className="text-xs text-amber-400 mt-0.5 font-medium">Cloud infrastructure for video extraction</p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            { icon: <Zap className="w-4 h-4 text-yellow-400" />, title: 'Cloud Extraction', desc: 'Scalable cloud nodes run yt-dlp extraction jobs on demand with dedicated bandwidth.' },
            { icon: <Shield className="w-4 h-4 text-emerald-400" />, title: 'Cookie Auth', desc: 'Netscape-format cookie injection to bypass datacenter IP restrictions on YouTube.' },
            { icon: <Wifi className="w-4 h-4 text-indigo-400" />, title: 'SSE Pipeline', desc: 'Real-time progress events streamed to your browser via Server-Sent Events.' },
            { icon: <BookOpen className="w-4 h-4 text-violet-400" />, title: 'Developer API', desc: 'REST endpoints for search, format detection, clip initiation, and download delivery.' },
          ].map(s => (
            <div key={s.title} className="modal-service-card">
              <div className="flex items-center gap-2 mb-2">{s.icon}<span className="text-xs font-bold text-slate-200 font-display">{s.title}</span></div>
              <p className="text-[11px] text-slate-500 leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
      </>
    );

    const ModalDocs = () => (
      <>
        <div className="flex items-start gap-4 mb-6">
          <div className="modal-icon-badge" style={{ background: 'linear-gradient(135deg,#10b981,#0ea5e9)', boxShadow: '0 8px 24px -6px rgba(16,185,129,0.35)' }}>
            <BookOpen className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="font-display text-xl font-800 text-white tracking-tight">Docs &amp; Guide</h3>
            <p className="text-xs text-emerald-400 mt-0.5 font-medium">Integration, configuration, and API reference</p>
          </div>
        </div>
        <div className="space-y-4">
          {[
            { label: 'Getting Started', title: 'Quick Setup', body: 'Paste any YouTube URL into the hero input. No account or install required. For cloud deployments, register Netscape cookies to bypass datacenter IP blocks.' },
            { label: 'Cookie Auth', title: 'Netscape Cookie Format', body: 'Export using the "Get cookies.txt LOCALLY" Chrome extension. Paste the raw text into the Settings panel and click Register on Server to activate cloud-side auth.' },
            { label: 'API Reference', title: 'REST Endpoints', body: 'POST /api/extract/initiate · GET /api/extract/stream (SSE) · GET /api/download/:fileId · GET /api/formats · GET /api/search · POST /api/settings/cookies' },
            { label: 'yt-dlp Config', title: 'Extraction Pipeline', body: '--download-sections clips only the specified byte range. FFmpeg stream-copies the result with -c copy to avoid re-encoding quality loss.' },
          ].map(section => (
            <div key={section.label}>
              <p className="doc-label">{section.label}</p>
              <p className="text-xs font-semibold text-slate-300 mb-1">{section.title}</p>
              <p className="text-[11px] text-slate-500 leading-relaxed font-mono bg-white/2 border border-white/5 rounded-lg px-3 py-2">{section.body}</p>
            </div>
          ))}
        </div>
      </>
    );

    const ModalLegal = ({ type }) => {
      const isPrivacy = type === 'privacy';
      const sections = isPrivacy ? [
        { heading: 'Data Collection', body: 'CropTube does not collect, store, or transmit personal data. No accounts, no tracking, no analytics beyond standard server logs.' },
        { heading: 'Video Storage', body: 'Extracted clips are held in temporary server memory only for the duration of your download. Files are purged immediately after delivery completes.' },
        { heading: 'Cookies & Auth', body: 'YouTube session cookies you register are stored server-side solely to authenticate yt-dlp requests on your behalf. They are never logged, shared, or used for any other purpose.' },
        { heading: 'Third-Party Services', body: 'CropTube interacts with YouTube CDN and optionally Telegram for server-side error alerts. No user-identifiable data is included in those interactions.' },
      ] : [
        { heading: 'Permitted Use', body: 'CropTube is intended for personal, educational, and research use only. Users must comply with YouTube\'s Terms of Service and applicable copyright law.' },
        { heading: 'Prohibited Use', body: 'You may not use CropTube to download, redistribute, or monetise copyright-protected content without the rights holder\'s explicit permission.' },
        { heading: 'No Warranty', body: 'This service is provided as-is without warranty of any kind. We are not liable for outages, extraction failures, or changes in YouTube\'s API behaviour.' },
        { heading: 'Service Changes', body: 'We reserve the right to modify or discontinue the service at any time without notice. Continued use constitutes acceptance of any updated terms.' },
      ];
      return (
        <>
          <div className="flex items-start gap-4 mb-5">
            <div className="modal-icon-badge" style={{ background: isPrivacy ? 'linear-gradient(135deg,#6366f1,#06b6d4)' : 'linear-gradient(135deg,#f43f5e,#fb923c)', boxShadow: isPrivacy ? '0 8px 24px -6px rgba(99,102,241,0.35)' : '0 8px 24px -6px rgba(244,63,94,0.35)' }}>
              {isPrivacy ? <Lock className="w-5 h-5 text-white" /> : <FileText className="w-5 h-5 text-white" />}
            </div>
            <div>
              <h3 className="font-display text-xl font-800 text-white tracking-tight">{isPrivacy ? 'Privacy Policy' : 'Terms of Service'}</h3>
              <p className="text-[11px] mt-0.5" style={{ color: isPrivacy ? '#67e8f9' : '#fda4af' }}>Last updated June {new Date().getFullYear()}</p>
            </div>
          </div>
          <div className="space-y-0.5">
            {sections.map(s => (
              <div key={s.heading}>
                <p className="legal-heading">{s.heading}</p>
                <p className="text-[12px] text-slate-400 leading-relaxed">{s.body}</p>
              </div>
            ))}
          </div>
        </>
      );
    };

    const contentMap = {
      about:    <ModalAbout />,
      works:    <ModalWorks />,
      services: <ModalServices />,
      docs:     <ModalDocs />,
      privacy:  <ModalLegal type="privacy" />,
      terms:    <ModalLegal type="terms" />,
    };

    const content = contentMap[activeModal];
    if (!content) return null;

    return (
      <div
        onClick={closeModal}
        className={`fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 cursor-pointer
          bg-black/65 backdrop-blur-sm
          ${closing ? 'modal-backdrop-exit' : 'modal-backdrop-enter'}`}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className={`modal-content-box w-full max-w-lg cursor-default relative
            ${closing ? 'modal-panel-exit' : 'modal-panel-enter'}`}
        >
          {/* Scrollable body */}
          <div className="max-h-[82vh] overflow-y-auto p-6 sm:p-8">
            {content}
          </div>

          {/* Footer bar */}
          <div className="border-t border-white/5 px-6 sm:px-8 py-4 flex items-center justify-between">
            <span className="text-[10px] text-slate-600 font-mono">ESC to close</span>
            <button
              onClick={closeModal}
              className="flex items-center gap-1.5 px-4 py-2 bg-white/6 hover:bg-white/10 border border-white/8 hover:border-white/15
                text-white/80 hover:text-white text-xs font-semibold rounded-xl transition-all"
            >
              <X className="w-3.5 h-3.5" /> Close
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ── LANDING PAGE ─────────────────────────────────────────────────────────
  if (!showDashboard) {
    return (
      <>
        {renderModal()}
        <LandingPage
          onEnterDashboard={handleEnterDashboard}
          setActiveModal={setActiveModal}
          heroUrl={heroUrl}
          setHeroUrl={setHeroUrl}
        />
      </>
    );
  }

  // ── DASHBOARD ────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen w-full dynamic-mesh-bg flex items-center justify-center p-2 sm:p-6 md:p-8 font-body antialiased text-slate-200">
      {renderModal()}
      <div className="w-full max-w-2xl lg:max-w-[1480px] glass-panel rounded-[24px] sm:rounded-[32px] p-4 sm:p-8 space-y-6 relative overflow-hidden">

        {/* Subtle top decoration */}
        <div className="absolute top-0 left-0 w-full h-32 bg-gradient-to-b from-black/40 to-transparent pointer-events-none" />

        {/* Header & Status */}
        <div className="flex flex-col sm:flex-row gap-3 sm:gap-0 justify-between items-start sm:items-center z-10 relative">
          <div className="flex items-center gap-2 sm:gap-2.5">
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
              <h1 className="font-display font-extrabold text-base sm:text-lg tracking-tight text-white">
                Crop<span className="text-indigo-400">Tube</span>
              </h1>
              <p className="text-[8px] sm:text-[9px] text-slate-500 uppercase tracking-widest font-semibold">Surgical Extractor</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-[8px] sm:text-[9px] bg-slate-900 border border-slate-800 px-2.5 py-1 rounded-full text-slate-400">
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

          {/* Left Column: Auth, URL, Preview (7/12 cols on desktop) */}
          <div className="lg:col-span-7 space-y-6">

            {/* 1. YOUTUBE AUTH COOKIES */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold tracking-widest text-slate-500 uppercase">1. YouTube Auth Cookies</label>
              <div className="space-y-1.5">
                <button
                  onClick={() => setShowCookies(v => !v)}
                  className="w-full flex justify-between items-center px-3 py-2.5 rounded-xl bg-slate-900/40 border border-slate-800 hover:border-amber-700/50 transition-all group"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold tracking-widest text-slate-400 uppercase group-hover:text-amber-400 transition-colors">
                      🔑 Access Cookies
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
                      className="w-full p-2.5 bg-black/50 border border-slate-800 focus:border-amber-700/60
                        text-[9px] text-slate-400 font-mono rounded-lg outline-none resize-none
                        placeholder-slate-700 disabled:opacity-50 transition-colors"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={saveCookies}
                        disabled={!cookies.trim() || extracting}
                        className="flex-1 py-2 rounded-lg text-[10px] font-bold transition-all
                          bg-amber-600 hover:bg-amber-500 text-white
                          disabled:bg-slate-900 disabled:text-slate-600 disabled:cursor-not-allowed"
                      >
                        Register on Server
                      </button>
                      {hasGlobalCookies && (
                        <button
                          onClick={deleteCookies}
                          disabled={extracting}
                          className="px-3 py-2 bg-rose-950/20 hover:bg-rose-950/40 border border-rose-900/40
                            text-rose-400 rounded-lg text-[10px] font-semibold transition-all"
                        >
                          Purge
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* 2. LOAD VIDEO URL */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold tracking-widest text-slate-500 uppercase">2. Load Video URL</label>
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
                  className="w-full pl-3 pr-20 py-3 bg-slate-900/40 border border-slate-800 focus:border-indigo-500
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
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button
                    onClick={handleSearch}
                    disabled={extracting || isSearching || !youtubeUrl.trim()}
                    className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-lg p-2 transition-colors"
                    title="Search YouTube"
                  >
                    {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
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

            {/* 3. VIDEO PREVIEW */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold tracking-widest text-slate-500 uppercase">3. Video Preview</label>
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
                    className="mt-1 text-[10px] text-indigo-300 hover:text-indigo-200 border border-indigo-900/50 bg-indigo-950/25 px-3.5 py-2 rounded-full transition-all"
                  >
                    ← Return to Home
                  </button>
                </div>
              )}
            </div>

          </div>

          {/* Right Column: Slicing Range, Formats, Action Button, History (5/12 cols on desktop) */}
          <div className="lg:col-span-5 space-y-6 flex flex-col justify-between">
            <div className="space-y-6">

              {/* 4. RANGE SELECTION */}
              <div className="space-y-2">
                <label className="text-[10px] font-bold tracking-widest text-slate-500 uppercase">4. Range Selection</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
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

              {/* 5. FORMAT & QUALITY */}
              <div className="space-y-2">
                <label className="text-[10px] font-bold tracking-widest text-slate-500 uppercase">5. Format &amp; Quality</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <span className="text-[9px] font-semibold text-slate-400 uppercase tracking-wider">Format</span>
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
                        py-3 px-3 rounded-xl outline-none text-xs transition-colors disabled:opacity-50"
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

                  <div className="space-y-1">
                    <span className="text-[9px] font-semibold text-slate-400 uppercase tracking-wider">Quality</span>
                    <select
                      value={selectedQuality}
                      onChange={e => setSelectedQuality(e.target.value)}
                      disabled={extracting}
                      className="w-full bg-slate-900/40 border border-slate-800 focus:border-indigo-500 text-slate-300
                        py-3 px-3 rounded-xl outline-none text-xs transition-colors disabled:opacity-50"
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
              </div>

              {/* 6. DOWNLOAD */}
              <div className="space-y-2 pt-2 border-t border-slate-900/40">
                <label className="text-[10px] font-bold tracking-widest text-slate-500 uppercase">6. Download</label>
                {(extracting || extractionFailed || extractionComplete) ? (
                  <div className="w-full bg-slate-900/50 border border-slate-800 rounded-xl p-3.5 space-y-2.5 shadow-inner">
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
                              setLastError('');
                            }}
                            className="text-[9px] font-mono text-rose-400 hover:text-rose-300 border border-rose-950/40 px-2 py-1 rounded bg-rose-950/20 transition-colors font-bold"
                          >
                            Close
                          </button>
                        )}
                        <span className="font-mono font-bold text-slate-400">{progress.toFixed(1)}%</span>
                      </div>
                    </div>

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

                    <div className="flex justify-between text-[9px] text-slate-500 font-mono">
                      <span>Processed: {secsToHMS(Math.round((progress / 100) * clipLen))}</span>
                      <span>Target: {secsToHMS(clipLen)}</span>
                    </div>

                    {extractionFailed && lastError && (
                      <div className="bg-rose-950/20 border border-rose-900/40 rounded-lg p-2.5 text-[10px] text-rose-300 leading-relaxed">
                        {lastError}
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
              {/* Session History & Footer */}
              {clipsHistory.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-[10px] font-semibold tracking-widest text-white/60 uppercase flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    Session History
                  </h3>
                  <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
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
              )}

              <div className="w-full flex flex-col sm:flex-row justify-between items-center gap-3 text-[10px] text-white/30 border-t border-slate-900 pt-4">
                <span>&copy; {new Date().getFullYear()} CropTube. All rights reserved.</span>
                <div className="flex flex-wrap justify-center gap-3 sm:gap-4 mt-2 sm:mt-0">
                  <button onClick={() => setActiveModal('about')} className="hover:text-white transition-colors">About</button>
                  <button onClick={() => setActiveModal('works')} className="hover:text-white transition-colors">Works</button>
                  <button onClick={() => setActiveModal('services')} className="hover:text-white transition-colors">Services</button>
                  <button onClick={() => setActiveModal('docs')} className="hover:text-white transition-colors">Docs &amp; Guide</button>
                  <button onClick={() => setActiveModal('privacy')} className="hover:text-white transition-colors">Privacy Policy</button>
                  <button onClick={() => setActiveModal('terms')} className="hover:text-white transition-colors">Terms of Service</button>
                </div>
              </div>
            </div>
          </div>

        </div>

      </div>
    </div>
  );
}
