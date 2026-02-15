/**
 * Cost Tracking Test Suite
 *
 * Verifies that all billable services track costs correctly.
 */

import { calculateVoiceCost, calculateSMSCost, calculateCaptchaCost, calculateBrowserCost, calculateAICost } from '../src/utils/cost-calculator.js';

console.log('[TEST] Running cost tracking calculation tests...\n');

// Test 1: AI cost calculation
console.log('[TEST 1] AI cost calculation');
const aiCost = calculateAICost('deepseek', 1000, 500);
console.log(`  1000 input + 500 output tokens (DeepSeek) = $${aiCost.toFixed(6)}`);
console.log(`  Expected: ~$0.00044 | Actual: $${aiCost.toFixed(6)}`);
console.log(`  ${Math.abs(aiCost - 0.00044) < 0.00001 ? '✓ PASS' : '✗ FAIL'}\n`);

// Test 2: CAPTCHA cost calculation
console.log('[TEST 2] CAPTCHA cost calculation');
const captchaCost = calculateCaptchaCost('capsolver', 'recaptcha_v2');
console.log(`  reCAPTCHA v2 (CapSolver) = $${captchaCost.toFixed(6)}`);
console.log(`  Expected: $0.000800 | Actual: $${captchaCost.toFixed(6)}`);
console.log(`  ${captchaCost === 0.0008 ? '✓ PASS' : '✗ FAIL'}\n`);

// Test 3: Voice call cost calculation
console.log('[TEST 3] Voice call cost calculation');
const voiceCost = calculateVoiceCost(90); // 90 seconds = 1.5 minutes → rounds to 2
console.log(`  90 seconds (domestic) = $${voiceCost.toFixed(6)}`);
console.log(`  Expected: $0.017000 (2 min * $0.0085) | Actual: $${voiceCost.toFixed(6)}`);
console.log(`  ${voiceCost === 0.017 ? '✓ PASS' : '✗ FAIL'}\n`);

// Test 4: SMS cost calculation
console.log('[TEST 4] SMS cost calculation');
const smsCost = calculateSMSCost('+16045551234', 160);
console.log(`  160 chars domestic = $${smsCost.toFixed(6)}`);
console.log(`  Expected: $0.007900 | Actual: $${smsCost.toFixed(6)}`);
console.log(`  ${smsCost === 0.0079 ? '✓ PASS' : '✗ FAIL'}\n`);

// Test 5: Browser session cost calculation
console.log('[TEST 5] Browser session cost calculation');
const browserCost = calculateBrowserCost('browserbase');
console.log(`  Browserbase session = $${browserCost.toFixed(6)}`);
console.log(`  Expected: $0.020000 | Actual: $${browserCost.toFixed(6)}`);
console.log(`  ${browserCost === 0.02 ? '✓ PASS' : '✗ FAIL'}\n`);

// Test 6: VPS browser cost
console.log('[TEST 6] VPS browser cost calculation');
const vpsCost = calculateBrowserCost('vps');
console.log(`  VPS browser session = $${vpsCost.toFixed(6)}`);
console.log(`  Expected: $0.005000 | Actual: $${vpsCost.toFixed(6)}`);
console.log(`  ${vpsCost === 0.005 ? '✓ PASS' : '✗ FAIL'}\n`);

// Calculate total pass rate
const tests = [
  Math.abs(aiCost - 0.00044) < 0.00001,
  captchaCost === 0.0008,
  voiceCost === 0.017,
  smsCost === 0.0079,
  browserCost === 0.02,
  vpsCost === 0.005,
];

const passed = tests.filter(t => t).length;
const total = tests.length;

console.log('[TEST] ========================================');
console.log(`[TEST] RESULTS: ${passed}/${total} tests passed`);
console.log('[TEST] ========================================\n');

if (passed === total) {
  console.log('[TEST] ✓ ALL TESTS PASSED - Cost calculations are correct!\n');
  process.exit(0);
} else {
  console.error('[TEST] ✗ SOME TESTS FAILED - See errors above\n');
  process.exit(1);
}
