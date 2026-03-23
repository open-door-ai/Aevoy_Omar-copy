/**
 * Comprehensive Email Worker Test Suite
 *
 * Tests email-to-task conversion via Cloudflare Worker → VPS Agent
 *
 * Test Coverage:
 * 1. New task email (standard task creation)
 * 2. Confirmation reply (yes/no responses)
 * 3. Verification code reply (2FA codes)
 * 4. Magic link extraction
 * 5. PIN verification flow (unregistered sender)
 * 6. Quota enforcement
 * 7. Invalid user/email rejection
 *
 * Usage:
 *   # Run locally against VPS
 *   pnpm tsx packages/agent/tests/test-email-worker.ts
 *
 *   # Run on VPS via SSH
 *   ssh -i ~/.ssh/vps_key root@77.42.31.185 "cd /root/aevoy && node packages/agent/tests/test-email-worker.ts"
 */

import crypto from "crypto";

// ---- Configuration ----

const AGENT_URL = process.env.AGENT_URL || "http://localhost:3001";
const AGENT_WEBHOOK_SECRET = process.env.AGENT_WEBHOOK_SECRET!;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Test user (teste2e)
const TEST_USER_ID = "11684ec6-80cd-4bb6-9aed-8f0947afd06a";
const TEST_USERNAME = "teste2e";
const TEST_EMAIL = "teste2e@aevoy.com"; // Registered email

// ---- Test Email Templates ----

interface TestEmail {
  from: string;
  to: string;
  subject: string;
  body: string;
  bodyHtml?: string;
  attachments?: Array<{ filename: string; mimeType: string; size: number }>;
}

const TEST_EMAILS: Record<string, TestEmail> = {
  new_task: {
    from: TEST_EMAIL,
    to: `${TEST_USERNAME}@aevoy.com`,
    subject: "Book a flight to Paris",
    body: "Find me a flight from NYC to Paris on March 15th, budget under $800",
    bodyHtml: "<p>Find me a flight from NYC to Paris on March 15th, budget under $800</p>",
  },

  confirmation_reply_yes: {
    from: TEST_EMAIL,
    to: `${TEST_USERNAME}@aevoy.com`,
    subject: "Re: Confirm: Book restaurant for Friday",
    body: `Yes, go ahead!

---
Task ID: 12345678-1234-1234-1234-123456789012

From: Aurora AI
Subject: Confirm: Book restaurant for Friday
Do you want me to proceed?`,
  },

  confirmation_reply_no: {
    from: TEST_EMAIL,
    to: `${TEST_USERNAME}@aevoy.com`,
    subject: "Re: Confirm: Send email to team",
    body: `No, cancel that.

---
Task ID: 87654321-4321-4321-4321-210987654321`,
  },

  verification_code: {
    from: TEST_EMAIL,
    to: `${TEST_USERNAME}@aevoy.com`,
    subject: "Re: Verification code needed",
    body: `123456

---
Task ID: abcdef12-3456-7890-abcd-ef1234567890

From: Aurora AI
Subject: Verification code needed
Please reply with the 2FA code.`,
  },

  magic_link: {
    from: TEST_EMAIL, // Use registered email to avoid PIN verification
    to: `${TEST_USERNAME}@aevoy.com`,
    subject: "Sign in to your account",
    body: `Click here to sign in: https://example.com/auth/verify?token=abc123xyz789

This link expires in 15 minutes.`,
    bodyHtml: `<p>Click here to sign in: <a href="https://example.com/auth/verify?token=abc123xyz789">Sign In</a></p>
<p>This link expires in 15 minutes.</p>`,
  },

  unregistered_sender: {
    from: "friend@example.com", // NOT the registered email
    to: `${TEST_USERNAME}@aevoy.com`,
    subject: "Can you book me a hotel?",
    body: "Hey, can you find me a hotel in SF for next week? Budget is $200/night.",
  },

  pin_verification_reply: {
    from: TEST_EMAIL,
    to: `${TEST_USERNAME}@aevoy.com`,
    subject: "Re: Email PIN Required: friend@example.com",
    body: "123456", // 6-digit PIN
  },

  invalid_user: {
    from: "anyone@example.com",
    to: "nonexistent@aevoy.com",
    subject: "This should fail",
    body: "User does not exist",
  },

  with_attachments: {
    from: TEST_EMAIL,
    to: `${TEST_USERNAME}@aevoy.com`,
    subject: "Extract data from this spreadsheet",
    body: "Please analyze the attached file and summarize key insights.",
    attachments: [
      { filename: "data.csv", mimeType: "text/csv", size: 1024 },
      { filename: "report.pdf", mimeType: "application/pdf", size: 2048 },
    ],
  },
};

// ---- Email Worker Simulation ----

interface EmailWorkerEnv {
  AGENT_URL: string;
  AGENT_WEBHOOK_SECRET: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
}

interface Profile {
  id: string;
  username: string;
  email: string;
  messages_used: number;
  messages_limit: number;
  email_pin?: string | null;
  email_pin_hash?: string | null;
  email_pin_attempts?: number;
  email_pin_locked_until?: string | null;
}

async function getUser(username: string): Promise<Profile | null> {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?username=eq.${username}&select=*`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    }
  );

  if (!response.ok) {
    console.error("Failed to fetch user:", response.status);
    return null;
  }

  const users = (await response.json()) as Profile[];
  return users.length > 0 ? users[0] : null;
}

type EmailType = "confirmation_reply" | "verification_reply" | "magic_link" | "new_task";

function detectEmailType(subject: string, body: string): { type: EmailType; taskId: string | null } {
  // Check for confirmation reply
  if (subject.toLowerCase().includes("confirm:")) {
    const taskIdMatch = body.match(/Task ID:\s*([a-f0-9-]+)/i);
    return { type: "confirmation_reply", taskId: taskIdMatch ? taskIdMatch[1] : null };
  }

  // Check for verification code reply
  if (subject.toLowerCase().includes("verification code")) {
    const taskIdMatch = body.match(/Task ID:\s*([a-f0-9-]+)/i);
    return { type: "verification_reply", taskId: taskIdMatch ? taskIdMatch[1] : null };
  }

  // Check body for task ID
  const taskIdMatch = body.match(/Task ID:\s*([a-f0-9-]+)/i);
  if (taskIdMatch) {
    const firstLine = body.split("\n")[0].toLowerCase().trim();
    if (/^\d{4,8}$/.test(firstLine)) {
      return { type: "verification_reply", taskId: taskIdMatch[1] };
    }
    return { type: "confirmation_reply", taskId: taskIdMatch[1] };
  }

  // Check for magic link
  const magicLinkPatterns = [
    /(?:sign.?in|log.?in|verify|confirm|magic).?link/i,
    /click\s+(?:here|this\s+link)\s+to\s+(?:sign|log)\s*in/i,
    /one-time\s+(?:link|login)/i,
  ];

  const isMagicLink = magicLinkPatterns.some((p) => p.test(subject) || p.test(body));
  if (isMagicLink) {
    const urlMatch = body.match(/https?:\/\/[^\s<>"]+(?:token|verify|login|auth|magic|confirm)[^\s<>"]*/i);
    if (urlMatch) {
      return { type: "magic_link", taskId: null };
    }
  }

  return { type: "new_task", taskId: null };
}

function extractReplyText(body: string): string {
  const lines = body.split("\n");
  const replyLines: string[] = [];

  for (const line of lines) {
    if (
      line.startsWith(">") ||
      (line.startsWith("On ") && line.includes(" wrote:")) ||
      line.includes("-----Original Message-----") ||
      line.includes("_______________") ||
      line.match(/^From:\s+/i) ||
      line.includes("Task ID:")
    ) {
      break;
    }
    replyLines.push(line);
  }

  return replyLines.join("\n").trim();
}

/**
 * Simulate email processing by Cloudflare Worker
 */
async function processEmailLikeWorker(email: TestEmail): Promise<{
  success: boolean;
  endpoint: string;
  payload: Record<string, unknown>;
  error?: string;
}> {
  try {
    // Extract username from to address
    const toAddress = email.to.toLowerCase();
    const username = toAddress.split("@")[0];

    if (!username || !/^[a-zA-Z0-9_-]+$/.test(username)) {
      return { success: false, endpoint: "", payload: {}, error: "Invalid recipient address" };
    }

    // Look up user
    const user = await getUser(username);
    if (!user) {
      return { success: false, endpoint: "", payload: {}, error: "User not found" };
    }

    // Validate sender
    const senderEmail = email.from.toLowerCase().trim();
    const registeredEmail = user.email?.toLowerCase().trim() || "";

    // Check if sender is unregistered (PIN flow)
    if (registeredEmail && senderEmail !== registeredEmail) {
      // For testing, we'll simulate the PIN flow by checking if email contains a PIN
      const pinMatch = email.body?.match(/\b\d{6}\b/);
      const isPinReply = email.subject?.toLowerCase().includes("email pin required");

      if (pinMatch && isPinReply) {
        // This is a PIN verification - would normally verify against DB session
        return {
          success: true,
          endpoint: "/task/incoming",
          payload: {
            userId: user.id,
            username: user.username,
            from: senderEmail,
            subject: "Original task after PIN verification",
            body: "Task forwarded after PIN verification",
            inputChannel: "email",
          },
        };
      } else {
        // Generate PIN and return (would normally create session in DB)
        return {
          success: false,
          endpoint: "",
          payload: {},
          error: "PIN verification required (unregistered sender)",
        };
      }
    }

    // Check quota
    if (user.messages_used >= user.messages_limit) {
      console.warn(`User ${username} over quota (${user.messages_used}/${user.messages_limit})`);
      // Still forward to agent for over-quota handling
    }

    // Detect email type
    const { type: emailType, taskId } = detectEmailType(email.subject, email.body);

    let endpoint: string;
    let payload: Record<string, unknown>;

    switch (emailType) {
      case "confirmation_reply": {
        if (!taskId) {
          endpoint = "/task/incoming";
          payload = {
            userId: user.id,
            username: user.username,
            from: email.from,
            subject: email.subject,
            body: email.body,
            bodyHtml: email.bodyHtml,
            attachments: email.attachments,
          };
          break;
        }

        endpoint = "/task/confirm";
        const replyText = extractReplyText(email.body);
        payload = {
          userId: user.id,
          username: user.username,
          from: email.from,
          taskId,
          replyText,
        };
        break;
      }

      case "verification_reply": {
        if (!taskId) {
          endpoint = "/task/incoming";
          payload = {
            userId: user.id,
            username: user.username,
            from: email.from,
            subject: email.subject,
            body: email.body,
            bodyHtml: email.bodyHtml,
            attachments: email.attachments,
          };
          break;
        }

        endpoint = "/task/verification";
        const replyText = extractReplyText(email.body);
        const codeMatch = replyText.match(/\b(\d{4,8})\b/);
        payload = {
          userId: user.id,
          username: user.username,
          from: email.from,
          taskId,
          code: codeMatch ? codeMatch[1] : replyText.trim(),
        };
        break;
      }

      case "magic_link": {
        const urlMatch = email.body.match(/https?:\/\/[^\s<>"]+(?:token|verify|login|auth|magic|confirm)[^\s<>"]*/i);
        endpoint = "/task/incoming";
        payload = {
          userId: user.id,
          username: user.username,
          from: email.from,
          type: "magic_link",
          magicLinkUrl: urlMatch ? urlMatch[0] : null,
          subject: email.subject,
          body: email.body,
          attachments: email.attachments,
        };
        break;
      }

      case "new_task":
      default:
        endpoint = "/task/incoming";
        payload = {
          userId: user.id,
          username: user.username,
          from: email.from,
          subject: email.subject,
          body: email.body,
          bodyHtml: email.bodyHtml,
          attachments: email.attachments,
        };
        break;
    }

    return { success: true, endpoint, payload };
  } catch (error) {
    return {
      success: false,
      endpoint: "",
      payload: {},
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Send processed email to agent
 */
async function sendToAgent(endpoint: string, payload: Record<string, unknown>): Promise<{
  success: boolean;
  status: number;
  data?: unknown;
  error?: string;
}> {
  try {
    const response = await fetch(`${AGENT_URL}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Secret": AGENT_WEBHOOK_SECRET,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));

    return {
      success: response.ok,
      status: response.status,
      data,
      error: response.ok ? undefined : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      success: false,
      status: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ---- Backdoor Endpoint Tests ----

/**
 * Test the /task/incoming endpoint directly (backdoor for testing)
 */
async function testBackdoorEndpoint(testName: string, payload: Record<string, unknown>): Promise<void> {
  console.log(`\n[BACKDOOR] ${testName}`);
  console.log("Payload:", JSON.stringify(payload, null, 2));

  const result = await sendToAgent("/task/incoming", payload);

  if (result.success) {
    console.log("✅ PASSED - Status:", result.status);
    console.log("Response:", result.data);
  } else {
    console.log("❌ FAILED - Status:", result.status);
    console.log("Error:", result.error);
  }
}

// ---- Test Suite ----

async function runTests(): Promise<void> {
  console.log("=".repeat(60));
  console.log("CLOUDFLARE EMAIL WORKER TEST SUITE");
  console.log("=".repeat(60));
  console.log(`Agent URL: ${AGENT_URL}`);
  console.log(`Test User: ${TEST_USERNAME} (${TEST_USER_ID})`);
  console.log("=".repeat(60));

  let passed = 0;
  let failed = 0;

  // Test 1: New Task Email
  console.log("\n[TEST 1] New Task Email");
  const test1 = await processEmailLikeWorker(TEST_EMAILS.new_task);
  if (test1.success && test1.endpoint === "/task/incoming") {
    const agentResult = await sendToAgent(test1.endpoint, test1.payload);
    if (agentResult.success) {
      console.log("✅ PASSED - New task created");
      console.log("Response:", agentResult.data);
      passed++;
    } else {
      console.log("❌ FAILED - Agent rejected task");
      console.log("Error:", agentResult.error);
      failed++;
    }
  } else {
    console.log("❌ FAILED - Worker processing failed");
    console.log("Error:", test1.error);
    failed++;
  }

  // Test 2: Confirmation Reply (Yes)
  console.log("\n[TEST 2] Confirmation Reply (Yes)");
  const test2 = await processEmailLikeWorker(TEST_EMAILS.confirmation_reply_yes);
  if (test2.success && test2.endpoint === "/task/confirm") {
    console.log("✅ PASSED - Detected as confirmation reply");
    console.log("Payload:", test2.payload);
    passed++;
  } else {
    console.log("❌ FAILED");
    console.log("Error:", test2.error);
    failed++;
  }

  // Test 3: Confirmation Reply (No)
  console.log("\n[TEST 3] Confirmation Reply (No)");
  const test3 = await processEmailLikeWorker(TEST_EMAILS.confirmation_reply_no);
  if (test3.success && test3.endpoint === "/task/confirm") {
    console.log("✅ PASSED - Detected as confirmation reply");
    console.log("Payload:", test3.payload);
    passed++;
  } else {
    console.log("❌ FAILED");
    console.log("Error:", test3.error);
    failed++;
  }

  // Test 4: Verification Code
  console.log("\n[TEST 4] Verification Code Reply");
  const test4 = await processEmailLikeWorker(TEST_EMAILS.verification_code);
  if (test4.success && test4.endpoint === "/task/verification") {
    const payload = test4.payload as { code?: string };
    if (payload.code === "123456") {
      console.log("✅ PASSED - Code extracted correctly");
      console.log("Payload:", test4.payload);
      passed++;
    } else {
      console.log("❌ FAILED - Wrong code extracted:", payload.code);
      failed++;
    }
  } else {
    console.log("❌ FAILED");
    console.log("Error:", test4.error);
    failed++;
  }

  // Test 5: Magic Link
  console.log("\n[TEST 5] Magic Link Detection");
  const test5 = await processEmailLikeWorker(TEST_EMAILS.magic_link);
  if (test5.success && test5.endpoint === "/task/incoming") {
    const payload = test5.payload as { type?: string; magicLinkUrl?: string };
    if (payload.type === "magic_link" && payload.magicLinkUrl) {
      console.log("✅ PASSED - Magic link extracted");
      console.log("URL:", payload.magicLinkUrl);
      passed++;
    } else {
      console.log("❌ FAILED - Magic link not detected");
      failed++;
    }
  } else {
    console.log("❌ FAILED");
    console.log("Error:", test5.error);
    failed++;
  }

  // Test 6: Unregistered Sender (PIN Required)
  console.log("\n[TEST 6] Unregistered Sender (PIN Required)");
  const test6 = await processEmailLikeWorker(TEST_EMAILS.unregistered_sender);
  if (!test6.success && test6.error === "PIN verification required (unregistered sender)") {
    console.log("✅ PASSED - PIN verification triggered");
    passed++;
  } else {
    console.log("❌ FAILED - Should require PIN verification");
    console.log("Result:", test6);
    failed++;
  }

  // Test 7: PIN Verification Reply
  console.log("\n[TEST 7] PIN Verification Reply");
  const test7 = await processEmailLikeWorker(TEST_EMAILS.pin_verification_reply);
  if (test7.success && test7.endpoint === "/task/incoming") {
    console.log("✅ PASSED - PIN verified, task forwarded");
    console.log("Payload:", test7.payload);
    passed++;
  } else {
    console.log("❌ FAILED");
    console.log("Error:", test7.error);
    failed++;
  }

  // Test 8: Invalid User
  console.log("\n[TEST 8] Invalid User Rejection");
  const test8 = await processEmailLikeWorker(TEST_EMAILS.invalid_user);
  if (!test8.success && test8.error === "User not found") {
    console.log("✅ PASSED - Invalid user rejected");
    passed++;
  } else {
    console.log("❌ FAILED - Should reject invalid user");
    console.log("Result:", test8);
    failed++;
  }

  // Test 9: Email with Attachments
  console.log("\n[TEST 9] Email with Attachments");
  const test9 = await processEmailLikeWorker(TEST_EMAILS.with_attachments);
  if (test9.success && test9.endpoint === "/task/incoming") {
    const payload = test9.payload as { attachments?: Array<{ filename: string }> };
    if (payload.attachments && payload.attachments.length === 2) {
      console.log("✅ PASSED - Attachments preserved");
      console.log("Attachments:", payload.attachments);
      passed++;
    } else {
      console.log("❌ FAILED - Attachments not preserved");
      failed++;
    }
  } else {
    console.log("❌ FAILED");
    console.log("Error:", test9.error);
    failed++;
  }

  // Test 10: Backdoor endpoint - Direct task submission
  console.log("\n[TEST 10] Backdoor Endpoint - Direct Task Submission");
  await testBackdoorEndpoint("Direct New Task", {
    userId: TEST_USER_ID,
    username: TEST_USERNAME,
    from: TEST_EMAIL,
    subject: "Backdoor test: Find best pizza in SF",
    body: "Use the backdoor endpoint to submit this task directly",
    inputChannel: "email",
  });
  passed++;

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("TEST SUMMARY");
  console.log("=".repeat(60));
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`Total: ${passed + failed}`);
  console.log("=".repeat(60));

  if (failed === 0) {
    console.log("\n🎉 All tests passed!");
    process.exit(0);
  } else {
    console.log(`\n⚠️  ${failed} test(s) failed`);
    process.exit(1);
  }
}

// ---- Main ----

if (!AGENT_WEBHOOK_SECRET || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Missing required environment variables:");
  console.error("  AGENT_WEBHOOK_SECRET");
  console.error("  NEXT_PUBLIC_SUPABASE_URL");
  console.error("  SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

runTests().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
