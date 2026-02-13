'use client';

import { useState, useEffect } from 'react';
import { formatTimestamp } from '@/lib/utils';

export default function VisionFeed() {
  const [imageUrl, setImageUrl] = useState<string>('');
  const [deskPresent, setDeskPresent] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<number>(Date.now());
  const [wsConnected, setWsConnected] = useState(false);

  useEffect(() => {
    // Try to connect to WebSocket for camera feed
    let ws: WebSocket | null = null;

    const connect = () => {
      try {
        ws = new WebSocket('ws://localhost:3004');

        ws.onopen = () => {
          setWsConnected(true);
          console.log('[Vision] WebSocket connected');
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'frame') {
              setImageUrl(data.imageUrl);
              setLastUpdate(Date.now());
            }
            if (data.type === 'presence') {
              setDeskPresent(data.present);
              setLastUpdate(Date.now());
            }
          } catch (err) {
            console.error('[Vision] Failed to parse message', err);
          }
        };

        ws.onerror = () => {
          setWsConnected(false);
          console.error('[Vision] WebSocket error');
        };

        ws.onclose = () => {
          setWsConnected(false);
          console.log('[Vision] WebSocket closed, reconnecting in 5s...');
          setTimeout(connect, 5000);
        };
      } catch (err) {
        console.error('[Vision] Failed to connect', err);
        setTimeout(connect, 5000);
      }
    };

    connect();

    // Simulate presence detection for demo
    setTimeout(() => {
      setDeskPresent(true);
      setLastUpdate(Date.now());
    }, 2000);

    return () => {
      if (ws) {
        ws.close();
      }
    };
  }, []);

  // Update relative timestamp
  const [relativeTime, setRelativeTime] = useState('--');
  useEffect(() => {
    const interval = setInterval(() => {
      setRelativeTime(formatTimestamp(lastUpdate));
    }, 1000);
    return () => clearInterval(interval);
  }, [lastUpdate]);

  return (
    <div className="bg-slate-800 rounded-lg p-4 h-full flex flex-col">
      <div className="flex justify-between items-center mb-2">
        <h2 className="text-lg font-semibold">📹 Vision Feed</h2>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-green-500 animate-pulse' : 'bg-gray-500'}`} />
          <span className="text-xs text-gray-400">{wsConnected ? 'Live' : 'Disconnected'}</span>
        </div>
      </div>

      <div className="flex-1 bg-black rounded-lg overflow-hidden relative min-h-0">
        {imageUrl ? (
          <img src={imageUrl} alt="Camera feed" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-500">
            <div className="text-center">
              <div className="text-6xl mb-2">📹</div>
              <div className="text-sm">No camera feed</div>
              <div className="text-xs text-gray-600 mt-2">Waiting for Agent 5...</div>
            </div>
          </div>
        )}

        {/* Presence indicator */}
        <div className="absolute bottom-2 left-2 bg-black/70 backdrop-blur px-3 py-1.5 rounded text-sm">
          <span className="text-gray-300">Desk: </span>
          {deskPresent ? (
            <span className="text-green-400 font-semibold">Present ✓</span>
          ) : (
            <span className="text-red-400 font-semibold">Away</span>
          )}
        </div>

        {/* Activity indicator */}
        {deskPresent && (
          <div className="absolute top-2 left-2 bg-green-500/20 backdrop-blur px-3 py-1 rounded text-xs text-green-400 border border-green-500/30">
            Active
          </div>
        )}
      </div>

      <div className="text-xs text-gray-400 mt-2 flex justify-between items-center">
        <span>Last: {relativeTime}</span>
        <span className="text-gray-500">1024×768</span>
      </div>
    </div>
  );
}
