import axios from 'axios';
import type { IncomingMessage } from '../types.js';

const CORE_URL = process.env.CORE_URL || 'http://localhost:3002';
const WEBHOOK_SECRET = process.env.GATEWAY_WEBHOOK_SECRET || '';

export async function routeToCore(message: IncomingMessage): Promise<any> {
  try {
    console.log(`[ROUTER] Routing ${message.channel} message from ${message.from} to core`);

    const response = await axios.post(
      `${CORE_URL}/task`,
      message,
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Secret': WEBHOOK_SECRET,
        },
        timeout: 120000, // 2 minutes
      }
    );

    console.log(`[ROUTER] Response from core: ${response.status}`);
    return response.data;
  } catch (error: any) {
    console.error('[ROUTER] Error routing to core:', error.message);
    throw new Error(`Failed to route message: ${error.message}`);
  }
}
