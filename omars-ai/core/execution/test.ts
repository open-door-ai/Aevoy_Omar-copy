/**
 * Browser Execution Tests
 *
 * Tests the browser execution engine with 5 scenarios.
 */

import { executeBrowser, cleanup } from './engine.js';

async function runTests() {
  console.log('='.repeat(80));
  console.log('BROWSER EXECUTION ENGINE TESTS');
  console.log('='.repeat(80));

  const tests = [
    {
      name: 'Test 1: Browser launches successfully',
      task: 'Navigate to example.com',
    },
    {
      name: 'Test 2: Extract heading from page',
      task: 'Go to example.com and extract the heading',
    },
    {
      name: 'Test 3: Simple research task',
      task: 'Find information about TypeScript',
    },
    {
      name: 'Test 4: Navigate with www prefix',
      task: 'Navigate to www.wikipedia.org',
    },
    {
      name: 'Test 5: Screenshot capture',
      task: 'Take a screenshot of example.com',
    },
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    console.log('\n' + '-'.repeat(80));
    console.log(`Running: ${test.name}`);
    console.log(`Task: ${test.task}`);
    console.log('-'.repeat(80));

    try {
      const startTime = Date.now();
      const result = await executeBrowser({ task: test.task });
      const duration = Date.now() - startTime;

      if (result.success) {
        console.log(`✅ PASS (${duration}ms)`);
        console.log(`Message: ${result.message}`);
        if (result.data) {
          console.log('Data:', JSON.stringify(result.data, null, 2).slice(0, 200));
        }
        passed++;
      } else {
        console.log(`❌ FAIL (${duration}ms)`);
        console.log(`Error: ${result.message}`);
        failed++;
      }
    } catch (error: any) {
      console.log(`❌ FAIL (exception)`);
      console.log(`Exception: ${error.message}`);
      failed++;
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('TEST SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total: ${tests.length}`);
  console.log(`Passed: ${passed} ✅`);
  console.log(`Failed: ${failed} ❌`);
  console.log('='.repeat(80));

  await cleanup();
  process.exit(failed === 0 ? 0 : 1);
}

runTests().catch(console.error);
