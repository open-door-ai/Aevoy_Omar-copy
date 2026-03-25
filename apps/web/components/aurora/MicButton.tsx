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
  onIntentDetected?: (action: string) => void;
  onTranscript?: (text: string, isFinal: boolean) => void;
  userId?: string | null;
  accessToken?: string | null;
}

const AGENT_URL =
  process.env.NEXT_PUBLIC_AGENT_URL ||
  "https://agent-production-1339.up.railway.app";

const WS_URL =
  AGENT_URL.replace("https://", "wss://").replace("http://", "ws://") +
  "/aurora/listen/ws";

// Target format for Deepgram: linear16, 16kHz, mono
const TARGET_SAMPLE_RATE = 16000;

export function MicButton({
  onListeningChange,
  onIntentDetected,
  onTranscript,
  userId,
  accessToken,
}: MicButtonProps) {
  const [state, setState] = useState<MicState>("default");
  const [serverMessage, setServerMessage] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActivityRef = useRef<number>(Date.now());
  const wsRef = useRef<WebSocket | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const isListeningRef = useRef(false);

  const isListening =
    state === "listening" ||
    state === "listening_silence" ||
    state === "reconnecting";

  // Keep ref in sync for use in closures that outlive render cycles
  useEffect(() => {
    isListeningRef.current = isListening;
  }, [isListening]);

  // Check mic permission on mount
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.permissions) return;
    navigator.permissions
      .query({ name: "microphone" as PermissionName })
      .then((result) => {
        if (result.state === "denied") {
          setState("permission_denied");
        }
        result.addEventListener("change", () => {
          if (result.state === "denied") {
            setState("permission_denied");
          } else if (
            result.state === "granted" &&
            state === "permission_denied"
          ) {
            setState("default");
          }
        });
      })
      .catch(() => {
        // permissions API not supported
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const cleanup = useCallback(() => {
    // Close WebSocket
    if (wsRef.current) {
      if (
        wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING
      ) {
        wsRef.current.close();
      }
      wsRef.current = null;
    }

    // Disconnect audio processor
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }

    // Stop media stream tracks
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

    setServerMessage(null);
  }, []);

  const stopListening = useCallback(() => {
    cleanup();
    setState("default");
    onListeningChange(false);
  }, [onListeningChange, cleanup]);

  const startListening = useCallback(async () => {
    setState("requesting_permission");

    try {
      // Request audio at a sample rate close to our target for better quality
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: TARGET_SAMPLE_RATE,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      streamRef.current = stream;

      const audioCtx = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);

      // Analyser for the visualizer
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      // ScriptProcessorNode to capture raw PCM and convert to linear16
      // Buffer size 4096 at 16kHz = 256ms chunks
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      // Connect: source -> processor -> destination (required for processing)
      source.connect(processor);
      processor.connect(audioCtx.destination);

      // Open WebSocket to agent server
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      let authenticated = false;

      ws.onopen = () => {
        // Send auth message first
        if (userId && accessToken) {
          ws.send(
            JSON.stringify({
              type: "auth",
              userId: userId,
              token: accessToken,
            })
          );
        } else {
          console.error("[MicButton] Missing userId or accessToken for WebSocket auth");
          setServerMessage("Not signed in. Please refresh and try again.");
          setState("error");
          cleanup();
        }
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          if (msg.type === "authenticated") {
            authenticated = true;
            console.log("[MicButton] WebSocket authenticated, streaming audio");
          } else if (msg.type === "transcript") {
            // Forward transcript to parent for feed display
            if (msg.is_final) {
              setServerMessage(msg.text);
              setTimeout(() => setServerMessage(null), 5000);
            }
            onTranscript?.(msg.text, !!msg.is_final);
          } else if (msg.type === "intent_detected") {
            // Aurora detected something actionable — notify the feed
            console.log("[MicButton] Intent detected:", msg.action);
            onIntentDetected?.(msg.action);
          } else if (msg.type === "action_completed") {
            // Aurora finished acting on a detected intent
            console.log("[MicButton] Action completed:", msg.action);
          } else if (msg.type === "error") {
            console.error("[MicButton] Server error:", msg.message);
            setServerMessage(msg.message);
          } else if (msg.type === "budget_exceeded") {
            setServerMessage("Listening budget exceeded for today.");
            stopListening();
          } else if (msg.type === "session_expired") {
            setServerMessage("Session expired. Please reconnect.");
            stopListening();
          } else if (msg.type === "server_restarting") {
            setServerMessage("Server restarting. Reconnecting...");
            setState("reconnecting");
          } else if (msg.type === "transcription_paused") {
            setServerMessage(msg.message || "Transcription paused...");
          }
        } catch {
          // Ignore non-JSON messages
        }
      };

      ws.onerror = (err) => {
        console.error("[MicButton] WebSocket error:", err);
      };

      ws.onclose = (event) => {
        console.log(
          "[MicButton] WebSocket closed:",
          event.code,
          event.reason
        );
        // If we were listening, this is unexpected — use ref to avoid stale closure
        if (isListeningRef.current) {
          setState("reconnecting");
          // After a brief delay, stop fully
          setTimeout(() => {
            stopListening();
          }, 3000);
        }
      };

      // Send audio data as linear16 PCM
      processor.onaudioprocess = (e) => {
        if (!authenticated || !ws || ws.readyState !== WebSocket.OPEN) return;

        const inputData = e.inputBuffer.getChannelData(0);

        // The AudioContext is already at 16kHz (we requested it),
        // but browsers may give a different rate. Handle resampling if needed.
        const actualRate = audioCtx.sampleRate;
        let samples: Float32Array;

        if (actualRate !== TARGET_SAMPLE_RATE) {
          // Simple linear interpolation resampling
          const ratio = actualRate / TARGET_SAMPLE_RATE;
          const outputLength = Math.floor(inputData.length / ratio);
          samples = new Float32Array(outputLength);
          for (let i = 0; i < outputLength; i++) {
            const srcIdx = i * ratio;
            const lo = Math.floor(srcIdx);
            const hi = Math.min(lo + 1, inputData.length - 1);
            const frac = srcIdx - lo;
            samples[i] = inputData[lo] * (1 - frac) + inputData[hi] * frac;
          }
        } else {
          samples = inputData;
        }

        // Convert float32 [-1, 1] to int16 [-32768, 32767]
        const pcm16 = new Int16Array(samples.length);
        for (let i = 0; i < samples.length; i++) {
          const s = Math.max(-1, Math.min(1, samples[i]));
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }

        ws.send(pcm16.buffer);
      };

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
        (err.name === "NotAllowedError" ||
          err.name === "PermissionDeniedError")
      ) {
        setState("permission_denied");
      } else {
        setState("error");
      }
    }
  }, [onListeningChange, userId, accessToken, cleanup, stopListening]);

  const handleClick = useCallback(() => {
    if (isListening) {
      stopListening();
    } else if (state === "permission_denied" || state === "error") {
      startListening();
    } else if (state === "default") {
      startListening();
    }
  }, [isListening, state, startListening, stopListening]);

  // WiFi recovery
  useEffect(() => {
    const handleOffline = () => {
      if (state === "listening" || state === "listening_silence") {
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
      cleanup();
    };
  }, [cleanup]);

  // Visual properties
  const getButtonClasses = () => {
    const base =
      "relative rounded-full transition-all duration-150 focus:outline-none";
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
    // Show server messages (transcripts, errors) when available
    if (serverMessage && isListening) {
      return serverMessage;
    }
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
        return serverMessage || "Something went sideways. Tap to try again.";
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

/* --- Icons --- */

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
      <line
        x1="3"
        y1="3"
        x2="21"
        y2="21"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
      />
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

/* --- Radial Waveform Visualizer (Canvas) --- */

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
