/**
 * Production Deployment Verification
 *
 * Comprehensive end-to-end test to verify production deployment is working.
 * Tests both Vercel (web) and Koyeb (agent) deployments.
 */

import { test, expect } from '@playwright/test';

const PRODUCTION_WEB_URL = 'https://www.aevoy.com';
const PRODUCTION_AGENT_URL = 'https://hissing-verile-aevoy-e721b4a6.koyeb.app';

test.describe('Production Deployment Verification', () => {
  test('website loads successfully', async ({ page }) => {
    await page.goto(PRODUCTION_WEB_URL);

    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // Check title contains "Aevoy"
    await expect(page).toHaveTitle(/Aevoy/i);

    // Check hero section is visible
    const heroHeading = page.locator('h1').first();
    await expect(heroHeading).toBeVisible();

    console.log('✅ Website loaded successfully');
  });

  test('agent health endpoint responds', async ({ request }) => {
    const response = await request.get(`${PRODUCTION_AGENT_URL}/health`);

    expect(response.ok()).toBeTruthy();
    expect(response.status()).toBe(200);

    const health = await response.json();
    expect(health.status).toBe('healthy');
    expect(health.version).toBeDefined();
    expect(health.subsystems).toBeDefined();
    expect(health.subsystems.supabase).toBe('ok');

    console.log('✅ Agent health check passed');
    console.log(`   Version: ${health.version}`);
    console.log(`   Active tasks: ${health.activeTasks}`);
  });

  test('login page is accessible', async ({ page }) => {
    await page.goto(`${PRODUCTION_WEB_URL}/login`);
    await page.waitForLoadState('networkidle');

    // Check for email input
    const emailInput = page.locator('input[type="email"]');
    await expect(emailInput).toBeVisible();

    // Check for password input
    const passwordInput = page.locator('input[type="password"]');
    await expect(passwordInput).toBeVisible();

    // Check for login button
    const loginButton = page.locator('button:has-text("Sign In"), button:has-text("Login"), button:has-text("Log in")');
    await expect(loginButton.first()).toBeVisible();

    console.log('✅ Login page accessible');
  });

  test('signup page is accessible', async ({ page }) => {
    await page.goto(`${PRODUCTION_WEB_URL}/signup`);
    await page.waitForLoadState('networkidle');

    // Check for email input
    const emailInput = page.locator('input[type="email"]');
    await expect(emailInput).toBeVisible();

    console.log('✅ Signup page accessible');
  });

  test('how it works page loads', async ({ page }) => {
    await page.goto(`${PRODUCTION_WEB_URL}/how-it-works`);
    await page.waitForLoadState('networkidle');

    // Check page loaded
    await expect(page).toHaveURL(/how-it-works/);

    console.log('✅ How It Works page accessible');
  });

  test('agent subsystems are configured', async ({ request }) => {
    const response = await request.get(`${PRODUCTION_AGENT_URL}/health`);
    const health = await response.json();

    // Verify all critical subsystems are configured
    const requiredSubsystems = [
      'supabase',
      'deepseek',
      'anthropic',
      'google',
      'resend',
      'twilio',
      'browserbase'
    ];

    for (const subsystem of requiredSubsystems) {
      expect(health.subsystems[subsystem]).toBeDefined();
      expect(['ok', 'configured']).toContain(health.subsystems[subsystem]);
      console.log(`   ✓ ${subsystem}: ${health.subsystems[subsystem]}`);
    }

    console.log('✅ All subsystems configured');
  });

  test('website has correct security headers', async ({ request }) => {
    const response = await request.get(PRODUCTION_WEB_URL);
    const headers = response.headers();

    // Vercel should set these headers
    expect(headers['x-frame-options']).toBeDefined();

    console.log('✅ Security headers present');
  });

  test('website mobile responsive', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    await page.goto(PRODUCTION_WEB_URL);
    await page.waitForLoadState('networkidle');

    // Check hero is still visible on mobile
    const heroHeading = page.locator('h1').first();
    await expect(heroHeading).toBeVisible();

    console.log('✅ Website is mobile responsive');
  });

  test('agent handles invalid routes gracefully', async ({ request }) => {
    const response = await request.get(`${PRODUCTION_AGENT_URL}/nonexistent-route`);

    // Should return 404 or redirect, not crash
    expect([404, 301, 302]).toContain(response.status());

    console.log('✅ Agent handles invalid routes gracefully');
  });

  test('full deployment verification', async ({ page, request }) => {
    console.log('\n🚀 FULL DEPLOYMENT VERIFICATION\n');

    // 1. Website loads
    await page.goto(PRODUCTION_WEB_URL);
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveTitle(/Aevoy/i);
    console.log('   ✓ Website: LIVE');

    // 2. Agent health
    const agentResponse = await request.get(`${PRODUCTION_AGENT_URL}/health`);
    const health = await agentResponse.json();
    expect(health.status).toBe('healthy');
    console.log(`   ✓ Agent: HEALTHY (v${health.version})`);

    // 3. Database connection (via agent)
    expect(health.subsystems.supabase).toBe('ok');
    console.log('   ✓ Database: CONNECTED');

    // 4. AI services
    expect(health.subsystems.anthropic).toBe('configured');
    expect(health.subsystems.google).toBe('configured');
    expect(health.subsystems.deepseek).toBe('configured');
    console.log('   ✓ AI Services: CONFIGURED');

    // 5. Communication channels
    expect(health.subsystems.resend).toBe('configured');
    expect(health.subsystems.twilio).toBe('configured');
    console.log('   ✓ Communication: READY');

    // 6. Browser automation
    expect(health.subsystems.browserbase).toBe('configured');
    console.log('   ✓ Browser: READY');

    console.log('\n✅ DEPLOYMENT VERIFICATION COMPLETE\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🎉 Production is LIVE and HEALTHY');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  });
});
