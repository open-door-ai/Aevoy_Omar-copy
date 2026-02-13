import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const secret = req.headers['x-webhook-secret'] as string;

  if (!secret) {
    res.status(401).json({ error: 'Missing webhook secret' });
    return;
  }

  const expected = process.env.GATEWAY_WEBHOOK_SECRET || '';

  if (!expected) {
    console.error('[AUTH] GATEWAY_WEBHOOK_SECRET not configured');
    res.status(500).json({ error: 'Server configuration error' });
    return;
  }

  // Timing-safe comparison
  try {
    const secretBuffer = Buffer.from(secret);
    const expectedBuffer = Buffer.from(expected);

    if (secretBuffer.length !== expectedBuffer.length) {
      res.status(403).json({ error: 'Invalid secret' });
      return;
    }

    if (!crypto.timingSafeEqual(secretBuffer, expectedBuffer)) {
      res.status(403).json({ error: 'Invalid secret' });
      return;
    }

    next();
  } catch (error) {
    res.status(500).json({ error: 'Authentication error' });
  }
}
