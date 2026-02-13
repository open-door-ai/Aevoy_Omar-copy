import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import express from 'express';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.VISION_PORT || 3004;

let latestFrame: Buffer | null = null;
let presenceState = false;
let frameCount = 0;
let clientCount = 0;

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'vision',
    port: PORT,
    clients: clientCount,
    frames: frameCount,
    presence: presenceState
  });
});

// WebSocket connection for camera feed
wss.on('connection', (ws: WebSocket) => {
  clientCount++;
  console.log(`[CAMERA-SERVICE] ✅ Client connected (total: ${clientCount})`);

  // Send presence state immediately
  ws.send(JSON.stringify({ type: 'presence', present: presenceState }));

  // Send latest frame if available
  if (latestFrame) {
    ws.send(JSON.stringify({
      type: 'frame',
      imageUrl: `data:image/jpeg;base64,${latestFrame.toString('base64')}`,
      timestamp: Date.now()
    }));
  }

  ws.on('close', () => {
    clientCount--;
    console.log(`[CAMERA-SERVICE] ❌ Client disconnected (total: ${clientCount})`);
  });

  ws.on('error', (error) => {
    console.error('[CAMERA-SERVICE] WebSocket error:', error.message);
  });
});

// HTTP endpoint to receive frames from Python detector
app.post('/frame', express.raw({ type: 'image/jpeg', limit: '5mb' }), (req, res) => {
  latestFrame = req.body;
  frameCount++;

  // Broadcast to all connected clients
  let broadcastCount = 0;
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(JSON.stringify({
          type: 'frame',
          imageUrl: `data:image/jpeg;base64,${latestFrame!.toString('base64')}`,
          timestamp: Date.now(),
          frameCount
        }));
        broadcastCount++;
      } catch (error) {
        console.error('[CAMERA-SERVICE] Failed to send frame:', error);
      }
    }
  });

  // Log every 100 frames
  if (frameCount % 100 === 0) {
    console.log(`[CAMERA-SERVICE] 📸 Frame ${frameCount} broadcasted to ${broadcastCount} clients`);
  }

  res.sendStatus(200);
});

// HTTP endpoint to update presence state
app.post('/presence', express.json(), (req, res) => {
  const { present } = req.body;

  if (typeof present !== 'boolean') {
    return res.status(400).json({ error: 'Invalid presence value' });
  }

  const changed = presenceState !== present;
  presenceState = present;

  if (changed) {
    // Broadcast to Mission Control
    let broadcastCount = 0;
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(JSON.stringify({
            type: 'presence',
            present,
            timestamp: Date.now()
          }));
          broadcastCount++;
        } catch (error) {
          console.error('[CAMERA-SERVICE] Failed to send presence:', error);
        }
      }
    });

    const icon = present ? '✅' : '❌';
    console.log(`[CAMERA-SERVICE] ${icon} Presence: ${present ? 'DETECTED' : 'LOST'} → broadcasted to ${broadcastCount} clients`);
  }

  res.sendStatus(200);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[CAMERA-SERVICE] 🛑 Shutting down...');

  wss.clients.forEach((client) => {
    client.close(1000, 'Server shutting down');
  });

  server.close(() => {
    console.log('[CAMERA-SERVICE] 👋 Server closed');
    process.exit(0);
  });
});

server.listen(PORT, () => {
  console.log(`[CAMERA-SERVICE] 🚀 WebSocket server running on port ${PORT}`);
  console.log(`[CAMERA-SERVICE] 📡 Endpoints:`);
  console.log(`  - GET  /health`);
  console.log(`  - POST /frame (image/jpeg)`);
  console.log(`  - POST /presence (JSON)`);
  console.log(`  - WS   ws://localhost:${PORT}`);
});
