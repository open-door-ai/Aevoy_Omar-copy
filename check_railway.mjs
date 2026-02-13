import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 }
  });
  const page = await context.newPage();

  try {
    console.log('Navigating to Railway agent service...');
    await page.goto('https://railway.com/project/789bf18d-e91a-46b0-b3ab-4c2c5ba5becf/service/9d3ebbf7-35aa-4c58-a822-42b89861b129', {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    // Wait a bit for the page to fully load
    await page.waitForTimeout(3000);

    // Take initial screenshot
    await page.screenshot({ path: '/tmp/railway_initial.png', fullPage: true });
    console.log('Initial screenshot saved to /tmp/railway_initial.png');

    // Check if we need to login
    const needsLogin = await page.locator('button:has-text("Log in")').isVisible().catch(() => false);
    
    if (needsLogin) {
      console.log('Login required - cannot proceed without credentials');
      console.log('Current URL:', page.url());
      await browser.close();
      process.exit(1);
    }

    // Look for Deployments tab/section
    console.log('Looking for Deployments section...');
    
    // Try multiple selectors for deployments
    const deploymentsSelectors = [
      'button:has-text("Deployments")',
      'a:has-text("Deployments")',
      '[data-id="deployments"]',
      'nav a:has-text("Deployments")',
      'div:has-text("Deployments")'
    ];

    let deploymentsFound = false;
    for (const selector of deploymentsSelectors) {
      const element = page.locator(selector).first();
      const isVisible = await element.isVisible().catch(() => false);
      if (isVisible) {
        console.log(`Found Deployments via selector: ${selector}`);
        await element.click();
        await page.waitForTimeout(2000);
        deploymentsFound = true;
        break;
      }
    }

    if (!deploymentsFound) {
      console.log('Deployments tab not found, checking current page content...');
    }

    // Take screenshot after attempting to click deployments
    await page.screenshot({ path: '/tmp/railway_deployments.png', fullPage: true });
    console.log('Deployments screenshot saved to /tmp/railway_deployments.png');

    // Look for deployment status indicators
    const statusSelectors = [
      '[data-status]',
      '.deployment-status',
      'div:has-text("SUCCESS")',
      'div:has-text("FAILED")',
      'div:has-text("BUILDING")',
      'div:has-text("DEPLOYING")',
      'div:has-text("Active")',
      'div:has-text("Failed")'
    ];

    console.log('\nChecking for deployment statuses...');
    for (const selector of statusSelectors) {
      const elements = await page.locator(selector).all();
      if (elements.length > 0) {
        console.log(`Found ${elements.length} elements matching: ${selector}`);
        for (let i = 0; i < Math.min(3, elements.length); i++) {
          const text = await elements[i].textContent().catch(() => '');
          if (text) {
            console.log(`  - ${text.trim()}`);
          }
        }
      }
    }

    // Get page text content for analysis
    const bodyText = await page.locator('body').textContent();
    
    // Check for commit hashes
    const hasCommit1 = bodyText?.includes('d9325cb') || false;
    const hasCommit2 = bodyText?.includes('916ca92') || false;
    
    console.log('\nCommit hash detection:');
    console.log(`  - d9325cb (CRITICAL FIX): ${hasCommit1 ? 'FOUND' : 'NOT FOUND'}`);
    console.log(`  - 916ca92 (FIX): ${hasCommit2 ? 'FOUND' : 'NOT FOUND'}`);

    // Look for error indicators
    const errorKeywords = ['error', 'failed', 'failure', 'crashed'];
    console.log('\nError indicators:');
    for (const keyword of errorKeywords) {
      const count = (bodyText?.toLowerCase().match(new RegExp(keyword, 'g')) || []).length;
      if (count > 0) {
        console.log(`  - "${keyword}": ${count} occurrences`);
      }
    }

    // Look for success indicators
    const successKeywords = ['success', 'active', 'running', 'healthy'];
    console.log('\nSuccess indicators:');
    for (const keyword of successKeywords) {
      const count = (bodyText?.toLowerCase().match(new RegExp(keyword, 'g')) || []).length;
      if (count > 0) {
        console.log(`  - "${keyword}": ${count} occurrences`);
      }
    }

  } catch (error) {
    console.error('Error:', error);
    await page.screenshot({ path: '/tmp/railway_error.png', fullPage: true });
    console.log('Error screenshot saved to /tmp/railway_error.png');
  } finally {
    await browser.close();
  }
})();
