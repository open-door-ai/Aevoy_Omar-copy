import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server as SocketIO } from 'socket.io';
import dotenv from 'dotenv';
import emailRouter from './routes/email.js';
import smsRouter from './routes/sms.js';
import voiceRouter from './routes/voice.js';
import whatsappRouter from './routes/whatsapp.js';
import webRouter from './routes/web.js';
import { authMiddleware } from './middleware/auth.js';
import { rateLimitMiddleware } from './middleware/rate-limit.js';
import { loggerMiddleware } from './middleware/logger.js';
import { initWebSocket } from './services/websocket.js';

dotenv.config();

const app = express();
const server = createServer(app);
const io = new SocketIO(server, {
  cors: { origin: '*' },
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(loggerMiddleware);

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'gateway',
    port: Number(process.env.GATEWAY_PORT) || 18789,
    timestamp: new Date().toISOString(),
  });
});

// Routes (all require webhook auth except web)
app.use('/incoming/email', authMiddleware, rateLimitMiddleware, emailRouter);
app.use('/incoming/sms', authMiddleware, rateLimitMiddleware, smsRouter);
app.use('/incoming/voice', authMiddleware, rateLimitMiddleware, voiceRouter);
app.use('/incoming/whatsapp', authMiddleware, rateLimitMiddleware, whatsappRouter);
app.use('/incoming/web', rateLimitMiddleware, webRouter);

// WebSocket
initWebSocket(io);

const PORT = Number(process.env.GATEWAY_PORT) || 18789;
server.listen(PORT, () => {
  console.log(`[GATEWAY] Listening on port ${PORT}`);
  console.log(`[GATEWAY] WebSocket enabled`);
  console.log(`[GATEWAY] Routes: /incoming/{email,sms,voice,whatsapp,web}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[GATEWAY] Shutting down...');
  server.close(() => {
    console.log('[GATEWAY] Server closed');
    process.exit(0);
  });
});
