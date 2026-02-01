import "dotenv/config";
import { processTask } from "./services/processor.js";
import type { TaskRequest } from "./types/index.js";

// Test script to simulate email task processing
async function runTest() {
  console.log("=".repeat(60));
  console.log("Handlit Agent Test Flow");
  console.log("=".repeat(60));
  console.log();

  // Check environment variables
  const requiredEnvVars = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "DEEPSEEK_API_KEY",
    "ENCRYPTION_KEY",
  ];

  const missingVars = requiredEnvVars.filter((v) => !process.env[v]);
  if (missingVars.length > 0) {
    console.error("Missing required environment variables:");
    missingVars.forEach((v) => console.error(`  - ${v}`));
    console.log("\nPlease set these in your .env file and try again.");
    process.exit(1);
  }

  console.log("Environment variables: OK");
  console.log();

  // Create test task
  const testTask: TaskRequest = {
    userId: "test-user-id", // Replace with a real user ID from your database
    username: "testuser",
    from: "test@example.com",
    subject: "Research the top 3 coffee shops in Vancouver",
    body: `Hi AI,

Can you help me find the top 3 coffee shops in Vancouver? I'm looking for places that have:
- Great coffee
- Good atmosphere for working
- Fast wifi

Thanks!`,
  };

  console.log("Test Task:");
  console.log(`  Subject: ${testTask.subject}`);
  console.log(`  From: ${testTask.from}`);
  console.log();

  console.log("Processing task...");
  console.log();

  try {
    const result = await processTask(testTask);

    console.log("=".repeat(60));
    console.log("Result:");
    console.log("=".repeat(60));
    console.log(`  Task ID: ${result.taskId}`);
    console.log(`  Success: ${result.success}`);
    console.log(`  Actions executed: ${result.actions.length}`);
    console.log();

    if (result.actions.length > 0) {
      console.log("Actions:");
      result.actions.forEach((a, i) => {
        console.log(`  ${i + 1}. ${a.action.type}: ${a.success ? "SUCCESS" : "FAILED"}`);
        if (a.result) console.log(`     Result: ${a.result}`);
        if (a.error) console.log(`     Error: ${a.error}`);
      });
      console.log();
    }

    if (result.response) {
      console.log("Response (first 500 chars):");
      console.log("-".repeat(40));
      console.log(result.response.substring(0, 500));
      if (result.response.length > 500) console.log("...");
      console.log("-".repeat(40));
    }

    if (result.error) {
      console.log(`Error: ${result.error}`);
    }
  } catch (error) {
    console.error("Test failed with error:", error);
  }

  console.log();
  console.log("Test complete!");
}

runTest();
