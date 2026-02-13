import express, { Request, Response } from 'express';
import { routeToCore } from '../services/router.js';
import { resolveUserByEmail } from '../services/identity.js';

const router = express.Router();

router.post('/', async (req: Request, res: Response) => {
  try {
    const { from, to, subject, body } = req.body;

    if (!from || !body) {
      res.status(400).json({ error: 'Missing required fields: from, body' });
      return;
    }

    const user = await resolveUserByEmail(from);

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const response = await routeToCore({
      userId: user.id,
      username: user.username,
      channel: 'email',
      from,
      body,
      subject,
    });

    res.json(response);
  } catch (error: any) {
    console.error('[EMAIL] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

export default router;
