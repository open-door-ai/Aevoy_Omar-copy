import express, { Request, Response } from 'express';
import { routeToCore } from '../services/router.js';
import { resolveUserByPhone } from '../services/identity.js';

const router = express.Router();

router.post('/', async (req: Request, res: Response) => {
  try {
    const { From, SpeechResult } = req.body; // Twilio format

    if (!From) {
      res.status(400).json({ error: 'Missing required field: From' });
      return;
    }

    const user = await resolveUserByPhone(From);

    if (!user) {
      // Return TwiML for unknown user
      res.type('text/xml');
      res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Say>I don't recognize this number. Please contact Omar to register.</Say><Hangup/></Response>`);
      return;
    }

    const response = await routeToCore({
      userId: user.id,
      username: user.username,
      channel: 'voice',
      from: From,
      body: SpeechResult || 'Voice call (no transcription)',
    });

    // Return TwiML
    res.type('text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Say>${response.message || 'Task received'}</Say><Hangup/></Response>`);
  } catch (error: any) {
    console.error('[VOICE] Error:', error.message);
    res.type('text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Say>Sorry, an error occurred.</Say><Hangup/></Response>`);
  }
});

export default router;
