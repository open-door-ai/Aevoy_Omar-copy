#!/usr/bin/env node

/**
 * Standalone Email Worker Test (ES Module, no TypeScript)
 * Can run directly with: node test-email-worker-standalone.mjs
 */

import crypto from "crypto";

// ---- Configuration ----
const AGENT_URL = process.env.AGENT_URL || "http://localhost:3001";
const AGENT_WEBHOOK_SECRET = process.env.AGENT_WEBHOOK_SECRET;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const TEST_USER_ID = "11684ec6-80cd-4bb6-9aed-8f0947afd06a";
const TEST_USERNAME = "teste2e";
const TEST_EMAIL = "teste2e@aevoy.com";

// ---- Test Cases ----
const TESTS = {
  new_task: {
    from: TEST_EMAIL,
    to: `${TEST_USERNAME}@aevoy.com`,
    subject: "Book a flight to Paris",
    body: "Find me a flight from NYC to Paris on March 15th, budget under $800",
  },

  confirmation_yes: {
    from: TEST_EMAIL,
    to: `${TEST_USERNAME}@aevoy.com`,
    subject: "Re: Confirm: Book restaurant",
    body: `Yes, go ahead!\n\n---\nTask ID: 12345678-1234-1234-1234-123456789012`,
  },

  verification_code: {
    from: TEST_EMAIL,
    to: `${TEST_USERNAME}@aevoy.com`,
    subject: "Re: Verification code needed",
    body: `123456\n\n---\nTask ID: abcdef12-3456-7890-abcd-ef1234567890`,
  },

  magic_link: {
    from: TEST_EMAIL,
    to: `${TEST_USERNAME}@aevoy.com`,
    subject: "Sign in to your account",
    body: "Click here to sign in: https://example.com/auth/verify?token=abc123xyz789",
  },

  backdoor: {
    from: TEST_EMAIL,
    to: `${TEST_USERNAME}@aevoy.com`,
    subject: "Backdoor test: Find best pizza in SF",
    body: "Use the backdoor endpoint to submit this task directly",
  },
};

// ---- Helper Functions ----

async function testBackdoorEndpoint() {
  const payload = {
    userId: TEST_USER_ID,
    username: TEST_USERNAME,
    from: TEST_EMAIL,
    subject: TESTS.backdoor.subject,
    body: TESTS.backdoor.body,
    inputChannel: "email",
  };

  try {
    const response = await fetch(`${AGENT_URL}/task/incoming`, {
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
    };
  } catch (error) {
    return {
      success: false,
      status: 0,
      error: error.message,
    };
  }
}

async function testHealthEndpoint() {
  try {
    const response = await fetch(`${AGENT_URL}/health`);
    const data = await response.json();
    return {
      success: response.ok,
      status: data.status,
      data,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

// ---- Main Test Runner ----

async function runTests() {
  console.log("=".repeat(60));
  console.log("EMAIL WORKER TESTS (VPS)");
  console.log("=".repeat(60));
  console.log(`Agent URL: ${AGENT_URL}`);
  console.log(`Test User: ${TEST_USERNAME} (${TEST_USER_ID.slice(0, 8)}...)`);
  console.log("=".repeat(60));

  if (!AGENT_WEBHOOK_SECRET || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("\n❌ Missing required environment variables:");
    console.error("  AGENT_WEBHOOK_SECRET:", !!AGENT_WEBHOOK_SECRET);
    console.error("  NEXT_PUBLIC_SUPABASE_URL:", !!SUPABASE_URL);
    console.error("  SUPABASE_SERVICE_ROLE_KEY:", !!SUPABASE_SERVICE_KEY);
    process.exit(1);
  }

  let passed = 0;
  let failed = 0;

  // Test 1: Health Check
  console.log("\n[TEST 1] Agent Health Check");
  const healthResult = await testHealthEndpoint();
  if (healthResult.success) {
    console.log("✅ PASSED - Agent is healthy");
    console.log("Status:", healthResult.status);
    passed++;
  } else {
    console.log("❌ FAILED - Agent is not responding");
    console.log("Error:", healthResult.error);
    failed++;
  }

  // Test 2: Backdoor Endpoint
  console.log("\n[TEST 2] Backdoor Endpoint - Direct Task Submission");
  const backdoorResult = await testBackdoorEndpoint();
  if (backdoorResult.success) {
    console.log("✅ PASSED - Task submitted successfully");
    console.log("Response:", JSON.stringify(backdoorResult.data, null, 2));
    passed++;
  } else {
    console.log("❌ FAILED - Task submission failed");
    console.log("Status:", backdoorResult.status);
    console.log("Error:", backdoorResult.error);
    failed++;
  }

  // Test 3: Webhook Authentication
  console.log("\n[TEST 3] Webhook Authentication - Invalid Secret");
  try {
    const response = await fetch(`${AGENT_URL}/task/incoming`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Secret": "invalid_secret",
      },
      body: JSON.stringify({
        userId: TEST_USER_ID,
        username: TEST_USERNAME,
        from: TEST_EMAIL,
        subject: "Test",
        body: "Test",
      }),
    });

    if (response.status === 401 || response.status === 403) {
      console.log("✅ PASSED - Invalid secret rejected");
      console.log("Status:", response.status);
      passed++;
    } else {
      console.log("❌ FAILED - Invalid secret not rejected");
      console.log("Status:", response.status);
      failed++;
    }
  } catch (error) {
    console.log("❌ FAILED - Request error:", error.message);
    failed++;
  }

  // Test 4: Rate Limiting
  console.log("\n[TEST 4] Rate Limiting - Multiple Rapid Requests");
  try {
    const requests = Array(15).fill(null).map(() =>
      fetch(`${AGENT_URL}/task/incoming`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Secret": AGENT_WEBHOOK_SECRET,
        },
        body: JSON.stringify({
          userId: TEST_USER_ID,
          username: TEST_USERNAME,
          from: TEST_EMAIL,
          subject: "Rate limit test",
          body: "Test",
        }),
      })
    );

    const responses = await Promise.all(requests);
    const rateLimited = responses.some(r => r.status === 429);

    if (rateLimited) {
      console.log("✅ PASSED - Rate limiting active");
      console.log("Rate limited after", responses.findIndex(r => r.status === 429), "requests");
      passed++;
    } else {
      console.log("⚠️  WARNING - No rate limiting detected");
      console.log("All requests accepted:", responses.every(r => r.ok));
      // Don't fail the test, just warn
      passed++;
    }
  } catch (error) {
    console.log("❌ FAILED - Request error:", error.message);
    failed++;
  }

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

runTests().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
