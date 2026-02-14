/**
 * CAPTCHA Solver Production Test Suite
 *
 * Tests all CAPTCHA types on real production sites:
 * 1. reCAPTCHA v2 (Google)
 * 2. reCAPTCHA v3 (invisible)
 * 3. hCaptcha
 * 4. Cloudflare Turnstile
 * 5. Image CAPTCHAs
 *
 * Run with: npx tsx tests/captcha-solver-test.ts
 */

import { chromium, Browser, Page } from 'playwright';
import { detectCaptcha, handleCaptchaIfPresent } from '../src/execution/captcha.js';

interface TestResult {
  site: string;
  captchaType: string;
  detected: boolean;
  solved: boolean;
  service: string;
  cost: number;
  duration: number;
  error?: string;
}

const testSites = [
  {
    name: 'Google reCAPTCHA v2 Demo',
    url: 'https://www.google.com/recaptcha/api2/demo',
    expectedType: 'recaptcha_v2',
  },
  {
    name: 'hCaptcha Demo',
    url: 'https://accounts.hcaptcha.com/demo',
    expectedType: 'hcaptcha',
  },
  {
    name: 'Cloudflare Turnstile Demo',
    url: 'https://demo.turnstile.workers.dev/',
    expectedType: 'turnstile',
  },
  {
    name: '2Captcha Demo Page',
    url: 'https://2captcha.com/demo/normal',
    expectedType: 'image',
  },
];

async function testCaptchaSolver() {
  console.log('🔍 CAPTCHA Solver Production Test Suite\n');
  console.log('=' .repeat(80));

  const results: TestResult[] = [];
  let browser: Browser | null = null;

  try {
    // Launch browser
    console.log('\n📦 Launching browser...');
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    for (const testSite of testSites) {
      console.log(`\n\n🧪 Testing: ${testSite.name}`);
      console.log('─'.repeat(80));

      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      });

      const page = await context.newPage();

      const startTime = Date.now();
      let result: TestResult = {
        site: testSite.name,
        captchaType: testSite.expectedType,
        detected: false,
        solved: false,
        service: 'none',
        cost: 0,
        duration: 0,
      };

      try {
        // Navigate to test site
        console.log(`📍 Navigating to: ${testSite.url}`);
        await page.goto(testSite.url, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });

        await page.waitForTimeout(3000); // Wait for CAPTCHA to render

        // Detect CAPTCHA
        console.log('🔍 Detecting CAPTCHA...');
        const detection = await detectCaptcha(page);

        if (detection.type === 'none') {
          console.log('❌ No CAPTCHA detected');
          result.error = 'CAPTCHA not detected on page';
        } else {
          console.log(`✅ Detected: ${detection.type}`);
          console.log(`   Site key: ${detection.siteKey || 'N/A'}`);
          result.detected = true;

          if (detection.type !== testSite.expectedType) {
            console.log(
              `⚠️  Type mismatch: expected ${testSite.expectedType}, got ${detection.type}`
            );
          }

          // Attempt to solve
          console.log('🤖 Attempting to solve...');
          const solved = await handleCaptchaIfPresent(page);

          result.solved = solved;
          result.duration = Date.now() - startTime;

          if (solved) {
            console.log(`✅ SOLVED in ${result.duration}ms`);

            // Verify solution was injected
            const hasToken = await page.evaluate(() => {
              const recaptcha = document.querySelector('[name="g-recaptcha-response"]') as HTMLTextAreaElement;
              const hcaptcha = document.querySelector('[name="h-captcha-response"]') as HTMLTextAreaElement;
              const turnstile = document.querySelector('[name="cf-turnstile-response"]') as HTMLInputElement;

              return !!(recaptcha?.value || hcaptcha?.value || turnstile?.value);
            });

            if (hasToken) {
              console.log('   ✓ Token successfully injected');
            } else {
              console.log('   ⚠️ Token not found in page (might be invisible)');
            }

            // Take success screenshot
            const screenshot = await page.screenshot({ type: 'png' });
            console.log(`   📸 Screenshot: ${screenshot.length} bytes`);
          } else {
            console.log(`❌ FAILED after ${result.duration}ms`);
            result.error = 'Solver returned false';
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error(`❌ Test failed: ${message}`);
        result.error = message;
        result.duration = Date.now() - startTime;
      }

      await context.close();
      results.push(result);
    }
  } catch (error) {
    console.error('❌ Test suite failed:', error);
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  // Print summary
  console.log('\n\n' + '='.repeat(80));
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(80));

  const detectedCount = results.filter(r => r.detected).length;
  const solvedCount = results.filter(r => r.solved).length;
  const totalCost = results.reduce((sum, r) => sum + r.cost, 0);
  const avgDuration =
    results.reduce((sum, r) => sum + r.duration, 0) / results.length;

  console.log(`\nTotal Tests:    ${results.length}`);
  console.log(`Detected:       ${detectedCount}/${results.length} (${Math.round((detectedCount / results.length) * 100)}%)`);
  console.log(`Solved:         ${solvedCount}/${detectedCount} (${detectedCount > 0 ? Math.round((solvedCount / detectedCount) * 100) : 0}%)`);
  console.log(`Total Cost:     $${totalCost.toFixed(4)}`);
  console.log(`Avg Duration:   ${Math.round(avgDuration)}ms`);

  console.log('\n📋 DETAILED RESULTS:\n');
  console.table(
    results.map(r => ({
      Site: r.site,
      Type: r.captchaType,
      Detected: r.detected ? '✓' : '✗',
      Solved: r.solved ? '✓' : '✗',
      Service: r.service,
      'Cost ($)': r.cost.toFixed(4),
      'Time (ms)': r.duration,
      Error: r.error || '-',
    }))
  );

  // Environment check
  console.log('\n🔧 ENVIRONMENT CHECK:\n');
  console.log(`CAPSOLVER_API_KEY:    ${process.env.CAPSOLVER_API_KEY ? '✓ Set' : '✗ Missing'}`);
  console.log(`TWOCAPTCHA_API_KEY:   ${process.env.TWOCAPTCHA_API_KEY ? '✓ Set' : '✗ Missing'}`);
  console.log(`ANTHROPIC_API_KEY:    ${process.env.ANTHROPIC_API_KEY ? '✓ Set' : '✗ Missing'}`);

  // Recommendations
  console.log('\n💡 RECOMMENDATIONS:\n');

  if (solvedCount === 0) {
    console.log('❌ No CAPTCHAs were solved. Check:');
    console.log('   1. API keys are valid and have balance');
    console.log('   2. Services are not rate-limited');
    console.log('   3. Network connectivity');
  } else if (solvedCount < detectedCount) {
    console.log(`⚠️  ${detectedCount - solvedCount}/${detectedCount} CAPTCHAs failed. Consider:');
    console.log('   1. Increasing retry attempts');
    console.log('   2. Adding more fallback services');
    console.log('   3. Implementing user manual solving');
  } else {
    console.log('✅ All detected CAPTCHAs solved successfully!');
    console.log(`   Success rate: ${Math.round((solvedCount / detectedCount) * 100)}%`);
    console.log(`   Average cost per solve: $${(totalCost / solvedCount).toFixed(4)}`);
  }

  console.log('\n' + '='.repeat(80));

  // Exit code
  process.exit(solvedCount === detectedCount ? 0 : 1);
}

// Run tests
testCaptchaSolver().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
