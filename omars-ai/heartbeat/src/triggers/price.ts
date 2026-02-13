import type { TriggerResult, HeartbeatState } from '../types.js';

interface TrackedItem {
  id: string;
  url: string;
  name: string;
  targetPrice: number;
  lastPrice: number;
}

const trackedItems: TrackedItem[] = [
  // Example: { id: '1', url: 'https://...', name: 'Tokyo flight', targetPrice: 800, lastPrice: 1200 }
];

export async function checkPriceTriggers(state: HeartbeatState): Promise<TriggerResult[]> {
  const results: TriggerResult[] = [];

  for (const item of trackedItems) {
    // TODO: Scrape current price from item.url
    // Compare to targetPrice
    // If dropped, trigger alert
  }

  return results;
}
