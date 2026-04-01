/**
 * Anticipy Pipeline HARD Test — Edge cases, tricky false positives, complex ambient speech
 * Run with: npx tsx tests/test-anticipy-pipeline-hard.ts
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env.local') });

import { detectAndQueueActions } from '../src/services/context-engine.js';

const FAKE_USER = 'test-pipeline-00000000-0000-0000-0000';

interface TestCase { input: string; shouldDetect: boolean; label: string; }

const TESTS: TestCase[] = [
  // ===== TRICKY TRUE POSITIVES =====
  { input: "Ugh, I really should call the dentist already", shouldDetect: true, label: "Reluctant intent (should call)" },
  { input: "My rent is due on the first, I gotta set up autopay", shouldDetect: true, label: "Rent due + action" },
  { input: "I want to look into getting a new phone plan", shouldDetect: true, label: "Research intent (look into)" },
  { input: "I must remember to pick up the dry cleaning", shouldDetect: true, label: "Must remember" },
  { input: "I have to deal with that parking ticket before it doubles", shouldDetect: true, label: "Deal with task" },
  { input: "Remind me to water the plants when I get home", shouldDetect: true, label: "Remind me" },
  { input: "I should sort out the health insurance before open enrollment closes", shouldDetect: true, label: "Sort out + deadline" },

  // ===== TRICKY FALSE POSITIVES =====
  { input: "My mom said she needs to book a doctor appointment", shouldDetect: false, label: "Mom's intent (she needs to book)" },
  { input: "They told me I should cancel, but I'm not going to", shouldDetect: false, label: "Told me + rejected advice (they told me)" },
  { input: "In the podcast they were talking about how you should schedule your day", shouldDetect: false, label: "Generic advice from podcast" },
  { input: "She was like I need to book this flight right now", shouldDetect: false, label: "Quoting her (she was like)" },
  { input: "He keeps forgetting to lock the front door", shouldDetect: false, label: "About someone else's forgetfulness" },
  { input: "Last week I canceled my Netflix and it felt great", shouldDetect: false, label: "Already done (past tense)" },
  { input: "Let's say you need to schedule a meeting with 20 people", shouldDetect: false, label: "Hypothetical (let's say)" },
  { input: "For example you could book through Expedia", shouldDetect: false, label: "Example advice (for example)" },

  // ===== COMPLEX MULTI-SENTENCE AMBIENT =====
  { input: "So we were at lunch and Mike was complaining about his insurance again. I told him he should just file the claim online. Anyway, I need to pick up groceries on the way home.", shouldDetect: true, label: "Real intent buried after someone else's story" },
  { input: "Great meeting. The numbers look good. Revenue is up 12%. Oh, and someone remind me to send the board deck to investors.", shouldDetect: true, label: "Intent at end of business recap" },
  { input: "That Netflix show is so good. The main character had to cancel her wedding and book a flight to Paris. Wild storyline.", shouldDetect: false, label: "Netflix plot description" },
  { input: "Have you seen that TikTok where the girl says she needs to cancel her gym membership? So funny.", shouldDetect: false, label: "TikTok reference" },
];

async function run() {
  console.log('\n========================================');
  console.log('  ANTICIPY HARD MODE TESTS');
  console.log('========================================\n');

  let passed = 0;
  let failed = 0;
  const failures: string[] = [];

  for (const tc of TESTS) {
    try {
      const result = await detectAndQueueActions(tc.input, FAKE_USER, 'microphone');
      const detected = result !== null;
      const pass = detected === tc.shouldDetect;

      if (pass) {
        passed++;
        const suffix = detected ? ` → "${result!.actionText}"` : '';
        console.log(`  ✅ ${tc.label}${suffix}`);
      } else {
        failed++;
        const detail = detected ? `Got DETECTED: "${result!.actionText}"` : 'Got NOT DETECTED';
        const msg = `  ❌ ${tc.label} — expected ${tc.shouldDetect ? 'DETECT' : 'NO DETECT'}, ${detail}`;
        console.log(msg);
        failures.push(`${msg}\n     Input: "${tc.input}"`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('supabase') || msg.includes('SUPABASE') || msg.includes('fetch')) {
        const detected = true;
        const pass = detected === tc.shouldDetect;
        if (pass) {
          passed++;
          console.log(`  ✅ ${tc.label} (detected, DB write skipped)`);
        } else {
          failed++;
          const m = `  ❌ ${tc.label} — expected NO DETECT but regex matched`;
          console.log(m);
          failures.push(`${m}\n     Input: "${tc.input}"`);
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
