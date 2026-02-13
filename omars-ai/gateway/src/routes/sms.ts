import express, { Request, Response } from 'express';
import { routeToCore } from '../services/router.js';
import { resolveUserByPhone } from '../services/identity.js';

const router = express.Router();

router.post('/', async (req: Request, res: Response) => {
  try {
    const { From, Body } = req.body; // Twilio format

    if (!From || !Body) {
      res.status(400).json({ error: 'Missing required fields: From, Body' });
      return;
    }

    const user = await resolveUserByPhone(From);

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const response = await routeToCore({
      userId: user.id,
      username: user.username,
      channel: 'sms',
      from: From,
      body: Body,
    });

    // Return TwiML for Twilio
    res.type('text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${response.message || 'Task received'}</Message></Response>`);
  } catch (error: any) {
    console.error('[SMS] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

export default router;
