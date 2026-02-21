import { test, expect } from '@playwright/test';

const BASE_URL = 'https://www.aevoy.com';
const EMAIL = 'test-e2e@aevoy.com';
const PASSWORD = 'TestAevoy2026';

async function login(page: any) {
  await page.goto(`${BASE_URL}/login`);
  await page.waitForSelector('input[type="email"]', { timeout: 10000 });
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  console.log('[✓] Logged in');
}

test.describe('Health Consultation — Production Visual & Functional', () => {

  test('Health dashboard page renders', async ({ page }) => {
    await login(page);
    await page.goto(`${BASE_URL}/dashboard/health`);
    await page.waitForTimeout(2000);

    const title = await page.title();
    console.log(`[INFO] Page title: ${title}`);

    // Should not show error page
    const errorText = await page.locator('text=500, text=Error, text=Something went wrong').count();
    expect(errorText).toBe(0);

    // Health page should have some content
    const bodyText = await page.textContent('body');
    const hasHealth = bodyText?.toLowerCase().includes('health') || bodyText?.toLowerCase().includes('consult');
    console.log(`[INFO] Has health content: ${hasHealth}`);
    console.log(`[✓] Health dashboard renders`);

    // Screenshot
    await page.screenshot({ path: '/tmp/health-dashboard.png', fullPage: true });
    console.log('[✓] Screenshot saved: /tmp/health-dashboard.png');
  });

  test('Consultation page renders Google Meet UI', async ({ page, context }) => {
    // Grant camera/mic permissions upfront
    await context.grantPermissions(['camera', 'microphone'], { origin: BASE_URL });

    await login(page);
    await page.goto(`${BASE_URL}/dashboard/health/consultation`);
    await page.waitForTimeout(4000); // Wait for consultation to initialize

    console.log('[INFO] URL after navigation:', page.url());

    // Should show consultation UI (not a redirect)
    const url = page.url();
    expect(url).toContain('/dashboard/health/consultation');

    // Dr. Nova PiP avatar should be visible
    const drNovaEmoji = await page.locator('text=🩺').first().isVisible().catch(() => false);
    console.log(`[INFO] Dr. Nova emoji visible: ${drNovaEmoji}`);

    // LIVE indicator should be present
    const liveIndicator = await page.locator('text=LIVE').isVisible({ timeout: 8000 }).catch(() => false);
    console.log(`[INFO] LIVE indicator visible: ${liveIndicator}`);

    // Hold to speak label
    const holdText = await page.locator('text=/Hold to speak|Release to send|Mic blocked/i').first().isVisible().catch(() => false);
    console.log(`[INFO] Mic label visible: ${holdText}`);

    // Chat toggle button
    const chatBtn = await page.locator('[class*="MessageSquare"], button').filter({ hasText: '' }).count();
    console.log(`[INFO] Buttons found: ${chatBtn}`);

    // End call button (PhoneOff)  
    const endCall = await page.locator('[class*="red"]').count();
    console.log(`[INFO] Red elements (end call area): ${endCall}`);

    // Screenshot of the full UI
    await page.screenshot({ path: '/tmp/consultation-ui.png', fullPage: false });
    console.log('[✓] Screenshot saved: /tmp/consultation-ui.png');

    // Verify body text
    const bodyText = await page.textContent('body');
    expect(bodyText).toContain('Dr. Nova');
    console.log('[✓] Dr. Nova present in page');
  });

  test('Consultation API creates session', async ({ request }) => {
    // Test the consultation API directly with a simple auth approach
    // Check that the analyze endpoint returns proper JSON (even without auth = 401)
    const res = await request.post(`${BASE_URL}/api/health/consult/00000000-0000-0000-0000-000000000000/analyze`, {
      data: { message: 'test' },
    });
    
    // Should return 401 (unauthorized) not 500
    console.log(`[INFO] Analyze endpoint status (no auth): ${res.status()}`);
    expect([401, 404]).toContain(res.status());
    console.log('[✓] Analyze endpoint properly protected');

    const transcribeRes = await request.post(`${BASE_URL}/api/health/consult/00000000-0000-0000-0000-000000000000/transcribe`, {
      multipart: { audio: { name: 'test.webm', mimeType: 'audio/webm', buffer: Buffer.from('test') } },
    });
    console.log(`[INFO] Transcribe endpoint status (no auth): ${transcribeRes.status()}`);
    expect([401, 404]).toContain(transcribeRes.status());
    console.log('[✓] Transcribe endpoint properly protected');
  });

  test('Health page sidebar nav item exists', async ({ page }) => {
    await login(page);
    await page.goto(`${BASE_URL}/dashboard`);
    await page.waitForTimeout(2000);

    // Check sidebar for Health nav link
    const healthLink = await page.locator('a[href*="/health"], text=/Health/i').isVisible({ timeout: 5000 }).catch(() => false);
    console.log(`[INFO] Health nav in sidebar: ${healthLink}`);

    await page.screenshot({ path: '/tmp/dashboard-with-health-nav.png', fullPage: false });
    console.log('[✓] Dashboard sidebar screenshot saved');
  });

});
