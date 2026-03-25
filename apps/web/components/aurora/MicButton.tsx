"use client";

import { useState, useRef, useCallback, useEffect } from "react";

type MicState =
  | "default"
  | "pressed"
  | "requesting_permission"
  | "permission_denied"
  | "listening"
  | "listening_silence"
  | "reconnecting"
  | "error";

interface MicButtonProps {
  onListeningChange: (isListening: boolean) => void;
}

export function MicButton({ onListeningChange }: MicButtonProps) {
  const [state, setState] = useState<MicState>("default");
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActivityRef = useRef<number>(Date.now());

  const isListening = state === "listening" || state === "listening_silence" || state === "reconnecting";

  // Check mic permission on mount — show denied state immediately if blocked
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.permissions) return;
    navigator.permissions.query({ name: 'microphone' as PermissionName }).then(result => {
      if (result.state === 'denied') {
        setState('permission_denied');
      }
      // Listen for permission changes
      result.addEventListener('change', () => {
        if (result.state === 'denied') {
          setState('permission_denied');
        } else if (result.state === 'granted' && state === 'permission_denied') {
          setState('default');
        }
      });
    }).catch(() => {
      // permissions API not supported — will check on click
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const stopListening = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    analyserRef.current = null;
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
    if (silenceTimerRef.current) {
      clearInterval(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    setState("default");
    onListeningChange(false);
  }, [onListeningChange]);

  const startListening = useCallback(async () => {
    setState("requesting_permission");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      lastActivityRef.current = Date.now();
      setState("listening");
      onListeningChange(true);

      // Haptic feedback
      if (navigator.vibrate) {
        navigator.vibrate(10);
      }

      // Silence detection: check every 5s if audio is quiet
      silenceTimerRef.current = setInterval(() => {
        if (!analyserRef.current) return;
        const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;

        if (avg > 5) {
          lastActivityRef.current = Date.now();
          setState((prev) =>
            prev === "listening_silence" ? "listening" : prev
          );
        } else if (Date.now() - lastActivityRef.current > 30000) {
          setState("listening_silence");
        }
      }, 5000);
    } catch (err) {
      console.error("Mic access denied:", err);
      if (
        err instanceof DOMException &&
        (err.name === "NotAllowedError" || err.name === "PermissionDeniedError")
      ) {
        setState("permission_denied");
      } else {
        setState("error");
      }
    }
  }, [onListeningChange]);

  const handleClick = useCallback(() => {
    if (isListening) {
      stopListening();
    } else if (state === "permission_denied" || state === "error") {
      // Retry
      startListening();
    } else if (state === "default") {
      startListening();
    }
  }, [isListening, state, startListening, stopListening]);

  // WiFi recovery: detect offline/online during listening
  useEffect(() => {
    const handleOffline = () => {
      if (
        state === "listening" ||
        state === "listening_silence"
      ) {
        setState("reconnecting");
      }
    };
    const handleOnline = () => {
      if (state === "reconnecting") {
        setState("listening");
      }
    };
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, [state]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      audioCtxRef.current?.close();
      if (silenceTimerRef.current) clearInterval(silenceTimerRef.current);
    };
  }, []);

  // Determine visual properties based on state
  const getButtonClasses = () => {
    const base = "relative rounded-full transition-all duration-150 focus:outline-none";
    switch (state) {
      case "pressed":
        return `${base} w-[120px] h-[120px] scale-95`;
      case "requesting_permission":
        return `${base} w-[120px] h-[120px]`;
      case "permission_denied":
        return `${base} w-[120px] h-[120px]`;
      case "listening":
      case "listening_silence":
        return `${base} w-[140px] h-[140px]`;
      case "reconnecting":
        return `${base} w-[140px] h-[140px]`;
      case "error":
        return `${base} w-[120px] h-[120px]`;
      default:
        return `${base} w-[120px] h-[120px] animate-breathe`;
    }
  };

  const getBackgroundClasses = () => {
    if (state === "permission_denied" || state === "error") {
      return "absolute inset-0 rounded-full bg-[#3A3A3C] shadow-lg";
    }
    if (state === "reconnecting") {
      return "absolute inset-0 rounded-full bg-gradient-to-br from-[#F59E0B] to-[#D97706] shadow-lg shadow-[#F59E0B]/25";
    }
    return "absolute inset-0 rounded-full bg-gradient-to-br from-[#7C3AED] to-[#6C5CE7] shadow-lg shadow-[#6C5CE7]/25";
  };

  const getStatusText = () => {
    switch (state) {
      case "requesting_permission":
        return "Waiting for permission...";
      case "permission_denied":
        return getBrowserPermissionHelp();
      case "listening":
        return "Aurora is listening...";
      case "listening_silence":
        return "It's quiet in here.";
      case "reconnecting":
        return "Reconnecting...";
      case "error":
        return "Something went sideways. Tap to try again.";
      default:
        return "Tap to start listening";
    }
  };

  return (
    <div className="flex flex-col items-center gap-4">
      <button
        onClick={handleClick}
        onMouseDown={() => {
          if (state === "default") setState("pressed");
        }}
        onMouseUp={() => {
          if (state === "pressed") setState("default");
        }}
        onMouseLeave={() => {
          if (state === "pressed") setState("default");
        }}
        onTouchStart={() => {
          if (state === "default") setState("pressed");
          if (navigator.vibrate) navigator.vibrate(10);
        }}
        onTouchEnd={() => {
          if (state === "pressed") setState("default");
        }}
        className={getButtonClasses()}
        aria-label={isListening ? "Stop listening" : "Start listening"}
      >
        {/* Pulsing ring when listening */}
        {isListening && (
          <span className="absolute inset-0 rounded-full animate-ping-slow bg-[#6C5CE7]/20" />
        )}

        {/* Button background */}
        <span className={getBackgroundClasses()} />

        {/* Icon / Visualizer */}
        <span className="relative z-10 flex items-center justify-center w-full h-full">
          {state === "requesting_permission" ? (
            <SpinnerIcon />
          ) : state === "permission_denied" ? (
            <MicOffIcon />
          ) : state === "error" ? (
            <ExclamationIcon />
          ) : state === "reconnecting" ? (
            <SpinnerIcon />
          ) : isListening ? (
            <RadialWaveform analyser={analyserRef.current} />
          ) : (
            <MicIcon />
          )}
        </span>
      </button>

      <p
        className={`text-sm text-center max-w-[240px] ${
          isListening
            ? "text-[#6C5CE7]"
            : state === "permission_denied" || state === "error"
              ? "text-[--aurora-text-secondary]"
              : "text-[--aurora-text-secondary]"
        }`}
      >
        {getStatusText()}
      </p>
      {isListening && (
        <p className="text-xs text-[--aurora-text-secondary]">Tap to stop</p>
      )}
    </div>
  );
}

/* ─── Icons ─── */

function MicIcon() {
  return (
    <svg
      className="w-10 h-10 text-white"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z"
      />
    </svg>
  );
}

function MicOffIcon() {
  return (
    <svg
      className="w-10 h-10 text-white/70"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z"
      />
      <line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg
      className="w-8 h-8 text-white animate-spin"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

function ExclamationIcon() {
  return (
    <svg
      className="w-10 h-10 text-white/80"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
      />
    </svg>
  );
}

function getBrowserPermissionHelp(): string {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  if (ua.includes("Chrome")) {
    return "Mic blocked. Click the lock icon in your address bar to allow.";
  }
  if (ua.includes("Firefox")) {
    return "Mic blocked. Click the permission icon in the address bar.";
  }
  if (ua.includes("Safari")) {
    return "Mic blocked. Go to Safari > Settings > Websites > Microphone.";
  }
  return "Mic blocked. Check your browser settings to allow microphone access.";
}

/* ─── Radial Waveform Visualizer (Canvas) ─── */

function RadialWaveform({ analyser }: { analyser: AnalyserNode | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rotationRef = useRef(0);

  useEffect(() => {
    if (!analyser || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    let animFrame: number;
    const barCount = 64;
    const size = canvas.width;
    const centerX = size / 2;
    const centerY = size / 2;
    const innerRadius = 28;
    const maxBarHeight = 24;

    const draw = () => {
      animFrame = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);

      ctx.clearRect(0, 0, size, size);

      // Slow rotation
      rotationRef.current += 0.003;
      const rotation = rotationRef.current;

      for (let i = 0; i < barCount; i++) {
        const angle = (i / barCount) * Math.PI * 2 + rotation;
        const dataIdx = Math.floor((i / barCount) * bufferLength * 0.6);
        const value = dataArray[dataIdx] / 255;
        const barHeight = Math.max(3, value * maxBarHeight);

        const x1 = centerX + Math.cos(angle) * innerRadius;
        const y1 = centerY + Math.sin(angle) * innerRadius;
        const x2 = centerX + Math.cos(angle) * (innerRadius + barHeight);
        const y2 = centerY + Math.sin(angle) * (innerRadius + barHeight);

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = `rgba(255, 255, 255, ${0.4 + value * 0.6})`;
        ctx.lineWidth = 2;
        ctx.lineCap = "round";
        ctx.stroke();
      }
    };

    draw();
    return () => cancelAnimationFrame(animFrame);
  }, [analyser]);

  return (
    <canvas
      ref={canvasRef}
      width={120}
      height={120}
      className="w-[120px] h-[120px]"
    />
  );
}
