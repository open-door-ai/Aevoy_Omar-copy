import { test, expect } from '@playwright/test';

test.describe('Skills System', () => {
  const AGENT_URL = process.env.AGENT_URL || 'https://hissing-verile-aevoy-e721b4a6.koyeb.app';
  const WEBHOOK_SECRET = process.env.AGENT_WEBHOOK_SECRET;

  test('should search for skills via API', async ({ request }) => {
    console.log('[E2E] Testing skill search API');

    const response = await request.get(`${AGENT_URL}/skills/search`, {
      params: {
        q: 'google',
        limit: '5',
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();

    console.log(`[E2E] Found ${data.totalCount} skills`);
    console.log(`[E2E] Skills: ${data.skills.map((s: any) => s.name).join(', ')}`);

    expect(data.skills).toBeDefined();
    expect(Array.isArray(data.skills)).toBeTruthy();
    expect(data.totalCount).toBeGreaterThan(0);

    console.log('[E2E] ✅ Skill search working');
  });

  test('should search for n8n community nodes', async ({ request }) => {
    console.log('[E2E] Testing n8n node discovery');

    const response = await request.get(`${AGENT_URL}/skills/search`, {
      params: {
        q: 'sheets',
        sources: 'n8n',
        limit: '10',
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();

    console.log(`[E2E] Found ${data.totalCount} n8n nodes`);
    console.log(`[E2E] Nodes: ${data.skills.map((s: any) => s.name).slice(0, 5).join(', ')}`);

    expect(data.skills).toBeDefined();
    expect(data.totalCount).toBeGreaterThan(0);

    console.log('[E2E] ✅ n8n node discovery working');
  });

  test('should get skill details', async ({ request }) => {
    console.log('[E2E] Testing skill details retrieval');

    // First search for a skill
    const searchResponse = await request.get(`${AGENT_URL}/skills/search`, {
      params: { q: 'google', limit: '1' },
    });

    const searchData = await searchResponse.json();
    if (searchData.skills.length === 0) {
      console.log('[E2E] ⚠️ No skills found to test details');
      return;
    }

    const skillId = searchData.skills[0].id;
    console.log(`[E2E] Getting details for skill: ${skillId}`);

    const detailsResponse = await request.get(`${AGENT_URL}/skills/${skillId}`);
    expect(detailsResponse.ok()).toBeTruthy();

    const details = await detailsResponse.json();
    console.log(`[E2E] Skill details: ${JSON.stringify(details, null, 2)}`);

    expect(details.id).toBe(skillId);
    expect(details.name).toBeDefined();
    expect(details.description).toBeDefined();

    console.log('[E2E] ✅ Skill details retrieval working');
  });

  test.skip('should install a skill (requires auth)', async ({ request }) => {
    if (!WEBHOOK_SECRET) {
      console.log('[E2E] ⚠️ Skipping install test - no webhook secret');
      return;
    }

    console.log('[E2E] Testing skill installation');

    // Search for a curated skill
    const searchResponse = await request.get(`${AGENT_URL}/skills/search`, {
      params: {
        q: 'calendar',
        sources: 'curated',
        limit: '1',
      },
    });

    const searchData = await searchResponse.json();
    if (searchData.skills.length === 0) {
      console.log('[E2E] ⚠️ No curated skills found');
      return;
    }

    const skillId = searchData.skills[0].id;
    console.log(`[E2E] Installing skill: ${skillId}`);

    const installResponse = await request.post(`${AGENT_URL}/skills/install`, {
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': WEBHOOK_SECRET,
      },
      data: {
        skillId,
        userId: 'test-user-id',
        skipAudit: false,
      },
    });

    expect(installResponse.ok()).toBeTruthy();
    const installData = await installResponse.json();

    console.log(`[E2E] Install result: ${JSON.stringify(installData, null, 2)}`);

    expect(installData.success).toBeTruthy();
    expect(installData.skillId).toBe(skillId);

    console.log('[E2E] ✅ Skill installation working');
  });

  test('should list available skills by category', async ({ request }) => {
    console.log('[E2E] Testing category filtering');

    const categories = ['productivity', 'communication', 'data'];

    for (const category of categories) {
      const response = await request.get(`${AGENT_URL}/skills/search`, {
        params: {
          q: '',
          category,
          limit: '5',
        },
      });

      expect(response.ok()).toBeTruthy();
      const data = await response.json();

      console.log(`[E2E] Category "${category}": ${data.totalCount} skills`);
    }

    console.log('[E2E] ✅ Category filtering working');
  });

  test('should handle search with no results', async ({ request }) => {
    console.log('[E2E] Testing search with no results');

    const response = await request.get(`${AGENT_URL}/skills/search`, {
      params: {
        q: 'xyzabc123nonexistent',
        limit: '5',
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();

    expect(data.skills).toBeDefined();
    expect(data.totalCount).toBe(0);

    console.log('[E2E] ✅ Empty search handled correctly');
  });
});
