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
  Wifi,
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

// Browser speech recognition type shim
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

// ─── AI waveform animation (CSS-only) ─────────────────────────────────────────

function WaveformBars({ active }: { active: boolean }) {
  return (
    <div className="flex items-center justify-center gap-0.5 h-6">
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className={`w-1 rounded-full transition-all duration-300 ${
            active ? 'bg-primary' : 'bg-zinc-600'
          }`}
          style={{
            height: active ? `${12 + Math.sin(i * 1.2) * 8}px` : '4px',
            animation: active
              ? `pulse-bar ${0.6 + i * 0.1}s ease-in-out infinite alternate`
              : 'none',
          }}
        />
      ))}
      <style>{`
        @keyframes pulse-bar {
          from { transform: scaleY(0.4); }
          to   { transform: scaleY(1.6); }
        }
      `}</style>
    </div>
  );
}

// ─── AI Avatar ────────────────────────────────────────────────────────────────

function AiAvatar({ speaking }: { speaking: boolean }) {
  return (
    <div className="relative flex items-center justify-center">
      {/* Outer pulse ring */}
      <div
        className={`absolute inset-0 rounded-full transition-all duration-500 ${
          speaking ? 'scale-110 opacity-30 bg-primary' : 'scale-100 opacity-0'
        }`}
        style={{ transitionTimingFunction: 'ease-out' }}
      />
      {/* Middle ring */}
      <div
        className={`absolute inset-1 rounded-full transition-all duration-700 ${
          speaking ? 'scale-105 opacity-20 bg-primary' : 'scale-100 opacity-0'
        }`}
      />
      {/* Avatar circle */}
      <div
        className={`relative w-20 h-20 rounded-full flex items-center justify-center border-2 transition-all duration-300 ${
          speaking
            ? 'border-primary bg-primary/20'
            : 'border-zinc-700 bg-zinc-800'
        }`}
      >
        <div className="text-3xl select-none">🩺</div>
      </div>
    </div>
  );
}

// ─── Consultation inner (needs useSearchParams) ────────────────────────────────

function ConsultationInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [consultId, setConsultId] = useState<string | null>(
    searchParams.get('id')
  );
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'ai',
      text: "Hello! I'm your AI health advisor. Please note: I provide general health information only and am not a licensed physician. Show me what you'd like to discuss, and describe your symptoms below. How can I help you today?",
      timestamp: new Date(),
    },
  ]);
  const [symptomsText, setSymptomsText] = useState('');
  const [textInput, setTextInput] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [aiSpeaking, setAiSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [sessionEnded, setSessionEnded] = useState(false);
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const [uploadBase64, setUploadBase64] = useState<string | null>(null);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [connecting, setConnecting] = useState(true);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Init consultation ────────────────────────────────────────────────────

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
          // proceed without id
        }
      }
      setConnecting(false);
    };
    init();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Camera setup ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (!cameraEnabled || sessionEnded) return;

    navigator.mediaDevices
      .getUserMedia({ video: true, audio: false })
      .then((stream) => {
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      })
      .catch(() => {
        setCameraError('Camera access denied. You can still use text and image upload.');
        setCameraEnabled(false);
      });

    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [cameraEnabled, sessionEnded]);

  // ── Auto-scroll chat ──────────────────────────────────────────────────────

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── End session on unmount ────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      if (consultId) {
        // Best-effort: PATCH to mark completed
        fetch(`/api/health/consult/${consultId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'completed', ended_at: new Date().toISOString() }),
          keepalive: true,
        }).catch(() => {});
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      recognitionRef.current?.stop();
    };
  }, [consultId]);

  // ── Helpers ───────────────────────────────────────────────────────────────

  const addMessage = useCallback((role: 'ai' | 'user', text: string) => {
    setMessages((prev) => [...prev, { role, text, timestamp: new Date() }]);
  }, []);

  const playVoiceResponse = useCallback(
    async (text: string) => {
      if (!voiceEnabled || !consultId) return;
      try {
        const res = await fetch(`/api/health/consult/${consultId}/voice`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });
        if (res.ok) {
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          setAiSpeaking(true);
          audio.onended = () => {
            setAiSpeaking(false);
            URL.revokeObjectURL(url);
          };
          await audio.play();
        }
      } catch {
        setAiSpeaking(false);
      }
    },
    [consultId, voiceEnabled]
  );

  // ── Capture frame from camera ─────────────────────────────────────────────

  const captureFrame = useCallback(async () => {
    if (!videoRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth || 640;
    canvas.height = videoRef.current.videoHeight || 480;
    canvas.getContext('2d')!.drawImage(videoRef.current, 0, 0);
    const imageBase64 = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];

    setAnalyzing(true);
    addMessage('user', symptomsText || '[Shared camera frame]');

    try {
      const endpoint = consultId
        ? `/api/health/consult/${consultId}/analyze`
        : '/api/health/analyze';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64, symptoms: symptomsText }),
      });
      const data = await res.json();
      const reply = data.response || data.observations?.join('. ') || "I've analyzed the image. Please describe any symptoms you're experiencing.";
      addMessage('ai', reply);
      await playVoiceResponse(reply);
    } catch {
      const fallback = "I couldn't analyze the image right now. Could you describe what you're seeing?";
      addMessage('ai', fallback);
      await playVoiceResponse(fallback);
    } finally {
      setAnalyzing(false);
      setSymptomsText('');
    }
  }, [consultId, symptomsText, addMessage, playVoiceResponse]);

  // ── Upload image ──────────────────────────────────────────────────────────

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
    if (!uploadBase64) return;
    setAnalyzing(true);
    addMessage('user', symptomsText || '[Uploaded image]');
    try {
      const endpoint = consultId
        ? `/api/health/consult/${consultId}/analyze`
        : '/api/health/analyze';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: uploadBase64, symptoms: symptomsText }),
      });
      const data = await res.json();
      const reply = data.response || data.observations?.join('. ') || "I've reviewed the image. Can you describe any additional symptoms?";
      addMessage('ai', reply);
      await playVoiceResponse(reply);
    } catch {
      const fallback = "Image analysis failed. Please describe your symptoms in text.";
      addMessage('ai', fallback);
    } finally {
      setAnalyzing(false);
      setUploadPreview(null);
      setUploadBase64(null);
      setSymptomsText('');
    }
  }, [consultId, uploadBase64, symptomsText, addMessage, playVoiceResponse]);

  // ── Send text message ─────────────────────────────────────────────────────

  const sendTextMessage = useCallback(
    async (text: string) => {
      if (!text.trim()) return;
      addMessage('user', text);
      setTextInput('');
      setAnalyzing(true);
      try {
        const endpoint = consultId
          ? `/api/health/consult/${consultId}/analyze`
          : '/api/health/analyze';
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symptoms: text }),
        });
        const data = await res.json();
        const reply = data.response || "I understand. Can you tell me more about when these symptoms started?";
        addMessage('ai', reply);
        await playVoiceResponse(reply);
      } catch {
        const fallback = "I'm having trouble connecting. Please try again.";
        addMessage('ai', fallback);
      } finally {
        setAnalyzing(false);
      }
    },
    [consultId, addMessage, playVoiceResponse]
  );

  // ── Voice recognition ─────────────────────────────────────────────────────

  const startListening = useCallback(() => {
    if (typeof window === 'undefined') return;
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
      const text = e.results[0][0].transcript;
      setListening(false);
      sendTextMessage(text);
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    rec.start();
    recognitionRef.current = rec;
    setListening(true);
  }, [sendTextMessage]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setListening(false);
  }, []);

  // ── End session ───────────────────────────────────────────────────────────

  const endSession = useCallback(async () => {
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

  // ── Session ended screen ──────────────────────────────────────────────────

  if (sessionEnded) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center space-y-6">
          <div className="w-16 h-16 rounded-full bg-zinc-800 flex items-center justify-center mx-auto">
            <PhoneOff className="w-7 h-7 text-zinc-400" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-white">Session Ended</h2>
            <p className="text-zinc-400 mt-2 text-sm leading-relaxed">
              Always consult a qualified healthcare provider for proper diagnosis and treatment.
            </p>
            <p className="text-red-400 mt-3 text-sm font-medium">
              If this is a medical emergency, call 911 immediately.
            </p>
          </div>
          <Button
            onClick={() => router.push('/dashboard/health')}
            variant="outline"
            className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
          >
            Back to Health Dashboard
          </Button>
        </div>
      </div>
    );
  }

  // ── Main consultation UI ──────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col">

      {/* ── Top header ── */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold tracking-tight">AI Health Consultation</h1>
          {connecting ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500">
              <Loader2 className="w-3 h-3 animate-spin" />
              Connecting…
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-400">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
              LIVE
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setVoiceEnabled((v) => !v)}
            className={`p-2 rounded-lg transition-colors ${
              voiceEnabled ? 'text-zinc-300 hover:bg-zinc-800' : 'text-zinc-600 hover:bg-zinc-800'
            }`}
            title={voiceEnabled ? 'Mute AI voice' : 'Enable AI voice'}
          >
            {voiceEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>
          <Button
            onClick={endSession}
            size="sm"
            className="bg-red-600 hover:bg-red-700 text-white border-0 gap-1.5"
          >
            <PhoneOff className="w-4 h-4" />
            End Session
          </Button>
        </div>
      </header>

      {/* ── Main two-column layout ── */}
      <div className="flex-1 grid md:grid-cols-[1fr_1.2fr] gap-0 overflow-hidden">

        {/* ══ LEFT COLUMN: Camera + controls ══ */}
        <div className="flex flex-col gap-4 p-4 border-r border-zinc-800 overflow-y-auto">

          {/* Camera feed */}
          <div className="relative rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800 aspect-video">
            {cameraEnabled && !cameraError ? (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
                style={{ transform: 'scaleX(-1)' }} /* mirror mode */
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center text-zinc-500 gap-2">
                <CameraOff className="w-8 h-8" />
                <p className="text-xs text-center px-4">
                  {cameraError ?? 'Camera off'}
                </p>
              </div>
            )}

            {/* Camera toggle overlay */}
            <button
              onClick={() => setCameraEnabled((v) => !v)}
              className="absolute bottom-2 right-2 p-2 rounded-lg bg-zinc-900/80 backdrop-blur text-zinc-300 hover:bg-zinc-700 transition-colors"
              title={cameraEnabled ? 'Turn camera off' : 'Turn camera on'}
            >
              {cameraEnabled ? <Camera className="w-4 h-4" /> : <CameraOff className="w-4 h-4" />}
            </button>
          </div>

          {/* Camera action buttons */}
          <div className="flex gap-2">
            <Button
              onClick={captureFrame}
              disabled={analyzing || !cameraEnabled || !!cameraError}
              variant="outline"
              size="sm"
              className="flex-1 border-zinc-700 text-zinc-300 hover:bg-zinc-800 gap-1.5"
            >
              {analyzing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Camera className="w-4 h-4" />
              )}
              Share Frame
            </Button>

            <Button
              onClick={() => fileInputRef.current?.click()}
              variant="outline"
              size="sm"
              className="flex-1 border-zinc-700 text-zinc-300 hover:bg-zinc-800 gap-1.5"
            >
              <Upload className="w-4 h-4" />
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
            <div className="relative rounded-lg overflow-hidden border border-zinc-700">
              <img
                src={uploadPreview}
                alt="Upload preview"
                className="w-full max-h-40 object-cover"
              />
              <button
                onClick={() => {
                  setUploadPreview(null);
                  setUploadBase64(null);
                }}
                className="absolute top-2 right-2 p-1 rounded-full bg-zinc-900/80 text-zinc-300 hover:bg-zinc-700"
              >
                <X className="w-3 h-3" />
              </button>
              <div className="p-2">
                <Button
                  onClick={analyzeUpload}
                  disabled={analyzing}
                  size="sm"
                  className="w-full gap-1.5"
                >
                  {analyzing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  Analyze Uploaded Image
                </Button>
              </div>
            </div>
          )}

          {/* Symptoms text input */}
          <div className="space-y-1.5">
            <label className="text-xs text-zinc-500 font-medium uppercase tracking-wider">
              Describe your symptoms
            </label>
            <textarea
              value={symptomsText}
              onChange={(e) => setSymptomsText(e.target.value)}
              placeholder="What are you showing or experiencing? Be as specific as possible…"
              rows={3}
              className="w-full resize-none rounded-lg border border-zinc-700 bg-zinc-900 text-sm text-zinc-100 placeholder-zinc-600 px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {/* Mic speaking button */}
          <button
            onClick={listening ? stopListening : startListening}
            className={`flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium border transition-all ${
              listening
                ? 'border-red-500 bg-red-950/40 text-red-400 animate-pulse'
                : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:bg-zinc-800'
            }`}
          >
            {listening ? (
              <>
                <Mic className="w-4 h-4 fill-current text-red-400" />
                Speaking… (click to stop)
              </>
            ) : (
              <>
                <MicOff className="w-4 h-4" />
                Hold to Speak
              </>
            )}
          </button>

          {/* Connectivity indicator */}
          <div className="flex items-center gap-1.5 text-xs text-zinc-600">
            <Wifi className="w-3.5 h-3.5" />
            <span>Encrypted session &middot; {consultId ? `ID ${consultId.slice(0, 8)}…` : 'No session ID'}</span>
          </div>
        </div>

        {/* ══ RIGHT COLUMN: AI assistant ══ */}
        <div className="flex flex-col h-[calc(100vh-57px)] overflow-hidden">

          {/* AI avatar header */}
          <div className="p-5 border-b border-zinc-800 flex items-center gap-4">
            <AiAvatar speaking={aiSpeaking} />
            <div>
              <p className="font-semibold text-sm">AI Health Advisor</p>
              <p className="text-xs text-zinc-500 leading-snug mt-0.5">
                <AlertTriangle className="w-3 h-3 inline mr-0.5 text-amber-500" />
                Not a licensed physician. For informational purposes only.
              </p>
              {aiSpeaking && (
                <div className="mt-1.5">
                  <WaveformBars active={aiSpeaking} />
                </div>
              )}
            </div>
          </div>

          {/* Chat transcript */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                    msg.role === 'ai'
                      ? 'bg-zinc-800 text-zinc-100 rounded-tl-sm'
                      : 'bg-primary text-primary-foreground rounded-tr-sm'
                  }`}
                >
                  <p>{msg.text}</p>
                  <p className="text-[10px] opacity-50 mt-1">
                    {msg.timestamp.toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </div>
              </div>
            ))}

            {/* Typing indicator */}
            {analyzing && (
              <div className="flex justify-start">
                <div className="bg-zinc-800 px-4 py-3 rounded-2xl rounded-tl-sm flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <div className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            )}

            <div ref={chatBottomRef} />
          </div>

          {/* Text input bar */}
          <div className="p-3 border-t border-zinc-800 bg-zinc-950">
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
                placeholder="Type a message or ask a question…"
                rows={1}
                className="flex-1 resize-none rounded-xl border border-zinc-700 bg-zinc-900 text-sm text-zinc-100 placeholder-zinc-600 px-3 py-2.5 focus:outline-none focus:ring-1 focus:ring-primary max-h-32 overflow-y-auto"
                style={{ minHeight: '40px' }}
              />
              <Button
                onClick={() => sendTextMessage(textInput)}
                disabled={!textInput.trim() || analyzing}
                size="sm"
                className="h-10 w-10 p-0 rounded-xl shrink-0"
              >
                {analyzing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </Button>
            </div>
            <p className="text-[10px] text-zinc-700 mt-1.5 px-1">
              Press Enter to send &middot; Shift+Enter for new line
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Export: wraps ConsultationInner in Suspense (required for useSearchParams) ──

export default function ConsultationPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-zinc-400">
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
