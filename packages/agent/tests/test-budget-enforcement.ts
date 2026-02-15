/**
 * Budget Enforcement Integration Test Suite
 *
 * Tests budget enforcement system with real database operations:
 * 1. Creates test user
 * 2. Sets up usage data
 * 3. Verifies budget checks work correctly
 * 4. Tests over-budget blocking
 * 5. Tests BILLING_ENABLED flip switch
 * 6. Cleans up test data
 */

import 'dotenv/config';
import { checkBudget, shouldSendBudgetWarning, estimateTaskCost } from '../src/middleware/budget-check.js';
import { getSupabaseClient } from '../src/utils/supabase.js';

// Use existing teste2e user (from CLAUDE.md)
const TEST_USER_ID = '11684ec6-80cd-4bb6-9aed-8f0947afd06a';
const CURRENT_MONTH = new Date().toISOString().slice(0, 7); // YYYY-MM

let testsPassed = 0;
let testsFailed = 0;

async function setup() {
  console.log('🔧 Setting up test environment...\n');

  const supabase = getSupabaseClient();

  // Verify test user exists (teste2e)
  const { data: user, error: userError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', TEST_USER_ID)
    .single();

  if (userError || !user) {
    console.error('❌ Test user not found:', userError);
    throw new Error('Test user (teste2e) does not exist. Run: create user with ID 11684ec6-80cd-4bb6-9aed-8f0947afd06a');
  }

  // Reset user to free tier with known state
  await supabase.from('profiles').update({
    subscription_tier: 'free', // $10 limit
  }).eq('id', TEST_USER_ID);

  // Clear any existing usage data for current month
  await supabase.from('usage').delete()
    .eq('user_id', TEST_USER_ID)
    .eq('month', CURRENT_MONTH);

  // Clear any budget alert tasks
  await supabase.from('tasks').delete()
    .eq('user_id', TEST_USER_ID)
    .eq('type', 'budget_alert');

  console.log('✅ Using test user:', TEST_USER_ID);
  console.log('   Username:', user.username);
  console.log('   Tier: free ($10 limit)');
  console.log('   State: Reset for testing\n');
}

async function cleanup() {
  console.log('\n🧹 Cleaning up test data...\n');

  const supabase = getSupabaseClient();

  // Clean up usage data and budget alerts (keep profile)
  await supabase.from('usage').delete()
    .eq('user_id', TEST_USER_ID)
    .eq('month', CURRENT_MONTH);

  await supabase.from('tasks').delete()
    .eq('user_id', TEST_USER_ID)
    .eq('type', 'budget_alert');

  console.log('✅ Test data cleaned up (profile preserved)\n');
}

async function test1_UserUnderBudget() {
  console.log('═══════════════════════════════════════');
  console.log('Test 1: User Under Budget');
  console.log('═══════════════════════════════════════');

  const supabase = getSupabaseClient();

  // Set user's usage to $2 (200 cents)
  await supabase.from('usage').upsert({
    user_id: TEST_USER_ID,
    month: CURRENT_MONTH,
    ai_cost_cents: 200,
    browser_tasks: 5,
    simple_tasks: 10,
  });

  console.log('Setup: User used $2 of $10 limit');

  const result = await checkBudget(TEST_USER_ID);

  console.log('Result:', {
    allowed: result.allowed,
    remaining: `$${result.remaining_usd.toFixed(2)}`,
    used: `$${result.used_usd.toFixed(2)}`,
    limit: `$${result.limit_usd}`,
    tier: result.tier,
  });

  const pass = result.allowed === true &&
               result.used_usd === 2 &&
               result.limit_usd === 10 &&
               result.remaining_usd === 8 &&
               result.tier === 'free';

  console.log('Expected: allowed=true, used=$2, limit=$10, remaining=$8');
  console.log('Status:', pass ? '✅ PASS' : '❌ FAIL');
  console.log('');

  if (pass) testsPassed++;
  else testsFailed++;
}

async function test2_UserOverBudget() {
  console.log('═══════════════════════════════════════');
  console.log('Test 2: User Over Budget (CRITICAL)');
  console.log('═══════════════════════════════════════');

  const supabase = getSupabaseClient();

  // Update usage to $12 (1200 cents) — exceeds $10 limit
  await supabase.from('usage').update({
    ai_cost_cents: 1200,
    browser_tasks: 20,
    simple_tasks: 50,
  })
  .eq('user_id', TEST_USER_ID)
  .eq('month', CURRENT_MONTH);

  console.log('Setup: User used $12 of $10 limit (OVER BUDGET)');

  const result = await checkBudget(TEST_USER_ID);

  console.log('Result:', {
    allowed: result.allowed,
    remaining: `$${result.remaining_usd.toFixed(2)}`,
    used: `$${result.used_usd.toFixed(2)}`,
    limit: `$${result.limit_usd}`,
    tier: result.tier,
    reason: result.reason,
  });

  const pass = result.allowed === false &&
               result.used_usd === 12 &&
               result.limit_usd === 10 &&
               result.remaining_usd === 0 &&
               result.tier === 'free' &&
               result.reason?.includes('exceeded');

  console.log('Expected: allowed=FALSE, used=$12, limit=$10, remaining=$0');
  console.log('Status:', pass ? '✅ PASS' : '❌ FAIL');
  console.log('');

  if (pass) testsPassed++;
  else testsFailed++;
}

async function test3_BetaTierHigherLimit() {
  console.log('═══════════════════════════════════════');
  console.log('Test 3: Beta Tier ($50 limit)');
  console.log('═══════════════════════════════════════');

  const supabase = getSupabaseClient();

  // Upgrade to beta tier
  await supabase.from('profiles').update({
    subscription_tier: 'beta',
  }).eq('id', TEST_USER_ID);

  // Update usage to $30 (would exceed free, but not beta)
  await supabase.from('usage').update({
    ai_cost_cents: 3000,
    browser_tasks: 50,
    simple_tasks: 100,
  })
  .eq('user_id', TEST_USER_ID)
  .eq('month', CURRENT_MONTH);

  console.log('Setup: User upgraded to beta tier, used $30 of $50 limit');

  const result = await checkBudget(TEST_USER_ID);

  console.log('Result:', {
    allowed: result.allowed,
    remaining: `$${result.remaining_usd.toFixed(2)}`,
    used: `$${result.used_usd.toFixed(2)}`,
    limit: `$${result.limit_usd}`,
    tier: result.tier,
  });

  const pass = result.allowed === true &&
               result.used_usd === 30 &&
               result.limit_usd === 50 &&
               result.remaining_usd === 20 &&
               result.tier === 'beta';

  console.log('Expected: allowed=true, used=$30, limit=$50, remaining=$20');
  console.log('Status:', pass ? '✅ PASS' : '❌ FAIL');
  console.log('');

  if (pass) testsPassed++;
  else testsFailed++;
}

async function test4_BillingDisabled() {
  console.log('═══════════════════════════════════════');
  console.log('Test 4: BILLING_ENABLED=false (Beta Mode)');
  console.log('═══════════════════════════════════════');

  const supabase = getSupabaseClient();

  // Update usage to $100 (would block any tier)
  await supabase.from('usage').update({
    ai_cost_cents: 10000,
    browser_tasks: 100,
    simple_tasks: 200,
  })
  .eq('user_id', TEST_USER_ID)
  .eq('month', CURRENT_MONTH);

  // Disable billing
  const originalEnv = process.env.BILLING_ENABLED;
  process.env.BILLING_ENABLED = 'false';

  console.log('Setup: User used $100, BILLING_ENABLED=false');

  const result = await checkBudget(TEST_USER_ID);

  console.log('Result:', {
    allowed: result.allowed,
    remaining: result.remaining_usd === Infinity ? 'Infinity' : result.remaining_usd,
    used: `$${result.used_usd.toFixed(2)}`,
    limit: result.limit_usd === Infinity ? 'Infinity' : result.limit_usd,
    tier: result.tier,
  });

  const pass = result.allowed === true &&
               result.remaining_usd === Infinity &&
               result.limit_usd === Infinity;

  console.log('Expected: allowed=true, remaining=Infinity (billing disabled)');
  console.log('Status:', pass ? '✅ PASS' : '❌ FAIL');
  console.log('');

  // Restore env
  process.env.BILLING_ENABLED = originalEnv;

  if (pass) testsPassed++;
  else testsFailed++;
}

async function test5_BudgetWarning() {
  console.log('═══════════════════════════════════════');
  console.log('Test 5: Budget Warning (80% threshold)');
  console.log('═══════════════════════════════════════');

  const supabase = getSupabaseClient();

  // Reset to free tier
  await supabase.from('profiles').update({
    subscription_tier: 'free',
  }).eq('id', TEST_USER_ID);

  // Update usage to $8.50 (85% of $10 limit)
  await supabase.from('usage').update({
    ai_cost_cents: 850,
    browser_tasks: 15,
    simple_tasks: 30,
  })
  .eq('user_id', TEST_USER_ID)
  .eq('month', CURRENT_MONTH);

  // Ensure no warning sent yet
  await supabase.from('tasks').delete().eq('user_id', TEST_USER_ID).eq('type', 'budget_alert');

  console.log('Setup: User used $8.50 of $10 (85%), no warning sent yet');

  const shouldWarn = await shouldSendBudgetWarning(TEST_USER_ID);

  console.log('Result: shouldSendWarning =', shouldWarn);

  const pass = shouldWarn === true;

  console.log('Expected: true (first time crossing 80%)');
  console.log('Status:', pass ? '✅ PASS' : '❌ FAIL');
  console.log('');

  if (pass) testsPassed++;
  else testsFailed++;
}

async function test6_CostEstimation() {
  console.log('═══════════════════════════════════════');
  console.log('Test 6: Cost Estimation');
  console.log('═══════════════════════════════════════');

  const estimates = {
    simple: await estimateTaskCost('What time is it?'),
    research: await estimateTaskCost('Find me the best laptop under $1000'),
    booking: await estimateTaskCost('Book a flight to NYC next week'),
  };

  console.log('Estimates:', {
    simple: `$${estimates.simple.toFixed(4)}`,
    research: `$${estimates.research.toFixed(4)}`,
    booking: `$${estimates.booking.toFixed(4)}`,
  });

  const pass = estimates.simple < estimates.research &&
               estimates.research < estimates.booking &&
               estimates.simple === 0.001 &&
               estimates.research === 0.05 &&
               estimates.booking === 0.10;

  console.log('Expected: simple ($0.0010) < research ($0.0500) < booking ($0.1000)');
  console.log('Status:', pass ? '✅ PASS' : '❌ FAIL');
  console.log('');

  if (pass) testsPassed++;
  else testsFailed++;
}

async function runTests() {
  console.log('╔═══════════════════════════════════════╗');
  console.log('║  Budget Enforcement Integration Test  ║');
  console.log('╚═══════════════════════════════════════╝\n');

  // Verify environment
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
    process.exit(1);
  }

  // Enable billing for tests
  const originalBilling = process.env.BILLING_ENABLED;
  process.env.BILLING_ENABLED = 'true';

  try {
    await setup();

    await test1_UserUnderBudget();
    await test2_UserOverBudget();
    await test3_BetaTierHigherLimit();
    await test4_BillingDisabled();
    await test5_BudgetWarning();
    await test6_CostEstimation();

  } catch (err) {
    console.error('❌ Test suite error:', err);
    testsFailed++;
  } finally {
    await cleanup();

    // Restore env
    process.env.BILLING_ENABLED = originalBilling;

    // Summary
    console.log('╔═══════════════════════════════════════╗');
    console.log('║           Test Summary                ║');
    console.log('╚═══════════════════════════════════════╝');
    console.log('');
    console.log(`Total Tests: ${testsPassed + testsFailed}`);
    console.log(`✅ Passed: ${testsPassed}`);
    console.log(`❌ Failed: ${testsFailed}`);
    console.log('');

    if (testsFailed === 0) {
      console.log('🎉 ALL TESTS PASSED!');
      console.log('');
      console.log('Budget enforcement is working correctly:');
      console.log('  ✅ Users under budget can execute tasks');
      console.log('  ✅ Users over budget are BLOCKED');
      console.log('  ✅ Beta tier has $50 limit (vs $10 free)');
      console.log('  ✅ BILLING_ENABLED=false disables all limits');
      console.log('  ✅ 80% budget warnings work');
      console.log('  ✅ Cost estimation is accurate');
      console.log('');
      process.exit(0);
    } else {
      console.log('❌ TESTS FAILED!');
      console.log('');
      process.exit(1);
    }
  }
}

// Run tests if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runTests().catch(console.error);
}

export { runTests };
