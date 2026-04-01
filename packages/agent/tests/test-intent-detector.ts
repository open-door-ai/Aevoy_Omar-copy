/**
 * Intent Detector Tests — LLM-based ambient intent detection
 *
 * Tests the NEW rolling-buffer + LLM detection pipeline.
 * These call the REAL Groq API (no mocks).
 *
 * Run: npx tsx tests/test-intent-detector.ts
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../apps/web/.env.local') });

import { detectIntentsFromText } from '../src/services/intent-detector.js';
import type { DetectedIntent } from '../src/services/intent-detector.js';

interface TestCase {
  input: string;
  shouldDetect: boolean;
  label: string;
  expectMultiple?: boolean;
  expectDetails?: Record<string, unknown>;
}

const TESTS: TestCase[] = [
  // ===== SCENARIO 1: Insurance claim denial =====
  {
    input: "Yeah the insurance company denied claim 47291 again. Whatever, I'll deal with it later.",
    shouldDetect: true,
    label: "Insurance dispute — claim #47291",
  },

  // ===== SCENARIO 2: Movie false positive =====
  {
    input: "In the movie last night, this guy had to cancel all his subscriptions. It was pretty funny actually.",
    shouldDetect: false,
    label: "Movie description — no action",
  },

  // ===== SCENARIO 3: Deadline moved =====
  {
    input: "My boss moved the deadline to Friday. Nobody updated the calendar.",
    shouldDetect: true,
    label: "Calendar update — deadline moved to Friday",
  },

  // ===== SCENARIO 4: Too vague =====
  {
    input: "I was thinking maybe I should switch phone plans someday.",
    shouldDetect: false,
    label: "Too vague — someday",
  },

  // ===== SCENARIO 5: Forgotten commitment =====
  {
    input: "Oh I told Sarah I'd send her those files, keep forgetting.",
    shouldDetect: true,
    label: "Send files to Sarah",
  },

  // ===== SCENARIO 6: Casual conversation (no action) =====
  {
    input: "So yeah it's been raining all week. Crazy weather. I think Saturday is supposed to be nice though. We should go to the beach. My neighbor said the waves are great this time of year. Have you tried that new coffee shop on Main Street? It's pretty good. The barista makes this amazing latte art.",
    shouldDetect: false,
    label: "Casual conversation — weather and weekend plans",
  },

  // ===== SCENARIO 7: Two actionable items =====
  {
    input: "The client call got rescheduled to Thursday at 2, and I need to send the updated deck to Mike before then.",
    shouldDetect: true,
    label: "Two actions — reschedule + send deck",
    expectMultiple: true,
  },
];

async function run() {
  console.log('\n==============================================');
  console.log('  INTENT DETECTOR — LLM TESTS (7 SCENARIOS)');
  console.log('==============================================\n');

  let passed = 0;
  let failed = 0;
  const failures: string[] = [];

  for (let i = 0; i < TESTS.length; i++) {
    const tc = TESTS[i];
    const scenarioNum = i + 1;

    try {
      console.log(`  Scenario ${scenarioNum}: ${tc.label}...`);
      const start = Date.now();
      const intents = await detectIntentsFromText(tc.input);
      const elapsed = Date.now() - start;
      const detected = intents.length > 0;

      if (detected === tc.shouldDetect) {
        passed++;

        if (detected) {
          for (const intent of intents) {
            console.log(`    ✅ PASS (${elapsed}ms) → "${intent.action}" [confidence: ${intent.confidence.toFixed(2)}]`);
            if (Object.keys(intent.details).length > 0) {
              console.log(`       Details: ${JSON.stringify(intent.details)}`);
            }
          }

          // Check multi-action expectation
          if (tc.expectMultiple && intents.length < 2) {
            console.log(`    ⚠️  Expected multiple actions, got ${intents.length}`);
          }
        } else {
          console.log(`    ✅ PASS (${elapsed}ms) → No action detected (correct)`);
        }
      } else {
        failed++;
        if (detected) {
          const actions = intents.map(i => `"${i.action}" [${i.confidence.toFixed(2)}]`).join(', ');
          const msg = `    ❌ FAIL: Expected NO DETECT, got: ${actions}`;
          console.log(msg);
          failures.push(`Scenario ${scenarioNum} (${tc.label}): ${msg}`);
        } else {
          const msg = `    ❌ FAIL: Expected DETECT, got nothing`;
          console.log(msg);
          failures.push(`Scenario ${scenarioNum} (${tc.label}): ${msg}`);
        }
      }
    } catch (err: unknown) {
      failed++;
      const msg = `    💥 ERROR: ${err instanceof Error ? err.message : String(err)}`;
      console.log(msg);
      failures.push(`Scenario ${scenarioNum} (${tc.label}): ${msg}`);
    }

    console.log('');
  }

  console.log('==============================================');
  console.log(`  RESULTS: ${passed}/${passed + failed} passed`);
  if (failed > 0) {
    console.log(`  ${failed} FAILURES:`);
    for (const f of failures) console.log(`  ${f}`);
  }
  console.log('==============================================\n');

  // Verify zero regex in the codebase
  console.log('Regex check: verifying no ACTION_INTENT_PATTERNS remain...');
  const fs = await import('fs');
  const contextEngine = fs.readFileSync(
    path.resolve(__dirname, '../src/services/context-engine.ts'), 'utf-8'
  );
  if (contextEngine.includes('ACTION_INTENT_PATTERNS')) {
    console.log('  ❌ FAIL: ACTION_INTENT_PATTERNS still exists in context-engine.ts!');
    process.exit(1);
  }
  if (contextEngine.includes('FALSE_POSITIVE_PATTERNS')) {
    console.log('  ❌ FAIL: FALSE_POSITIVE_PATTERNS still exists in context-engine.ts!');
    process.exit(1);
  }
  if (contextEngine.includes('detectAndQueueActions')) {
    console.log('  ❌ FAIL: detectAndQueueActions still exists in context-engine.ts!');
    process.exit(1);
  }
  console.log('  ✅ No regex intent patterns found. All LLM-based.\n');

  process.exit(failed > 0 ? 1 : 0);
}

run();
