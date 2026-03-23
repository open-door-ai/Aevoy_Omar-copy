"use client";

import { useState, useRef, useCallback, useEffect } from "react";

interface MicButtonProps {
  onListeningChange: (isListening: boolean) => void;
}

export function MicButton({ onListeningChange }: MicButtonProps) {
  const [listening, setListening] = useState(false);
  const [pressed, setPressed] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const toggleListening = useCallback(async () => {
    if (listening) {
      // Stop
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      analyserRef.current = null;
      if (audioCtxRef.current) {
        audioCtxRef.current.close();
        audioCtxRef.current = null;
      }
      setListening(false);
      onListeningChange(false);
    } else {
      // Start
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        streamRef.current = stream;

        // Set up audio analyzer for visualizer
        const audioCtx = new AudioContext();
        audioCtxRef.current = audioCtx;
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        analyserRef.current = analyser;

        setListening(true);
        onListeningChange(true);
      } catch (err) {
        console.error("Mic access denied:", err);
      }
    }
  }, [listening, onListeningChange]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      audioCtxRef.current?.close();
    };
  }, []);

  return (
    <div className="flex flex-col items-center gap-4">
      <button
        onClick={toggleListening}
        onMouseDown={() => setPressed(true)}
        onMouseUp={() => setPressed(false)}
        onMouseLeave={() => setPressed(false)}
        onTouchStart={() => setPressed(true)}
        onTouchEnd={() => setPressed(false)}
        className={`relative w-[120px] h-[120px] rounded-full transition-transform duration-150 ${
          pressed ? "scale-95" : listening ? "scale-100" : "animate-breathe"
        }`}
        aria-label={listening ? "Stop listening" : "Start listening"}
      >
        {/* Pulsing ring when listening */}
        {listening && (
          <span className="absolute inset-0 rounded-full animate-ping-slow bg-[#6C5CE7]/20" />
        )}

        {/* Button background */}
        <span className="absolute inset-0 rounded-full bg-gradient-to-br from-[#6C5CE7] to-[#A855F7] shadow-lg shadow-[#6C5CE7]/25" />

        {/* Icon or visualizer */}
        <span className="relative z-10 flex items-center justify-center w-full h-full">
          {listening ? (
            <AudioBars analyser={analyserRef.current} />
          ) : (
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
          )}
        </span>
      </button>

      <p
        className={`text-sm ${listening ? "text-[#6C5CE7]" : "text-[--aurora-text-secondary]"}`}
      >
        {listening ? "Aurora is listening..." : "Tap to start listening"}
      </p>
      {listening && (
        <p className="text-xs text-[--aurora-text-secondary]">Tap to stop</p>
      )}
    </div>
  );
}

// Simple audio bars visualizer
function AudioBars({ analyser }: { analyser: AnalyserNode | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!analyser || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    let animFrame: number;

    const draw = () => {
      animFrame = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const barCount = 5;
      const barWidth = 6;
      const gap = 4;
      const totalWidth = barCount * barWidth + (barCount - 1) * gap;
      const startX = (canvas.width - totalWidth) / 2;
      const centerY = canvas.height / 2;

      for (let i = 0; i < barCount; i++) {
        const idx = Math.floor((i / barCount) * bufferLength * 0.5);
        const value = dataArray[idx] / 255;
        const height = Math.max(8, value * 40);

        ctx.fillStyle = "#FFFFFF";
        ctx.beginPath();
        ctx.roundRect(
          startX + i * (barWidth + gap),
          centerY - height / 2,
          barWidth,
          height,
          3
        );
        ctx.fill();
      }
    };

    draw();
    return () => cancelAnimationFrame(animFrame);
  }, [analyser]);

  return (
    <canvas
      ref={canvasRef}
      width={60}
      height={60}
      className="w-[60px] h-[60px]"
    />
  );
}
