import express, { Request, Response } from 'express';
import { routeToCore } from '../services/router.js';

const router = express.Router();

router.post('/', async (req: Request, res: Response) => {
  try {
    const { userId, username, message } = req.body;

    if (!userId || !username || !message) {
      res.status(400).json({ error: 'Missing required fields: userId, username, message' });
      return;
    }

    const response = await routeToCore({
      userId,
      username,
      channel: 'web',
      from: 'web-ui',
      body: message,
    });

    res.json(response);
  } catch (error: any) {
    console.error('[WEB] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

export default router;
