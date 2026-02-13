import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { processTask } from './services/processor.js';
import { getMemory, saveMemory } from './services/memory.js';

import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
// Also try the CWD .env as fallback
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const app = express();
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'core',
    port: Number(process.env.CORE_PORT) || 3002,
    timestamp: new Date().toISOString(),
    ai: {
      primary: 'kimi-k2.5',
      fallbacks: ['groq', 'deepseek', 'gemini', 'claude'],
    },
  });
});

// Webhook auth middleware
function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const secret = req.headers['x-webhook-secret'] as string;
  const expected = process.env.GATEWAY_WEBHOOK_SECRET || '';

  if (!expected) {
    next();
    return;
  }

  if (!secret) {
    res.status(401).json({ error: 'Missing webhook secret' });
    return;
  }

  try {
    const secretBuf = Buffer.from(secret);
    const expectedBuf = Buffer.from(expected);

    if (secretBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(secretBuf, expectedBuf)) {
      res.status(403).json({ error: 'Invalid secret' });
      return;
    }

    next();
  } catch {
    res.status(500).json({ error: 'Auth error' });
  }
}

// Process task
app.post('/task', authMiddleware, async (req, res) => {
  try {
    const { userId, username, channel, from, body, subject } = req.body;

    if (!body) {
      res.status(400).json({ error: 'Missing task body' });
      return;
    }

    console.log(`[CORE] Task from ${channel}: "${body.substring(0, 100)}"`);

    const result = await processTask({
      userId: userId || 'omar',
      username: username || 'omar',
      channel: channel || 'web',
      from: from || 'unknown',
      body,
      subject,
    });

    res.json(result);
  } catch (error: any) {
    console.error('[CORE] Task error:', error.message);
    res.json({
      success: false,
      message: 'Something went wrong. I hit a snag processing that task.',
    });
  }
});

// Memory endpoints
app.get('/memory', authMiddleware, async (req, res) => {
  try {
    const memories = await getMemory(req.query.userId as string || 'omar');
    res.json(memories);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/memory', authMiddleware, async (req, res) => {
  try {
    await saveMemory(req.body.userId || 'omar', req.body.key, req.body.value);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = Number(process.env.CORE_PORT) || 3002;
app.listen(PORT, () => {
  console.log(`[CORE] AI Core running on port ${PORT}`);
  console.log(`[CORE] Primary AI: Kimi K2.5`);
  console.log(`[CORE] Fallbacks: Groq → DeepSeek → Gemini → Claude`);
});
