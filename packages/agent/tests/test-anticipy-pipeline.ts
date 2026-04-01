/**
 * Anticipy Pipeline Integration Test
 *
 * Tests the REAL intent detection + false positive filtering.
 * Run with: npx tsx tests/test-anticipy-pipeline.ts
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load env from root
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env.local') });

import { detectAndQueueActions } from '../src/services/context-engine.js';

const FAKE_USER = 'test-pipeline-00000000-0000-0000-0000';

interface TestCase {
  input: string;
  shouldDetect: boolean;
  label: string;
}

const TESTS: TestCase[] = [
  // ===== MUST DETECT (real intent from ambient speech) =====
  { input: "I should probably cancel my gym membership before the trial ends", shouldDetect: true, label: "Cancel subscription" },
  { input: "I need to send the report to Sarah by end of day", shouldDetect: true, label: "Send email task" },
  { input: "Don't let me forget to call the insurance company tomorrow", shouldDetect: true, label: "Reminder request" },
  { input: "I keep forgetting to renew my passport", shouldDetect: true, label: "Recurring forgotten task" },
  { input: "Book me a table at Earls for Saturday at 7", shouldDetect: true, label: "Restaurant reservation" },
  { input: "I promised Dave I'd send him the proposal", shouldDetect: true, label: "Promised commitment" },
  { input: "I gotta figure out my tax situation before April", shouldDetect: true, label: "Figure out task" },
  { input: "Schedule a meeting with the design team for Tuesday", shouldDetect: true, label: "Schedule meeting" },
  { input: "My car insurance is due next month", shouldDetect: true, label: "Bill due reminder" },
  { input: "I want to look into refinancing the mortgage", shouldDetect: true, label: "Research task" },

  // ===== MUST NOT DETECT (false positives) =====
  { input: "I was watching a movie last night where this guy cancels his subscription and then calls his insurance company. It was pretty good.", shouldDetect: false, label: "Movie description (fiction)" },
  { input: "The weather is nice today", shouldDetect: false, label: "Non-actionable small talk" },
  { input: "I was thinking about maybe switching phone plans someday", shouldDetect: false, label: "Too vague (someday)" },
  { input: "What if we just canceled everything and moved to Bali", shouldDetect: false, label: "Hypothetical (what if)" },
  { input: "In the show, the character files an insurance claim", shouldDetect: false, label: "TV show fiction" },
  { input: "He said he needs to book a flight to Toronto", shouldDetect: false, label: "Quoting someone else (he said)" },
  { input: "Yeah so the meeting went well, I think they liked the proposal", shouldDetect: false, label: "Past tense recap" },
  { input: "Good morning, how are you?", shouldDetect: false, label: "Greeting" },
  { input: "This guy at work keeps forgetting to lock the door", shouldDetect: false, label: "About someone else (this guy)" },
  { input: "Imagine having to schedule everything yourself", shouldDetect: false, label: "Hypothetical (imagine)" },

  // ===== COMPLEX AMBIENT SPEECH (the real demo scenario) =====
  { input: "Yeah so the meeting went well, I think they liked the proposal. Oh by the way, I got an email from the insurance company — they denied my claim again, claim number 47291. Can you believe that? Anyway, what are you doing for dinner?", shouldDetect: false, label: "Buried complaint (no explicit action intent)" },
  { input: "Insurance called me back — still denying claim 47291. I need to deal with that.", shouldDetect: true, label: "Buried intent with 'need to deal with'" },
  { input: "So yeah the client call got pushed to Thursday at 2. I should update my calendar but whatever.", shouldDetect: true, label: "Calendar update intent" },
];

async function run() {
  console.log('\n========================================');
  console.log('  ANTICIPY PIPELINE INTEGRATION TESTS');
  console.log('========================================\n');

  let passed = 0;
  let failed = 0;
  const failures: string[] = [];

  for (const tc of TESTS) {
    try {
      // detectAndQueueActions will try to hit Supabase for dedup.
      // With a fake user ID it will likely fail the DB call but still
      // return the regex match result. That's fine — we're testing the
      // detection logic, not the DB write.
      const result = await detectAndQueueActions(tc.input, FAKE_USER, 'microphone');
      const detected = result !== null;
      const pass = detected === tc.shouldDetect;

      if (pass) {
        passed++;
        const suffix = detected ? ` → "${result!.actionText}"` : '';
        console.log(`  ✅ ${tc.label}${suffix}`);
      } else {
        failed++;
        const detail = detected
          ? `Got DETECTED: "${result!.actionText}"`
          : 'Got NOT DETECTED';
        const msg = `  ❌ ${tc.label} — expected ${tc.shouldDetect ? 'DETECT' : 'NO DETECT'}, ${detail}`;
        console.log(msg);
        failures.push(msg);
      }
    } catch (err: unknown) {
      // DB errors are expected with fake user — check if we got past the regex stage
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('supabase') || msg.includes('SUPABASE') || msg.includes('fetch')) {
        // DB error = regex matched (it tried to write), so detection = true
        const detected = true;
        const pass = detected === tc.shouldDetect;
        if (pass) {
          passed++;
          console.log(`  ✅ ${tc.label} (detected, DB write skipped)`);
        } else {
          failed++;
          const m = `  ❌ ${tc.label} — expected NO DETECT but regex matched (DB error: ${msg.substring(0, 60)})`;
          console.log(m);
          failures.push(m);
        }
      } else {
        failed++;
        const m = `  💥 ${tc.label} — ERROR: ${msg}`;
        console.log(m);
        failures.push(m);
      }
    }
  }

  console.log('\n========================================');
  console.log(`  RESULTS: ${passed}/${passed + failed} passed`);
  if (failed > 0) {
    console.log(`  ${failed} FAILURES:`);
    for (const f of failures) console.log(f);
  }
  console.log('========================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

run();
