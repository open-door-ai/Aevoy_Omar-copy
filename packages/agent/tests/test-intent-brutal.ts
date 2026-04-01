/**
 * BRUTAL Intent Detection Tests
 *
 * Edge cases that would break any regex system.
 * Ambiguous intent, sarcasm, mixed languages, interruptions,
 * overlapping speakers, mumbling, corrections mid-sentence.
 *
 * Run: npx tsx tests/test-intent-brutal.ts
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../apps/web/.env.local') });

import { ConversationBuffer, detectIntentsFromBuffer } from '../src/services/intent-detector.js';

interface Test {
  label: string;
  chunks: string[];
  shouldDetect: boolean;
  expectContains?: string[];
}

const TESTS: Test[] = [

  // ===== SARCASM — should NOT detect =====
  {
    label: "Sarcasm — 'oh yeah I'll totally cancel everything'",
    chunks: [
      "Oh yeah sure, I'll just cancel all my subscriptions and live in a cave.",
      "That sounds like a great plan.",
      "While I'm at it I should probably sell my car and become a monk.",
      "You're hilarious.",
    ],
    shouldDetect: false,
  },

  // ===== CORRECTION MID-SENTENCE =====
  {
    label: "Self-correction — changed their mind mid-thought",
    chunks: [
      "I should probably cancel my Netflix actually wait no forget that.",
      "I just remembered they're releasing that new season next week.",
      "I'll keep it for now.",
    ],
    shouldDetect: false,
  },

  // ===== ALREADY DONE =====
  {
    label: "Already completed — past tense",
    chunks: [
      "So I finally called the insurance company yesterday.",
      "Filed the dispute, gave them the claim number and everything.",
      "They said they'd review it within 10 business days.",
      "So that's taken care of at least.",
    ],
    shouldDetect: false,
  },

  // ===== EXTREMELY SUBTLE INTENT =====
  {
    label: "Subtle — 'the registration expires next month' (implies renewal needed)",
    chunks: [
      "We were talking about the car the other day.",
      "I noticed the registration sticker is looking faded.",
      "Checked and it expires next month actually.",
      "I keep putting it off but yeah.",
    ],
    shouldDetect: true,
    expectContains: ["registration"],
  },

  // ===== SOMEONE ELSE ASKING THE SPEAKER TO DO SOMETHING =====
  {
    label: "Relaying a request — 'my boss asked me to prepare the report'",
    chunks: [
      "Oh yeah so my boss pulled me aside after the meeting.",
      "She asked me to put together the quarterly report by Friday.",
      "I haven't even started on it yet.",
      "It's gonna be a long week.",
    ],
    shouldDetect: true,
    expectContains: ["report"],
  },

  // ===== NESTED FICTION INSIDE REAL CONVERSATION =====
  {
    label: "Fiction sandwich — real intent between two fiction references",
    chunks: [
      "That podcast about productivity hacks was interesting.",
      "The host was saying how he cancels all his meetings on Fridays.",
      "Speaking of which, I really need to reschedule my dentist appointment, I missed it last week.",
      "Anyway the podcast also had this guest who automates literally everything in his life.",
      "Like he has robots cleaning his house and stuff.",
    ],
    shouldDetect: true,
    expectContains: ["dentist"],
  },

  // ===== EMOTIONAL OUTBURST WITH REAL TASK =====
  {
    label: "Angry rant with a real overdue bill",
    chunks: [
      "I'm so sick of this honestly.",
      "Everything is expensive and nothing works.",
      "And now I got a late notice for the electric bill.",
      "Like I completely forgot it was due on the 15th.",
      "They're gonna charge me a 25 dollar late fee if I don't pay by tomorrow.",
      "This is ridiculous.",
    ],
    shouldDetect: true,
    expectContains: ["electric", "bill"],
  },

  // ===== TRAILING OFF / UNFINISHED THOUGHT =====
  {
    label: "Trailing off — 'I should probably... anyway'",
    chunks: [
      "I don't know man, things have been weird.",
      "I should probably start looking for a new...",
      "anyway, it doesn't matter right now.",
      "Let's just focus on getting through this project.",
    ],
    shouldDetect: false,
  },

  // ===== DELEGATION TO SOMEONE ELSE =====
  {
    label: "Delegating — 'I told Jake to handle it'",
    chunks: [
      "The server's been acting up all morning.",
      "I told Jake to handle the restart and check the logs.",
      "He should have it sorted by noon.",
      "Not my problem anymore.",
    ],
    shouldDetect: false,
  },

  // ===== TWO SPEAKERS — only one has intent =====
  {
    label: "Two speakers — 'you should cancel' vs 'I need to renew'",
    chunks: [
      "You should really cancel that gym membership you never use.",
      "Yeah probably. But actually I need to renew my passport.",
      "It expired like three months ago and I have a trip in June.",
      "Oh that's cutting it close. Those take forever now.",
    ],
    shouldDetect: true,
    expectContains: ["passport"],
  },

  // ===== EXTREMELY LONG RAMBLE WITH ONE NUGGET =====
  {
    label: "Long ramble — one real task buried in 150 words of nothing",
    chunks: [
      "So we went to that restaurant last weekend, the Italian place on the corner.",
      "The pasta was okay I guess, not as good as that place we went to in New York.",
      "Remember that trip? That was like three years ago already.",
      "Time flies man. Anyway I saw Mike there with his new girlfriend.",
      "She seemed nice. They were sitting by the window.",
      "Oh that reminds me, I need to email the landlord about the broken dishwasher.",
      "It's been making this weird noise for like two weeks.",
      "But yeah the restaurant was fine. We had the tiramisu for dessert.",
      "That was actually pretty good. We should go back sometime.",
      "Maybe for your birthday or something.",
    ],
    shouldDetect: true,
    expectContains: ["landlord"],
  },

  // ===== NEWS / CURRENT EVENTS =====
  {
    label: "Discussing news — not personal intent",
    chunks: [
      "Did you hear about that data breach at the bank?",
      "Apparently millions of people need to cancel their credit cards.",
      "The CEO said they're going to file a class action lawsuit.",
      "It's all over the news. Pretty scary stuff.",
      "I'm glad I don't bank there.",
    ],
    shouldDetect: false,
  },

  // ===== PLANNING SOMEONE ELSE'S EVENT =====
  {
    label: "Planning a surprise party — speaker needs to act",
    chunks: [
      "Okay so for Lisa's surprise party.",
      "I need to book the venue by Wednesday or we lose the deposit.",
      "And I gotta order the cake from that bakery on Main Street.",
      "Sarah said she'd handle the decorations.",
      "Can you take care of the playlist?",
    ],
    shouldDetect: true,
    expectContains: ["venue"],
  },
];

async function run() {
  console.log('\n==========================================================');
  console.log('  BRUTAL INTENT DETECTION TESTS — EDGE CASES');
  console.log('==========================================================\n');

  let passed = 0;
  let failed = 0;
  const failures: string[] = [];

  for (let i = 0; i < TESTS.length; i++) {
    const tc = TESTS[i];
    console.log(`  ${i + 1}. ${tc.label}`);

    const buffer = new ConversationBuffer();
    for (const chunk of tc.chunks) buffer.append(chunk);

    const sessionId = `brutal-${i}-${Date.now()}`;
    const start = Date.now();

    try {
      const intents = await detectIntentsFromBuffer(buffer, sessionId);
      const elapsed = Date.now() - start;
      const detected = intents.length > 0;

      let ok = detected === tc.shouldDetect;

      if (ok && tc.expectContains && detected) {
        const all = intents.map(i => i.action.toLowerCase()).join(' ');
        for (const exp of tc.expectContains) {
          if (!all.includes(exp.toLowerCase())) {
            ok = false;
            console.log(`     ⚠️ Expected "${exp}" in: ${all}`);
          }
        }
      }

      if (ok) {
        passed++;
        if (detected) {
          for (const intent of intents) {
            console.log(`     ✅ (${elapsed}ms) "${intent.action}" [${intent.confidence.toFixed(2)}]`);
          }
        } else {
          console.log(`     ✅ (${elapsed}ms) No action (correct)`);
        }
      } else {
        failed++;
        if (detected) {
          for (const intent of intents) {
            console.log(`     ❌ FALSE POSITIVE: "${intent.action}" [${intent.confidence.toFixed(2)}] — ${intent.reasoning}`);
          }
        } else {
          console.log(`     ❌ MISSED: Expected detection, got nothing`);
        }
        failures.push(`${i + 1}. ${tc.label}`);
      }
    } catch (err: unknown) {
      failed++;
      console.log(`     💥 ${err instanceof Error ? err.message : String(err)}`);
      failures.push(`${i + 1}. ${tc.label} (error)`);
    }

    // Rate limit buffer
    if (i < TESTS.length - 1) await new Promise(r => setTimeout(r, 1500));
  }

  console.log('\n==========================================================');
  console.log(`  RESULTS: ${passed}/${passed + failed}`);
  if (failed > 0) {
    console.log(`  FAILURES:`);
    for (const f of failures) console.log(`    ${f}`);
  }
  console.log('==========================================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

run();
