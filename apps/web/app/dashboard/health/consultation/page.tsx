'use client';

import {
  useState, useRef, useEffect, useCallback, Suspense,
} from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Mic, MicOff, Camera, CameraOff, PhoneOff, Loader2, Volume2, VolumeX, MessageSquare, X, ChevronDown, Upload } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Message { role: 'ai' | 'user'; text: string; timestamp: Date; }

type MicState = 'idle' | 'requesting' | 'recording' | 'processing' | 'error';

// ─── Speaking waveform ────────────────────────────────────────────────────────

function SpeakingRings({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <>
      <div className="absolute inset-[-8px] rounded-full border-2 border-emerald-400/60 animate-ping" style={{ animationDuration: '1.4s' }} />
      <div className="absolute inset-[-16px] rounded-full border border-emerald-400/30 animate-ping" style={{ animationDuration: '1.8s', animationDelay: '0.3s' }} />
    </>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

function ConsultationInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // ── State ──────────────────────────────────────────────────────────────────

  const [consultId, setConsultId] = useState<string | null>(searchParams.get('id'));
  const [connecting, setConnecting] = useState(true);
  const [sessionEnded, setSessionEnded] = useState(false);

  const [messages, setMessages] = useState<Message[]>([{
    role: 'ai',
    text: "Hey, good to see you. I'm Dr. Nova — what's going on today? Tell me what's been bothering you, and feel free to show me anything on camera.",
    timestamp: new Date(),
  }]);

  const [aiSpeaking, setAiSpeaking] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [showChat, setShowChat] = useState(false);
  const [textInput, setTextInput] = useState('');
  const [analyzing, setAnalyzing] = useState(false);

  // Camera
  const [cameraOn, setCameraOn] = useState(true);
  const [cameraPermissionDenied, setCameraPermissionDenied] = useState(false);

  // Microphone / recording
  const [micState, setMicState] = useState<MicState>('idle');
  const [micError, setMicError] = useState('');
  const [micSupported, setMicSupported] = useState(true);
  const [micPermissionDenied, setMicPermissionDenied] = useState(false);

  // Audio unlock (browser autoplay policy)
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const greetingPlayedRef = useRef(false);

  // ── Refs ───────────────────────────────────────────────────────────────────

  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // ── Init consultation ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!consultId) {
      fetch('/api/health/consult', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acknowledged_disclaimer: true }),
      }).then(r => r.ok ? r.json() : null).then(data => {
        if (data?.id) setConsultId(data.id);
      }).catch(() => {}).finally(() => setConnecting(false));
    } else {
      setConnecting(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Check MediaRecorder support ────────────────────────────────────────────

  useEffect(() => {
    if (typeof window !== 'undefined' && !window.MediaRecorder) {
      setMicSupported(false);
    }
  }, []);

  // ── Camera ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!cameraOn || sessionEnded) return;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 } }, audio: false })
      .then(stream => {
        cameraStreamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setCameraPermissionDenied(false);
      })
      .catch(err => {
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') setCameraPermissionDenied(true);
        setCameraOn(false);
      });
    return () => { cameraStreamRef.current?.getTracks().forEach(t => t.stop()); };
  }, [cameraOn, sessionEnded]);

  // ── Auto-scroll chat ───────────────────────────────────────────────────────

  useEffect(() => {
    if (showChat) chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, showChat]);

  // ── Cleanup on unmount ─────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      cameraStreamRef.current?.getTracks().forEach(t => t.stop());
      currentAudioRef.current?.pause();
      mediaRecorderRef.current?.stop();
      if (consultId) {
        fetch(`/api/health/consult/${consultId}`, {
          method: 'PATCH', keepalive: true,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'completed', ended_at: new Date().toISOString() }),
        }).catch(() => {});
      }
    };
  }, [consultId]);

  // ── Helpers ────────────────────────────────────────────────────────────────

  const addMessage = useCallback((role: 'ai' | 'user', text: string) => {
    setMessages(prev => [...prev, { role, text, timestamp: new Date() }]);
  }, []);

  const unlockAudio = useCallback(() => {
    if (audioUnlocked) return;
    try { const ctx = new AudioContext(); ctx.resume().then(() => ctx.close()); } catch { /* ignore */ }
    setAudioUnlocked(true);
  }, [audioUnlocked]);

  // ── Capture latest camera frame as base64 ─────────────────────────────────

  const captureFrame = useCallback((): string | null => {
    if (!videoRef.current || !cameraOn) return null;
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth || 640;
    canvas.height = videoRef.current.videoHeight || 480;
    canvas.getContext('2d')?.drawImage(videoRef.current, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.7).split(',')[1] || null;
  }, [cameraOn]);

  // ── Permission reprompt helpers ────────────────────────────────────────────

  // Tries to reprompt camera access. If blocked, shows OS/browser settings hint.
  const repromptCamera = useCallback(async () => {
    setCameraPermissionDenied(false);
    setCameraOn(false);
    // Small delay so the track-stop effect runs first, then we re-request
    await new Promise(r => setTimeout(r, 100));
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      stream.getTracks().forEach(t => t.stop()); // stop immediately — the cameraOn effect will re-request
      setCameraOn(true);
    } catch (err) {
      const e = err as Error;
      setCameraPermissionDenied(true);
      if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
        // Likely permanently blocked — need browser settings
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
        const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
        if (isIOS || isSafari) {
          alert('Camera is blocked. Go to Settings → Safari (or this app) → Camera → Allow.');
        } else {
          // Chrome/Firefox: click the lock icon in the address bar → Site permissions → Camera → Allow
          alert('Camera is blocked. Click the 🔒 lock icon in your address bar → Site settings → Camera → Allow, then refresh the page.');
        }
      }
    }
  }, []);

  // Tries to reprompt microphone access. If blocked, shows OS/browser settings hint.
  const repromptMic = useCallback(async () => {
    setMicPermissionDenied(false);
    setMicError('');
    setMicState('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
      setMicState('idle');
    } catch (err) {
      const e = err as Error;
      setMicState('idle');
      if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
        setMicPermissionDenied(true);
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
        const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
        if (isIOS || isSafari) {
          alert('Microphone is blocked. Go to Settings → Safari (or this app) → Microphone → Allow.');
        } else {
          alert('Microphone is blocked. Click the 🔒 lock icon in your address bar → Site settings → Microphone → Allow, then refresh the page.');
        }
      }
    }
  }, []);

  // ── Stream audio from ElevenLabs via MediaSource ───────────────────────────

  const playStreamingAudio = useCallback(async (consultationId: string, text: string) => {
    if (!voiceEnabled) return;

    // Stop any current audio
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }

    try {
      const res = await fetch(`/api/health/consult/${consultationId}/voice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });

      if (!res.ok || !res.body) return;

      const audio = new Audio();
      currentAudioRef.current = audio;
      setAiSpeaking(true);

      const cleanup = () => {
        setAiSpeaking(false);
        currentAudioRef.current = null;
      };

      // Try MediaSource streaming (Chrome, Firefox, Edge)
      if (
        typeof MediaSource !== 'undefined' &&
        MediaSource.isTypeSupported('audio/mpeg')
      ) {
        const ms = new MediaSource();
        audio.src = URL.createObjectURL(ms);

        ms.addEventListener('sourceopen', async () => {
          const sb = ms.addSourceBuffer('audio/mpeg');
          const reader = res.body!.getReader();

          const pump = async () => {
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) { ms.endOfStream(); break; }
                // Wait for sourceBuffer to be ready
                if (sb.updating) await new Promise<void>(r => { sb.addEventListener('updateend', () => r(), { once: true }); });
                sb.appendBuffer(value);
                await new Promise<void>(r => { sb.addEventListener('updateend', () => r(), { once: true }); });
              }
            } catch { ms.endOfStream(); }
          };

          pump();
          audio.play().catch(() => { cleanup(); });
        }, { once: true });

        audio.onended = () => { cleanup(); URL.revokeObjectURL(audio.src); };
        audio.onerror = () => { cleanup(); URL.revokeObjectURL(audio.src); };
      } else {
        // Fallback: buffer full response then play (Safari)
        const buffer = await res.arrayBuffer();
        const blob = new Blob([buffer], { type: 'audio/mpeg' });
        const url = URL.createObjectURL(blob);
        audio.src = url;
        audio.onended = () => { cleanup(); URL.revokeObjectURL(url); };
        audio.onerror = () => { cleanup(); URL.revokeObjectURL(url); };
        await audio.play().catch(() => { cleanup(); });
      }
    } catch {
      setAiSpeaking(false);
    }
  }, [voiceEnabled]);

  // ── Send message to Dr. Nova ───────────────────────────────────────────────

  const sendMessage = useCallback(async (text: string, imageBase64?: string | null) => {
    if (!text.trim() || analyzing) return;
    addMessage('user', text);
    setTextInput('');
    setAnalyzing(true);

    try {
      const endpoint = consultId ? `/api/health/consult/${consultId}/analyze` : '/api/health/analyze';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          imageBase64: imageBase64 || undefined,
          conversationHistory: messages.slice(-8).map(m => ({ role: m.role, text: m.text })),
        }),
      });

      const data = await res.json();
      const reply = data.response || "Can you tell me more?";
      addMessage('ai', reply);
      if (consultId) await playStreamingAudio(consultId, reply);
    } catch {
      const fallback = "I'm having a connection issue. Try again in a moment.";
      addMessage('ai', fallback);
      if (consultId) await playStreamingAudio(consultId, fallback);
    } finally {
      setAnalyzing(false);
    }
  }, [consultId, analyzing, messages, addMessage, playStreamingAudio]);

  // ── Play greeting once on first interaction ───────────────────────────────

  useEffect(() => {
    if (consultId && audioUnlocked && !greetingPlayedRef.current && !connecting) {
      greetingPlayedRef.current = true;
      playStreamingAudio(consultId, messages[0].text);
    }
  }, [consultId, audioUnlocked, connecting]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── MediaRecorder push-to-talk ─────────────────────────────────────────────

  const getSupportedMimeType = () => {
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
    for (const t of types) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) return t;
    }
    return '';
  };

  const startRecording = useCallback(async () => {
    if (!micSupported) {
      setMicError('Recording not supported in this browser. Type your message instead.');
      return;
    }
    unlockAudio();
    setMicError('');
    setMicState('requesting');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 } });
      const mimeType = getSupportedMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});

      audioChunksRef.current = [];
      recorder.ondataavailable = e => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());

        if (audioChunksRef.current.length === 0) {
          setMicState('idle');
          return;
        }

        setMicState('processing');
        const blob = new Blob(audioChunksRef.current, { type: mimeType || 'audio/webm' });
        audioChunksRef.current = [];

        // Get camera frame for visual context
        const frame = captureFrame();

        try {
          // Transcribe with Groq Whisper
          const form = new FormData();
          const ext = mimeType?.includes('mp4') ? 'mp4' : mimeType?.includes('ogg') ? 'ogg' : 'webm';
          form.append('audio', blob, `recording.${ext}`);

          const endpoint = consultId ? `/api/health/consult/${consultId}/transcribe` : null;
          if (!endpoint) { setMicState('idle'); return; }

          const txRes = await fetch(endpoint, { method: 'POST', body: form });
          if (!txRes.ok) {
            const err = await txRes.json().catch(() => ({ error: 'unknown' }));
            if (err.error === 'No speech detected') {
              setMicError('No speech detected — try again.');
            } else {
              setMicError('Transcription failed. Try typing instead.');
            }
            setMicState('error');
            setTimeout(() => setMicState('idle'), 2500);
            return;
          }

          const { text } = await txRes.json() as { text: string };
          setMicState('idle');
          await sendMessage(text, frame);
        } catch {
          setMicError('Something went wrong. Try typing instead.');
          setMicState('error');
          setTimeout(() => setMicState('idle'), 2500);
        }
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setMicState('recording');
    } catch (err) {
      const e = err as Error;
      if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
        setMicPermissionDenied(true);
        setMicError('');
      } else {
        setMicError('Could not access microphone. Try typing instead.');
        setMicState('error');
        setTimeout(() => setMicState('idle'), 3000);
      }
    }
  }, [micSupported, captureFrame, consultId, sendMessage, unlockAudio]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  }, []);

  // ── End session ────────────────────────────────────────────────────────────

  const endSession = useCallback(async () => {
    currentAudioRef.current?.pause();
    cameraStreamRef.current?.getTracks().forEach(t => t.stop());
    mediaRecorderRef.current?.stop();
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
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-6">
        <div className="text-center space-y-5 max-w-sm">
          <div className="w-14 h-14 rounded-full bg-zinc-800 flex items-center justify-center mx-auto">
            <PhoneOff className="w-6 h-6 text-zinc-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">Session ended</h2>
            <p className="text-zinc-400 text-sm mt-1.5 leading-relaxed">
              Follow up with a licensed healthcare provider for any diagnosis or treatment decisions.
            </p>
            <p className="text-red-400 text-sm mt-2 font-medium">In a medical emergency, call 911.</p>
          </div>
          <button onClick={() => router.push('/dashboard/health')} className="px-5 py-2.5 rounded-xl border border-zinc-700 text-zinc-300 text-sm hover:bg-zinc-800 transition-colors">
            Back to Health
          </button>
        </div>
      </div>
    );
  }

  // ── Mic button helpers ──────────────────────────────────────────────────────

  const isRecording = micState === 'recording';
  const isProcessing = micState === 'requesting' || micState === 'processing' || analyzing;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 bg-zinc-950 flex flex-col select-none"
      style={{ zIndex: 1 }}
      onClick={unlockAudio}
    >
      {/* ══ VIDEO BACKGROUND ══ */}
      <div className="absolute inset-0">
        {cameraOn && !cameraPermissionDenied ? (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
            style={{ transform: 'scaleX(-1)' }}
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-4 bg-zinc-900">
            <CameraOff className="w-10 h-10 text-zinc-600" />
            {cameraPermissionDenied ? (
              <div className="text-center px-6">
                <p className="text-white text-sm font-medium">Camera access needed</p>
                <p className="text-zinc-400 text-xs mt-1 leading-relaxed">
                  Click Allow below. If still blocked, tap the 🔒 lock in your address bar → Camera → Allow.
                </p>
                <button
                  onClick={e => { e.stopPropagation(); repromptCamera(); }}
                  className="mt-3 px-5 py-2.5 rounded-xl bg-white text-zinc-900 text-sm font-semibold hover:bg-zinc-100 transition-colors active:scale-95"
                >
                  Allow Camera
                </button>
              </div>
            ) : (
              <p className="text-zinc-500 text-sm">Camera off</p>
            )}
          </div>
        )}
      </div>

      {/* ── dark gradient at top (header) ── */}
      <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/70 to-transparent pointer-events-none" />

      {/* ── dark gradient at bottom (controls) ── */}
      <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-black/80 to-transparent pointer-events-none" />

      {/* ══ HEADER ══ */}
      <div className="relative z-10 flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          {connecting ? (
            <span className="text-xs text-zinc-400 flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin" /> Connecting…
            </span>
          ) : (
            <span className="text-xs text-emerald-400 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
              LIVE
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Voice toggle */}
          <button
            onClick={e => {
              e.stopPropagation();
              unlockAudio();
              if (voiceEnabled && currentAudioRef.current) { currentAudioRef.current.pause(); setAiSpeaking(false); }
              setVoiceEnabled(v => !v);
            }}
            className="w-8 h-8 rounded-full bg-black/40 flex items-center justify-center text-white hover:bg-black/60 transition-colors"
          >
            {voiceEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>
          {/* Chat toggle */}
          <button
            onClick={e => { e.stopPropagation(); setShowChat(v => !v); }}
            className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${showChat ? 'bg-white text-zinc-900' : 'bg-black/40 text-white hover:bg-black/60'}`}
          >
            <MessageSquare className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ══ DR. NOVA PICTURE-IN-PICTURE ══ */}
      <div className="absolute top-14 right-4 z-10">
        <div className="relative w-28 h-28 sm:w-36 sm:h-36">
          {/* Outer speaking rings */}
          <div className="relative w-full h-full flex items-center justify-center">
            <SpeakingRings active={aiSpeaking} />
            {/* Avatar circle */}
            <div className={`relative w-24 h-24 sm:w-32 sm:h-32 rounded-full flex flex-col items-center justify-center border-2 transition-all duration-300 shadow-2xl backdrop-blur-sm ${
              aiSpeaking
                ? 'border-emerald-400 bg-zinc-900/90'
                : 'border-white/20 bg-zinc-900/80'
            }`}>
              <span className="text-4xl sm:text-5xl">🩺</span>
              <span className={`text-[10px] font-semibold mt-1 ${aiSpeaking ? 'text-emerald-400' : 'text-zinc-400'}`}>
                {isProcessing ? 'thinking…' : aiSpeaking ? 'speaking' : 'Dr. Nova'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ══ BOTTOM CONTROLS ══ */}
      <div className="absolute bottom-0 inset-x-0 z-10 flex flex-col items-center gap-3 pb-safe pb-8 px-6">
        {/* Error / status message */}
        {micError && (
          <div className="bg-black/70 text-amber-400 text-xs px-4 py-2 rounded-full backdrop-blur-sm max-w-xs text-center">
            {micError}
          </div>
        )}

        {/* Processing indicator */}
        {isProcessing && !isRecording && (
          <div className="flex items-center gap-2 bg-black/60 text-white text-xs px-4 py-2 rounded-full backdrop-blur-sm">
            <Loader2 className="w-3 h-3 animate-spin" />
            {micState === 'requesting' ? 'Starting microphone…' : micState === 'processing' ? 'Transcribing…' : 'Dr. Nova is thinking…'}
          </div>
        )}

        {/* Disclaimer */}
        <div className="text-[10px] text-white/40 text-center">
          Informational only — not a diagnosis. Call 911 in emergencies.
        </div>

        {/* Main controls row */}
        <div className="flex items-center justify-center gap-6">
          {/* Camera toggle */}
          <button
            onClick={e => { e.stopPropagation(); setCameraOn(v => !v); }}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${
              cameraOn ? 'bg-white/15 text-white hover:bg-white/25' : 'bg-white/10 text-zinc-400 hover:bg-white/15'
            } backdrop-blur-sm`}
          >
            {cameraOn ? <Camera className="w-5 h-5" /> : <CameraOff className="w-5 h-5" />}
          </button>

          {/* Push-to-talk mic — HOLD TO SPEAK */}
          <div className="flex flex-col items-center gap-1">
            {micPermissionDenied ? (
              /* Mic permanently blocked — show reprompt button */
              <>
                <button
                  onClick={e => { e.preventDefault(); e.stopPropagation(); repromptMic(); }}
                  className="w-20 h-20 rounded-full flex flex-col items-center justify-center gap-1 bg-amber-500/20 border-2 border-amber-400/60 shadow-xl transition-all active:scale-95"
                >
                  <MicOff className="w-6 h-6 text-amber-400" />
                  <span className="text-[9px] text-amber-400 font-medium leading-tight text-center px-1">Tap to allow</span>
                </button>
                <span className="text-[10px] text-amber-400/80">Mic blocked</span>
              </>
            ) : (
              <>
                <button
                  onPointerDown={e => { e.preventDefault(); e.stopPropagation(); if (!isProcessing && !isRecording) startRecording(); }}
                  onPointerUp={e => { e.preventDefault(); e.stopPropagation(); if (isRecording) stopRecording(); }}
                  onPointerLeave={e => { e.preventDefault(); if (isRecording) stopRecording(); }}
                  onPointerCancel={e => { e.preventDefault(); if (isRecording) stopRecording(); }}
                  disabled={isProcessing || !micSupported}
                  className={`w-20 h-20 rounded-full flex items-center justify-center shadow-2xl transition-all active:scale-95 ${
                    isRecording
                      ? 'bg-red-500 shadow-red-500/40 scale-110 ring-4 ring-red-400/50'
                      : isProcessing
                      ? 'bg-zinc-700 cursor-not-allowed'
                      : micState === 'error'
                      ? 'bg-amber-500/20 border-2 border-amber-500/50 cursor-pointer'
                      : 'bg-white hover:bg-zinc-100 cursor-pointer'
                  }`}
                >
                  {isProcessing ? (
                    <Loader2 className="w-8 h-8 text-zinc-400 animate-spin" />
                  ) : isRecording ? (
                    <Mic className="w-8 h-8 text-white animate-pulse" />
                  ) : !micSupported ? (
                    <MicOff className="w-8 h-8 text-zinc-400" />
                  ) : (
                    <Mic className={`w-8 h-8 ${micState === 'error' ? 'text-amber-400' : 'text-zinc-900'}`} />
                  )}
                </button>
                <span className="text-[10px] text-white/50">
                  {isRecording ? 'Release to send' : isProcessing ? '…' : !micSupported ? 'Not supported' : 'Hold to speak'}
                </span>
              </>
            )}
          </div>

          {/* End call */}
          <button
            onClick={e => { e.stopPropagation(); endSession(); }}
            className="w-12 h-12 rounded-full bg-red-600 hover:bg-red-700 flex items-center justify-center transition-colors backdrop-blur-sm"
          >
            <PhoneOff className="w-5 h-5 text-white" />
          </button>
        </div>
      </div>

      {/* ══ CHAT DRAWER (slides up from bottom) ══ */}
      <div className={`absolute inset-x-0 bottom-0 z-20 transition-transform duration-300 ease-out ${showChat ? 'translate-y-0' : 'translate-y-full'}`}>
        <div className="bg-zinc-900/97 backdrop-blur-xl rounded-t-3xl border-t border-white/10 flex flex-col max-h-[70vh]">
          {/* Drawer handle + header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-white">Conversation</span>
              <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded-full">Dr. Nova</span>
            </div>
            <button onClick={() => setShowChat(false)} className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/15 transition-colors">
              <ChevronDown className="w-4 h-4" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-[120px]">
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} gap-2`}>
                {msg.role === 'ai' && (
                  <div className="w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0 mt-0.5">
                    <span className="text-xs">🩺</span>
                  </div>
                )}
                <div className={`max-w-[78%] px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                  msg.role === 'ai'
                    ? 'bg-zinc-800 text-zinc-100 rounded-tl-sm'
                    : 'bg-white text-zinc-900 rounded-tr-sm'
                }`}>
                  {msg.text}
                  <div className="text-[9px] opacity-30 mt-1">{msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                </div>
              </div>
            ))}
            {analyzing && (
              <div className="flex justify-start gap-2">
                <div className="w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-xs">🩺</span>
                </div>
                <div className="bg-zinc-800 px-3 py-2 rounded-2xl rounded-tl-sm flex items-center gap-1">
                  {[0, 1, 2].map(i => <div key={i} className="w-1 h-1 rounded-full bg-zinc-400 animate-bounce" style={{ animationDelay: `${i * 150}ms` }} />)}
                </div>
              </div>
            )}
            <div ref={chatBottomRef} />
          </div>

          {/* Text input */}
          <div className="p-3 border-t border-white/10 shrink-0">
            <div className="flex gap-2 items-end">
              {/* Image upload */}
              <label className="shrink-0 w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center text-zinc-400 hover:text-white cursor-pointer transition-colors">
                <Upload className="w-4 h-4" />
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={async e => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = ev => {
                      const b64 = (ev.target?.result as string).split(',')[1];
                      sendMessage('I\'ve uploaded an image for you to look at.', b64);
                    };
                    reader.readAsDataURL(file);
                    e.target.value = '';
                  }}
                />
              </label>
              <textarea
                value={textInput}
                onChange={e => setTextInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage(textInput, captureFrame());
                  }
                }}
                placeholder="Type a message…"
                rows={1}
                className="flex-1 resize-none bg-white/10 rounded-xl text-sm text-white placeholder:text-zinc-500 px-3 py-2.5 focus:outline-none focus:bg-white/15 max-h-24 overflow-y-auto"
              />
              <button
                onClick={() => sendMessage(textInput, captureFrame())}
                disabled={!textInput.trim() || analyzing}
                className="shrink-0 w-9 h-9 rounded-xl bg-emerald-500 disabled:bg-zinc-700 flex items-center justify-center transition-colors"
              >
                {analyzing ? <Loader2 className="w-4 h-4 text-white animate-spin" /> : <span className="text-white text-sm">↑</span>}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Connecting overlay */}
      {connecting && (
        <div className="absolute inset-0 bg-zinc-950 flex items-center justify-center z-50">
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="w-16 h-16 rounded-full bg-zinc-800 flex items-center justify-center animate-pulse">
              <span className="text-4xl">🩺</span>
            </div>
            <div>
              <p className="text-white font-semibold">Connecting to Dr. Nova…</p>
              <p className="text-zinc-500 text-sm mt-1">Setting up your consultation</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Export ───────────────────────────────────────────────────────────────────

export default function ConsultationPage() {
  return (
    <Suspense fallback={
      <div className="fixed inset-0 bg-zinc-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-zinc-400">
          <Loader2 className="w-8 h-8 animate-spin" />
          <p className="text-sm">Starting consultation…</p>
        </div>
      </div>
    }>
      <ConsultationInner />
    </Suspense>
  );
}
