/**
 * Mission Control Integration Example
 *
 * Shows how to connect to Vision System WebSocket
 * and receive presence updates + camera feed
 */

import WebSocket from 'ws';

const VISION_WS_URL = 'ws://localhost:3004';

interface PresenceMessage {
  type: 'presence';
  present: boolean;
  timestamp: number;
}

interface FrameMessage {
  type: 'frame';
  imageUrl: string; // data:image/jpeg;base64,...
  timestamp: number;
  frameCount?: number;
}

type VisionMessage = PresenceMessage | FrameMessage;

class VisionClient {
  private ws: WebSocket | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private presenceState = false;

  constructor() {
    this.connect();
  }

  private connect() {
    console.log('[VISION-CLIENT] Connecting to vision system...');

    this.ws = new WebSocket(VISION_WS_URL);

    this.ws.on('open', () => {
      console.log('[VISION-CLIENT] ✅ Connected to vision system');
    });

    this.ws.on('message', (data: WebSocket.Data) => {
      try {
        const message = JSON.parse(data.toString()) as VisionMessage;
        this.handleMessage(message);
      } catch (error) {
        console.error('[VISION-CLIENT] Failed to parse message:', error);
      }
    });

    this.ws.on('close', () => {
      console.log('[VISION-CLIENT] ❌ Disconnected, reconnecting in 5s...');
      this.ws = null;
      this.reconnectTimeout = setTimeout(() => this.connect(), 5000);
    });

    this.ws.on('error', (error) => {
      console.error('[VISION-CLIENT] WebSocket error:', error.message);
    });
  }

  private handleMessage(message: VisionMessage) {
    switch (message.type) {
      case 'presence':
        this.handlePresence(message);
        break;
      case 'frame':
        this.handleFrame(message);
        break;
      default:
        console.warn('[VISION-CLIENT] Unknown message type:', (message as any).type);
    }
  }

  private handlePresence(message: PresenceMessage) {
    if (this.presenceState !== message.present) {
      this.presenceState = message.present;
      const icon = message.present ? '✅' : '❌';
      console.log(`[VISION-CLIENT] ${icon} Presence: ${message.present ? 'DETECTED' : 'LOST'}`);

      // TODO: Update UI - show green indicator when Omar is present
      // TODO: Trigger greeting UI animation
      // TODO: Update dashboard status
    }
  }

  private handleFrame(message: FrameMessage) {
    // Frame received as base64-encoded JPEG
    // Example: data:image/jpeg;base64,/9j/4AAQSkZJRg...

    // In a real UI, you'd set this as <img src={message.imageUrl} />
    console.log(`[VISION-CLIENT] 📸 Frame received (${message.frameCount || '?'})`);

    // TODO: Update camera feed in UI
    // Example React: setCameraFeed(message.imageUrl)
    // Example vanilla JS: document.getElementById('camera').src = message.imageUrl
  }

  public disconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    if (this.ws) {
      this.ws.close();
    }
  }

  public getPresenceState(): boolean {
    return this.presenceState;
  }
}

// Usage example
if (require.main === module) {
  console.log('Starting Vision Client Example...\n');
  const client = new VisionClient();

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    client.disconnect();
    process.exit(0);
  });
}

export default VisionClient;

/**
 * React Component Example:
 *
 * ```tsx
 * import { useEffect, useState } from 'react';
 * import VisionClient from './vision-client';
 *
 * export function CameraFeed() {
 *   const [cameraUrl, setCameraUrl] = useState<string | null>(null);
 *   const [isPresent, setIsPresent] = useState(false);
 *
 *   useEffect(() => {
 *     const client = new VisionClient();
 *
 *     // Override handlers to update state
 *     const originalHandleFrame = client['handleFrame'].bind(client);
 *     client['handleFrame'] = (msg) => {
 *       originalHandleFrame(msg);
 *       setCameraUrl(msg.imageUrl);
 *     };
 *
 *     const originalHandlePresence = client['handlePresence'].bind(client);
 *     client['handlePresence'] = (msg) => {
 *       originalHandlePresence(msg);
 *       setIsPresent(msg.present);
 *     };
 *
 *     return () => client.disconnect();
 *   }, []);
 *
 *   return (
 *     <div className="camera-container">
 *       <div className={`status ${isPresent ? 'online' : 'offline'}`}>
 *         {isPresent ? '🟢 Omar is here' : '🔴 Away'}
 *       </div>
 *       {cameraUrl && <img src={cameraUrl} alt="Camera feed" />}
 *     </div>
 *   );
 * }
 * ```
 */
