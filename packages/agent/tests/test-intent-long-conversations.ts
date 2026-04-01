/**
 * Intent Detector — REAL CONVERSATION TESTS
 *
 * Simulates actual human conversations being picked up by a mic on a table.
 * Feeds text chunk by chunk into the ConversationBuffer like Deepgram would,
 * then checks what the LLM detects from the full accumulated context.
 *
 * Run: npx tsx tests/test-intent-long-conversations.ts
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../apps/web/.env.local') });

import { ConversationBuffer, detectIntentsFromBuffer } from '../src/services/intent-detector.js';
import type { DetectedIntent } from '../src/services/intent-detector.js';

interface ConversationTest {
  label: string;
  /** Chunks arrive over time like Deepgram sends them */
  chunks: string[];
  shouldDetect: boolean;
  /** What kind of action we expect (substring match) */
  expectActionContains?: string[];
}

const TESTS: ConversationTest[] = [

  // ===== TEST 1: Business meeting with buried calendar change =====
  {
    label: "Business meeting — buried calendar change + action item",
    chunks: [
      "So the Q2 numbers are looking pretty strong actually.",
      "Revenue is up about twelve percent over last quarter.",
      "The marketing campaign did way better than we expected.",
      "I think we should keep the budget the same for Q3 though, don't want to get ahead of ourselves.",
      "Oh by the way, the board meeting got moved to next Wednesday at 10 AM.",
      "Nobody sent the update yet so half the team probably doesn't know.",
      "Anyway, where were we. Yeah so the product roadmap.",
      "I think we need to prioritize the mobile app redesign.",
      "Users have been complaining about the checkout flow for months.",
    ],
    shouldDetect: true,
    expectActionContains: ["board meeting"],
  },

  // ===== TEST 2: Pure small talk — NO action =====
  {
    label: "Pure small talk — nothing actionable",
    chunks: [
      "Man the traffic was insane this morning.",
      "I swear it took me like 45 minutes just to get across the bridge.",
      "Did you see the game last night? That last quarter was wild.",
      "I can't believe they came back from a 20 point deficit.",
      "Yeah we should grab lunch at that new Thai place sometime.",
      "My buddy said their pad thai is the best he's ever had.",
      "The weather's supposed to be nice this weekend though.",
      "Maybe I'll take the kids to the park or something.",
    ],
    shouldDetect: false,
  },

  // ===== TEST 3: Someone venting about work with ONE real task buried in it =====
  {
    label: "Venting session with one real forgotten task",
    chunks: [
      "Dude this week has been insane.",
      "My manager keeps piling on projects and I'm already behind on three things.",
      "And then HR emails me about some compliance training that's overdue.",
      "Like I don't have time for a two hour online course right now.",
      "Oh shit, I totally forgot, I was supposed to send the contract to the client by end of day today.",
      "That's been sitting in my drafts for two days.",
      "Whatever, I'll figure it out.",
      "Hey did you try that new coffee shop on 4th street?",
    ],
    shouldDetect: true,
    expectActionContains: ["contract", "client"],
  },

  // ===== TEST 4: Movie and TV discussion — ALL fiction =====
  {
    label: "Movie and TV discussion — fiction only",
    chunks: [
      "So I finally started watching that show everyone's been talking about.",
      "The main character is this woman who has to cancel all her credit cards because she got her identity stolen.",
      "And then she has to file a police report and dispute like twenty charges.",
      "It's crazy because the guy who stole her identity starts booking flights and hotel rooms in her name.",
      "She ends up having to call every single company to cancel everything.",
      "The plot twist at the end was insane though, I won't spoil it.",
      "Have you seen it? You should watch it.",
    ],
    shouldDetect: false,
  },

  // ===== TEST 5: Real insurance problem buried in long conversation =====
  {
    label: "Insurance denial buried in casual lunch conversation",
    chunks: [
      "So yeah the kids are doing good, Sarah just started soccer.",
      "She's actually pretty good for a six year old.",
      "Mike's been busy with work, you know how it is.",
      "Oh man, I almost forgot to tell you.",
      "The insurance company called me back about that water damage claim.",
      "They denied it again. Claim number 47291.",
      "Said it was pre-existing damage which is total bullshit because we just had the inspection done in January.",
      "I need to file an appeal before the 30 day window closes.",
      "Anyway, how's your mom doing? I heard she was in the hospital.",
    ],
    shouldDetect: true,
    expectActionContains: ["insurance", "appeal"],
  },

  // ===== TEST 6: Multiple people talking, only ONE person's intent matters =====
  {
    label: "Group conversation — third person intents should be ignored",
    chunks: [
      "Tom was saying he needs to cancel his gym membership.",
      "And Jessica told me she has to file her taxes before the deadline.",
      "Dave keeps forgetting to schedule his dentist appointment.",
      "Everyone's got stuff going on I guess.",
      "Me, I'm just trying to get through the week.",
      "Although I do need to remember to pick up my prescription from CVS.",
      "The pharmacy closes at 9 so I should probably go after this.",
    ],
    shouldDetect: true,
    expectActionContains: ["prescription"],
  },

  // ===== TEST 7: Rapid topic switches with one real commitment =====
  {
    label: "Rapid topic switching — one real promise made",
    chunks: [
      "The new iPhone looks cool but I'm not upgrading yet.",
      "My phone works fine honestly.",
      "Oh by the way I promised Dave I'd send him the presentation slides from Tuesday's meeting.",
      "He wasn't there because his kid was sick.",
      "Speaking of which, have you gotten your flu shot yet?",
      "My doctor said they have them in stock now.",
      "I should probably get mine too at some point.",
      "Anyway what time is your flight tomorrow?",
    ],
    shouldDetect: true,
    expectActionContains: ["Dave", "presentation", "slides"],
  },

  // ===== TEST 8: Advice and hypotheticals — NOT actionable =====
  {
    label: "Giving advice and hypotheticals — not the speaker's intent",
    chunks: [
      "If I were you I'd cancel that subscription honestly.",
      "You're paying like 50 bucks a month for something you never use.",
      "What if you just switched to the free tier?",
      "That's what my sister did and she says it's basically the same.",
      "Or you could try that other service, what's it called.",
      "Imagine if we could just automate all our bills.",
      "Someday they'll probably have AI that does all of that for you.",
      "In a perfect world you'd never have to think about it.",
    ],
    shouldDetect: false,
  },
];

async function run() {
  console.log('\n==========================================================');
  console.log('  LONG CONVERSATION TESTS — REAL HUMAN-LIKE TRANSCRIPTS');
  console.log('==========================================================\n');

  let passed = 0;
  let failed = 0;
  const failures: string[] = [];

  for (let i = 0; i < TESTS.length; i++) {
    const tc = TESTS[i];
    console.log(`  TEST ${i + 1}: ${tc.label}`);
    console.log(`  ${'─'.repeat(60)}`);

    // Build up the buffer chunk by chunk (simulating Deepgram)
    const buffer = new ConversationBuffer();
    for (const chunk of tc.chunks) {
      buffer.append(chunk);
    }

    console.log(`  Buffer: ${buffer.getWordCount()} words across ${tc.chunks.length} chunks`);

    const sessionId = `test-long-${i}-${Date.now()}`;
    const start = Date.now();

    try {
      const intents = await detectIntentsFromBuffer(buffer, sessionId);
      const elapsed = Date.now() - start;
      const detected = intents.length > 0;

      if (detected === tc.shouldDetect) {
        // Check expected action content if specified
        let contentMatch = true;
        if (tc.expectActionContains && detected) {
          const allActions = intents.map(i => i.action.toLowerCase()).join(' ');
          for (const expected of tc.expectActionContains) {
            if (!allActions.includes(expected.toLowerCase())) {
              contentMatch = false;
              console.log(`  ⚠️  Expected action to contain "${expected}" but got: ${allActions}`);
            }
          }
        }

        if (contentMatch) {
          passed++;
          if (detected) {
            for (const intent of intents) {
              console.log(`  ✅ PASS (${elapsed}ms) → "${intent.action}" [${intent.confidence.toFixed(2)}]`);
              if (Object.keys(intent.details).length > 0) {
                console.log(`     Details: ${JSON.stringify(intent.details)}`);
              }
              console.log(`     Reasoning: ${intent.reasoning}`);
            }
          } else {
            console.log(`  ✅ PASS (${elapsed}ms) → No action detected (correct)`);
          }
        } else {
          failed++;
          failures.push(`Test ${i + 1}: ${tc.label} — action content didn't match expectations`);
        }
      } else {
        failed++;
        if (detected) {
          const actions = intents.map(i => `"${i.action}" [${i.confidence.toFixed(2)}]`).join(', ');
          console.log(`  ❌ FAIL (${elapsed}ms): Expected NO DETECT, got: ${actions}`);
          for (const intent of intents) {
            console.log(`     Reasoning: ${intent.reasoning}`);
          }
          failures.push(`Test ${i + 1}: ${tc.label} — false positive`);
        } else {
          console.log(`  ❌ FAIL (${elapsed}ms): Expected DETECT, got nothing`);
          failures.push(`Test ${i + 1}: ${tc.label} — missed intent`);
        }
      }
    } catch (err: unknown) {
      failed++;
      console.log(`  💥 ERROR: ${err instanceof Error ? err.message : String(err)}`);
      failures.push(`Test ${i + 1}: ${tc.label} — error: ${err instanceof Error ? err.message : String(err)}`);
    }

    console.log('');

    // Wait between tests to avoid Groq rate limiting
    if (i < TESTS.length - 1) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  console.log('==========================================================');
  console.log(`  RESULTS: ${passed}/${passed + failed} passed`);
  if (failed > 0) {
    console.log(`  ${failed} FAILURES:`);
    for (const f of failures) console.log(`    ${f}`);
  }
  console.log('==========================================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

run();
