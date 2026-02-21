'use client';

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  Suspense,
} from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Mic,
  MicOff,
  Camera,
  CameraOff,
  Send,
  Upload,
  PhoneOff,
  AlertTriangle,
  Loader2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Message {
  role: 'ai' | 'user';
  text: string;
  timestamp: Date;
}

interface SpeechRecognitionInstance {
  continuous: boolean;
  lang: string;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList;
}
interface SpeechRecognitionResultList {
  [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionResult {
  [index: number]: SpeechRecognitionAlternative;
}
interface SpeechRecognitionAlternative {
  transcript: string;
}

// ─── Waveform animation ───────────────────────────────────────────────────────

function WaveformBars({ active }: { active: boolean }) {
  return (
    <div className="flex items-end justify-center gap-0.5 h-8">
      {[0.6, 1.0, 0.7, 1.2, 0.5, 0.9, 0.4].map((h, i) => (
        <div
          key={i}
          className={`w-1 rounded-full transition-all duration-200 ${active ? 'bg-emerald-400' : 'bg-border'}`}
          style={{
            height: active ? `${8 + h * 18}px` : '4px',
            animation: active ? `wave-bar ${0.5 + i * 0.07}s ease-in-out infinite alternate` : 'none',
          }}
        />
      ))}
      <style>{`
        @keyframes wave-bar {
          from { transform: scaleY(0.3); }
          to   { transform: scaleY(1.0); }
        }
      `}</style>
    </div>
  );
}

// ─── Doctor Avatar ────────────────────────────────────────────────────────────

function DoctorAvatar({ speaking }: { speaking: boolean }) {
  return (
    <div className="relative flex items-center justify-center w-24 h-24">
      {/* Ripple rings when speaking */}
      {speaking && (
        <>
          <div className="absolute inset-0 rounded-full bg-emerald-500/20 animate-ping" style={{ animationDuration: '1.2s' }} />
          <div className="absolute inset-2 rounded-full bg-emerald-500/15 animate-ping" style={{ animationDuration: '1.6s', animationDelay: '0.3s' }} />
        </>
      )}
      {/* Avatar */}
      <div className={`relative w-20 h-20 rounded-full flex items-center justify-center border-2 transition-all duration-300 shadow-lg ${
        speaking
          ? 'border-emerald-400 bg-emerald-500/10 shadow-emerald-500/20'
          : 'border-border bg-muted'
      }`}>
        <span className="text-3xl select-none">🩺</span>
      </div>
    </div>
  );
}

// ─── Main consultation component ──────────────────────────────────────────────

function ConsultationInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [consultId, setConsultId] = useState<string | null>(searchParams.get('id'));
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'ai',
      text: "Hey, good to see you. I'm Dr. Nova — what's going on today? Tell me what's been bothering you, and feel free to show me anything on camera.",
      timestamp: new Date(),
    },
  ]);
  const [textInput, setTextInput] = useState('');
  const [symptomsText, setSymptomsText] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [aiSpeaking, setAiSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [cameraPermissionDenied, setCameraPermissionDenied] = useState(false);
  const [sessionEnded, setSessionEnded] = useState(false);
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const [uploadBase64, setUploadBase64] = useState<string | null>(null);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [connecting, setConnecting] = useState(true);
  // Track whether user has interacted (needed for audio autoplay unlock)
  const [audioUnlocked, setAudioUnlocked] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);

  // ── Init consultation ──────────────────────────────────────────────────────

  useEffect(() => {
    const init = async () => {
      if (!consultId) {
        try {
          const res = await fetch('/api/health/consult', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ acknowledged_disclaimer: true }),
          });
          if (res.ok) {
            const data = await res.json();
            if (data.id) setConsultId(data.id);
          }
        } catch {
          // proceed without session id
        }
      }
      setConnecting(false);
    };
    init();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Camera ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!cameraEnabled || sessionEnded) return;
    navigator.mediaDevices
      .getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
      .then((stream) => {
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setCameraError(null);
        setCameraPermissionDenied(false);
      })
      .catch((err: Error) => {
        const isDenied = err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError';
        setCameraPermissionDenied(isDenied);
        setCameraError(isDenied ? null : 'Camera not available. Text and image upload still work.');
        setCameraEnabled(false);
      });
    return () => { streamRef.current?.getTracks().forEach((t) => t.stop()); };
  }, [cameraEnabled, sessionEnded]);

  // ── Auto-scroll ────────────────────────────────────────────────────────────

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Cleanup on unmount ─────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      if (consultId) {
        fetch(`/api/health/consult/${consultId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'completed', ended_at: new Date().toISOString() }),
          keepalive: true,
        }).catch(() => {});
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      recognitionRef.current?.stop();
      currentAudioRef.current?.pause();
    };
  }, [consultId]);

  // ── Helpers ────────────────────────────────────────────────────────────────

  const addMessage = useCallback((role: 'ai' | 'user', text: string) => {
    setMessages((prev) => [...prev, { role, text, timestamp: new Date() }]);
  }, []);

  // Unlock audio on first user interaction (browser autoplay policy)
  const unlockAudio = useCallback(() => {
    if (audioUnlocked) return;
    // Play a silent audio context to unlock autoplay
    try {
      const ctx = new AudioContext();
      ctx.resume().then(() => ctx.close());
    } catch { /* ignore */ }
    setAudioUnlocked(true);
  }, [audioUnlocked]);

  const playVoiceResponse = useCallback(async (text: string) => {
    if (!voiceEnabled || !consultId) return;

    // Stop any currently playing audio
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }

    try {
      const res = await fetch(`/api/health/consult/${consultId}/voice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });

      if (!res.ok) return;

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      currentAudioRef.current = audio;

      setAiSpeaking(true);

      audio.onended = () => {
        setAiSpeaking(false);
        URL.revokeObjectURL(url);
        currentAudioRef.current = null;
      };

      audio.onerror = () => {
        setAiSpeaking(false);
        URL.revokeObjectURL(url);
        currentAudioRef.current = null;
      };

      // play() can throw if autoplay is blocked; silently degrade
      await audio.play().catch(() => {
        setAiSpeaking(false);
      });

    } catch {
      setAiSpeaking(false);
    }
  }, [consultId, voiceEnabled]);

  // Build conversation history for context (last 10 messages)
  const getConversationHistory = useCallback(() => {
    return messages.slice(-10).map((m) => ({ role: m.role, text: m.text }));
  }, [messages]);

  // ── Capture camera frame ───────────────────────────────────────────────────

  const captureFrame = useCallback(async () => {
    if (!videoRef.current || analyzing) return;
    unlockAudio();

    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth || 640;
    canvas.height = videoRef.current.videoHeight || 480;
    canvas.getContext('2d')!.drawImage(videoRef.current, 0, 0);
    const imageBase64 = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];

    const userMsg = symptomsText || '[Shared camera frame]';
    addMessage('user', userMsg);
    setAnalyzing(true);

    try {
      const endpoint = consultId ? `/api/health/consult/${consultId}/analyze` : '/api/health/analyze';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64,
          symptoms: symptomsText || 'Patient shared a camera frame for visual assessment.',
          conversationHistory: getConversationHistory(),
        }),
      });
      const data = await res.json();
      const reply = data.response || "Let me take a closer look. Can you describe what you're experiencing?";
      addMessage('ai', reply);
      await playVoiceResponse(reply);
    } catch {
      const fallback = "I'm having some trouble right now. Can you describe what you're experiencing?";
      addMessage('ai', fallback);
      await playVoiceResponse(fallback);
    } finally {
      setAnalyzing(false);
      setSymptomsText('');
    }
  }, [consultId, symptomsText, analyzing, addMessage, playVoiceResponse, getConversationHistory, unlockAudio]);

  // ── Upload image ───────────────────────────────────────────────────────────

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = ev.target?.result as string;
      setUploadPreview(result);
      setUploadBase64(result.split(',')[1]);
    };
    reader.readAsDataURL(file);
  };

  const analyzeUpload = useCallback(async () => {
    if (!uploadBase64 || analyzing) return;
    unlockAudio();

    const userMsg = symptomsText || '[Uploaded image]';
    addMessage('user', userMsg);
    setAnalyzing(true);

    try {
      const endpoint = consultId ? `/api/health/consult/${consultId}/analyze` : '/api/health/analyze';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: uploadBase64,
          symptoms: symptomsText || 'Patient uploaded an image for review.',
          conversationHistory: getConversationHistory(),
        }),
      });
      const data = await res.json();
      const reply = data.response || "Okay, I can see the image. Can you tell me more about what you're experiencing?";
      addMessage('ai', reply);
      await playVoiceResponse(reply);
    } catch {
      const fallback = "Image came through but I'm having trouble analyzing right now. Walk me through what you're seeing.";
      addMessage('ai', fallback);
      await playVoiceResponse(fallback);
    } finally {
      setAnalyzing(false);
      setUploadPreview(null);
      setUploadBase64(null);
      setSymptomsText('');
    }
  }, [consultId, uploadBase64, symptomsText, analyzing, addMessage, playVoiceResponse, getConversationHistory, unlockAudio]);

  // ── Send text message ──────────────────────────────────────────────────────

  const sendTextMessage = useCallback(async (text: string) => {
    if (!text.trim() || analyzing) return;
    unlockAudio();

    addMessage('user', text);
    setTextInput('');
    setAnalyzing(true);

    try {
      const endpoint = consultId ? `/api/health/consult/${consultId}/analyze` : '/api/health/analyze';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symptoms: text,
          conversationHistory: getConversationHistory(),
        }),
      });
      const data = await res.json();
      const reply = data.response || "Tell me more — when did this start?";
      addMessage('ai', reply);
      await playVoiceResponse(reply);
    } catch {
      const fallback = "Sorry, I'm having a connection issue. Try again in a moment.";
      addMessage('ai', fallback);
      await playVoiceResponse(fallback);
    } finally {
      setAnalyzing(false);
    }
  }, [consultId, analyzing, addMessage, playVoiceResponse, getConversationHistory, unlockAudio]);

  // ── Voice recognition ──────────────────────────────────────────────────────

  const requestCameraAccess = useCallback(() => {
    setCameraPermissionDenied(false);
    setCameraError(null);
    setCameraEnabled(true);
  }, []);

  const startListening = useCallback(() => {
    if (typeof window === 'undefined') return;
    unlockAudio();
    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionInstance;
      webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
    };
    const SpeechRecognitionAPI = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) return;

    const rec = new SpeechRecognitionAPI();
    rec.continuous = false;
    rec.lang = 'en-US';
    rec.onresult = (e: SpeechRecognitionEvent) => {
      const transcript = e.results[0][0].transcript;
      setListening(false);
      sendTextMessage(transcript);
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    rec.start();
    recognitionRef.current = rec;
    setListening(true);
  }, [sendTextMessage, unlockAudio]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setListening(false);
  }, []);

  // ── End session ────────────────────────────────────────────────────────────

  const endSession = useCallback(async () => {
    currentAudioRef.current?.pause();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    recognitionRef.current?.stop();
    setCameraEnabled(false);

    if (consultId) {
      await fetch(`/api/health/consult/${consultId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed', ended_at: new Date().toISOString() }),
      }).catch(() => {});
    }
    setSessionEnded(true);
  }, [consultId]);

  // ── Session ended ──────────────────────────────────────────────────────────

  if (sessionEnded) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center space-y-6">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto">
            <PhoneOff className="w-7 h-7 text-muted-foreground" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-foreground">Session Ended</h2>
            <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
              Always follow up with a licensed healthcare provider for any diagnosis or treatment decisions.
            </p>
            <p className="text-red-500 mt-3 text-sm font-medium">
              In a medical emergency, call 911 immediately.
            </p>
          </div>
          <Button onClick={() => router.push('/dashboard/health')} variant="outline">
            Back to Health Dashboard
          </Button>
        </div>
      </div>
    );
  }

  // ── Main UI ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">

      {/* ── Header ── */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-border bg-background/95 backdrop-blur sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold tracking-tight">Health Consultation</h1>
          {connecting ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="w-3 h-3 animate-spin" />
              Connecting…
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-500">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              LIVE
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Mute toggle */}
          <button
            onClick={() => {
              unlockAudio();
              if (voiceEnabled && currentAudioRef.current) {
                currentAudioRef.current.pause();
                setAiSpeaking(false);
              }
              setVoiceEnabled((v) => !v);
            }}
            className={`p-2 rounded-lg transition-colors ${voiceEnabled ? 'text-foreground hover:bg-muted' : 'text-muted-foreground hover:bg-muted'}`}
            title={voiceEnabled ? 'Mute doctor voice' : 'Unmute doctor voice'}
          >
            {voiceEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>
          <Button
            onClick={endSession}
            size="sm"
            className="bg-red-600 hover:bg-red-700 text-white border-0 gap-1.5"
          >
            <PhoneOff className="w-4 h-4" />
            End
          </Button>
        </div>
      </header>

      {/* ── Main layout ── */}
      <div className="flex-1 grid md:grid-cols-[1fr_1.3fr] gap-0 overflow-hidden">

        {/* ══ LEFT: Camera + controls ══ */}
        <div className="flex flex-col gap-3 p-4 border-r border-border overflow-y-auto">

          {/* Camera feed — Zoom-call style */}
          <div className="relative rounded-2xl overflow-hidden bg-zinc-900 border border-border aspect-video shadow-md">
            {cameraEnabled && !cameraError && !cameraPermissionDenied ? (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
                style={{ transform: 'scaleX(-1)' }}
              />
            ) : cameraPermissionDenied ? (
              <div className="w-full h-full flex flex-col items-center justify-center gap-3 p-4 bg-zinc-900">
                <div className="w-12 h-12 rounded-full bg-amber-500/20 flex items-center justify-center">
                  <Camera className="w-6 h-6 text-amber-400" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-white">Camera access needed</p>
                  <p className="text-xs text-zinc-400 mt-1">Allow camera in your browser settings</p>
                </div>
                <button
                  onClick={requestCameraAccess}
                  className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
                >
                  Allow Camera
                </button>
              </div>
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center text-zinc-500 gap-2 bg-zinc-900">
                <CameraOff className="w-8 h-8" />
                <p className="text-xs text-center px-4">{cameraError ?? 'Camera off'}</p>
              </div>
            )}

            {/* Camera label */}
            <div className="absolute top-2 left-2">
              <span className="text-[10px] font-medium text-white/70 bg-black/40 px-2 py-0.5 rounded-full">You</span>
            </div>

            {/* Camera toggle */}
            {!cameraPermissionDenied && (
              <button
                onClick={() => setCameraEnabled((v) => !v)}
                className="absolute bottom-2 right-2 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
                title={cameraEnabled ? 'Turn camera off' : 'Turn camera on'}
              >
                {cameraEnabled ? <Camera className="w-3.5 h-3.5" /> : <CameraOff className="w-3.5 h-3.5" />}
              </button>
            )}
          </div>

          {/* Camera actions */}
          <div className="flex gap-2">
            <Button
              onClick={captureFrame}
              disabled={analyzing || !cameraEnabled || !!cameraError}
              variant="outline"
              size="sm"
              className="flex-1 gap-1.5 text-xs"
            >
              {analyzing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
              Share Frame
            </Button>
            <Button
              onClick={() => fileInputRef.current?.click()}
              variant="outline"
              size="sm"
              className="flex-1 gap-1.5 text-xs"
            >
              <Upload className="w-3.5 h-3.5" />
              Upload Image
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileUpload}
            />
          </div>

          {/* Upload preview */}
          {uploadPreview && (
            <div className="relative rounded-xl overflow-hidden border border-border">
              <img src={uploadPreview} alt="Upload preview" className="w-full max-h-40 object-cover" />
              <button
                onClick={() => { setUploadPreview(null); setUploadBase64(null); }}
                className="absolute top-2 right-2 p-1 rounded-full bg-background/80 text-foreground hover:bg-muted"
              >
                <X className="w-3 h-3" />
              </button>
              <div className="p-2">
                <Button onClick={analyzeUpload} disabled={analyzing} size="sm" className="w-full gap-1.5 text-xs">
                  {analyzing ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                  Send to Doctor
                </Button>
              </div>
            </div>
          )}

          {/* Symptom context (optional — for camera frame) */}
          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">
              Add context for camera frame (optional)
            </label>
            <textarea
              value={symptomsText}
              onChange={(e) => setSymptomsText(e.target.value)}
              placeholder="E.g. redness for 3 days, doesn't itch…"
              rows={2}
              className="w-full resize-none rounded-lg border border-border bg-background text-xs text-foreground placeholder:text-muted-foreground/50 px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {/* Voice input */}
          <button
            onClick={listening ? stopListening : startListening}
            className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium border transition-all ${
              listening
                ? 'border-red-500 bg-red-500/10 text-red-400 animate-pulse'
                : 'border-border bg-card text-muted-foreground hover:bg-muted'
            }`}
          >
            {listening ? (
              <><Mic className="w-4 h-4 fill-current text-red-400" />Listening… tap to stop</>
            ) : (
              <><Mic className="w-4 h-4" />Tap to Speak</>
            )}
          </button>

          {/* Disclaimer */}
          <div className="flex items-start gap-1.5 text-[10px] text-muted-foreground/60 bg-amber-500/5 rounded-lg p-2 border border-amber-500/15">
            <AlertTriangle className="w-3 h-3 text-amber-500/70 mt-0.5 shrink-0" />
            <span>Informational only. Not a medical diagnosis. Call 911 in emergencies.</span>
          </div>
        </div>

        {/* ══ RIGHT: Doctor chat ══ */}
        <div className="flex flex-col h-[calc(100vh-57px)] overflow-hidden">

          {/* Doctor panel header */}
          <div className="p-4 border-b border-border flex items-center gap-4 bg-gradient-to-r from-emerald-500/5 to-transparent">
            <DoctorAvatar speaking={aiSpeaking} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-semibold text-sm">Dr. Nova</p>
                <span className="text-[10px] bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.5 rounded-full font-medium">AI Health Advisor</span>
              </div>
              {aiSpeaking ? (
                <div className="mt-1">
                  <WaveformBars active={aiSpeaking} />
                </div>
              ) : (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {analyzing ? 'Thinking…' : 'Ready'}
                </p>
              )}
            </div>
          </div>

          {/* Chat transcript */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.role === 'ai' && (
                  <div className="w-7 h-7 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mr-2 mt-0.5 shrink-0">
                    <span className="text-xs">🩺</span>
                  </div>
                )}
                <div className={`max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed shadow-sm ${
                  msg.role === 'ai'
                    ? 'bg-card border border-border text-foreground rounded-tl-sm'
                    : 'bg-primary text-primary-foreground rounded-tr-sm'
                }`}>
                  <p>{msg.text}</p>
                  <p className="text-[10px] opacity-40 mt-1.5">
                    {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            ))}

            {/* Typing indicator */}
            {analyzing && (
              <div className="flex justify-start items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
                  <span className="text-xs">🩺</span>
                </div>
                <div className="bg-card border border-border px-4 py-3 rounded-2xl rounded-tl-sm flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: '150ms' }} />
                  <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            )}
            <div ref={chatBottomRef} />
          </div>

          {/* Input bar */}
          <div className="p-3 border-t border-border bg-background/95">
            <div className="flex items-end gap-2">
              <textarea
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendTextMessage(textInput);
                  }
                }}
                onFocus={unlockAudio}
                placeholder="Describe your symptoms or ask a question…"
                rows={1}
                className="flex-1 resize-none rounded-xl border border-border bg-card text-sm text-foreground placeholder:text-muted-foreground/50 px-3 py-2.5 focus:outline-none focus:ring-1 focus:ring-primary max-h-32 overflow-y-auto"
                style={{ minHeight: '40px' }}
              />
              <Button
                onClick={() => sendTextMessage(textInput)}
                disabled={!textInput.trim() || analyzing}
                size="sm"
                className="h-10 w-10 p-0 rounded-xl shrink-0"
              >
                {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground/40 mt-1.5 px-1">
              Enter to send · Shift+Enter for new line · Or tap the mic
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Export ───────────────────────────────────────────────────────────────────

export default function ConsultationPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <Loader2 className="w-8 h-8 animate-spin" />
            <p className="text-sm">Starting consultation…</p>
          </div>
        </div>
      }
    >
      <ConsultationInner />
    </Suspense>
  );
}
