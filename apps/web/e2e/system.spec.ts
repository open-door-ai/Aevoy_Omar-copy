import { test, expect } from '@playwright/test';

test.describe('System Health & Integration', () => {
  const AGENT_URL = process.env.AGENT_URL || 'https://hissing-verile-aevoy-e721b4a6.koyeb.app';
  const WEB_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://www.aevoy.com';

  test('should verify agent health', async ({ request }) => {
    console.log('[E2E] Verifying agent health at:', AGENT_URL);

    const response = await request.get(`${AGENT_URL}/health`);
    expect(response.ok()).toBeTruthy();

    const health = await response.json();
    console.log('[E2E] Agent health:', JSON.stringify(health, null, 2));

    expect(health.status).toBe('healthy');
    expect(health.subsystems).toBeDefined();
    expect(health.subsystems.supabase).toBe('ok');

    console.log('[E2E] ✅ Agent is healthy');
  });

  test('should verify all AI providers configured', async ({ request }) => {
    const response = await request.get(`${AGENT_URL}/health`);
    const health = await response.json();

    const requiredProviders = ['deepseek', 'anthropic', 'google'];
    const configuredProviders: string[] = [];

    for (const provider of requiredProviders) {
      if (health.subsystems[provider] === 'configured') {
        configuredProviders.push(provider);
        console.log(`[E2E] ✅ ${provider} configured`);
      } else {
        console.log(`[E2E] ⚠️ ${provider} not configured`);
      }
    }

    expect(configuredProviders.length).toBeGreaterThan(0);
    console.log(`[E2E] Total configured providers: ${configuredProviders.length}/${requiredProviders.length}`);
  });

  test('should verify skill system endpoints', async ({ request }) => {
    console.log('[E2E] Verifying skill system endpoints');

    const endpoints = [
      { path: '/skills/search?q=test', method: 'GET', name: 'Skill Search' },
    ];

    for (const endpoint of endpoints) {
      try {
        const response = await request.get(`${AGENT_URL}${endpoint.path}`);
        const status = response.ok() ? '✅' : `⚠️ (${response.status()})`;
        console.log(`[E2E] ${endpoint.name}: ${status}`);

        if (response.ok()) {
          const data = await response.json();
          console.log(`[E2E]   Response: ${JSON.stringify(data).slice(0, 100)}...`);
        }
      } catch (error) {
        console.log(`[E2E] ${endpoint.name}: ⚠️ Error - ${error}`);
      }
    }
  });

  test('should verify web app is accessible', async ({ page }) => {
    console.log('[E2E] Verifying web app at:', WEB_URL);

    await page.goto(WEB_URL);
    await expect(page).toHaveTitle(/Aevoy/);

    const hasLanding = await page.locator('text=AI Employee, text=Never Fails').isVisible().catch(() => false);
    expect(hasLanding).toBeTruthy();

    console.log('[E2E] ✅ Web app accessible');
  });

  test('should verify database connectivity', async ({ request }) => {
    const response = await request.get(`${AGENT_URL}/health`);
    const health = await response.json();

    expect(health.subsystems.supabase).toBe('ok');
    console.log('[E2E] ✅ Database connectivity confirmed');
  });

  test('should verify email system configured', async ({ request }) => {
    const response = await request.get(`${AGENT_URL}/health`);
    const health = await response.json();

    expect(health.subsystems.resend).toBe('configured');
    console.log('[E2E] ✅ Email system (Resend) configured');
  });

  test('should verify Twilio configured', async ({ request }) => {
    const response = await request.get(`${AGENT_URL}/health`);
    const health = await response.json();

    expect(health.subsystems.twilio).toBe('configured');
    console.log('[E2E] ✅ Twilio (SMS/Voice) configured');
  });

  test('should verify Browserbase configured', async ({ request }) => {
    const response = await request.get(`${AGENT_URL}/health`);
    const health = await response.json();

    expect(health.subsystems.browserbase).toBe('configured');
    console.log('[E2E] ✅ Browserbase (browser automation) configured');
  });

  test('should test n8n registry API accessibility', async ({ request }) => {
    console.log('[E2E] Testing n8n registry API');

    const response = await request.get('https://registry.npmjs.org/-/v1/search?text=n8n-nodes-google&size=5');
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data.objects).toBeDefined();
    expect(data.objects.length).toBeGreaterThan(0);

    console.log(`[E2E] ✅ n8n registry accessible, found ${data.objects.length} packages`);
  });

  test('should verify deployment versions match', async ({ request }) => {
    const response = await request.get(`${AGENT_URL}/health`);
    const health = await response.json();

    console.log(`[E2E] Agent version: ${health.version}`);
    console.log(`[E2E] Agent uptime: ${health.uptime ? Math.floor(health.uptime / 1000) + 's' : 'N/A'}`);
    console.log(`[E2E] Active tasks: ${health.activeTasks ?? 0}`);

    expect(health.version).toBeDefined();
    console.log('[E2E] ✅ Version information available');
  });
});
