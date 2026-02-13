/**
 * Task Processor V2 - Fully Autonomous with Planning Phase
 * 
 * Flow:
 * 1. Receive task
 * 2. PLANNING PHASE - Analyze, anticipate, get confirmation
 * 3. AUTONOMOUS EXECUTION - Never stop until complete
 * 4. QUALITY CHECK - 99th percentile verification
 * 5. Return result
 */

import { planningService, ExecutionPlan } from "./planning.js";
import { createAutonomousExecutor } from "./autonomous-executor.js";
import { createMultiUserBrowser, MultiUserBrowserService } from "./multi-user-browser.js";
import { qualityChecker } from "./quality-checker.js";
import { getSupabaseClient } from "../utils/supabase.js";
import { sendResponse } from "./email.js";
import { classifyTask, generateResponse } from "./ai.js";
import { loadMemory } from "./memory.js";

interface TaskRequest {
  userId: string;
  username: string;
  email: string;
  task: string;
  channel: "email" | "sms" | "web";
}

interface TaskResult {
  success: boolean;
  response: string;
  planId?: string;
  awaitingConfirmation?: boolean;
  error?: string;
}

export class ProcessorV2 {
  /**
   * Main entry point - process task with full autonomy
   */
  async processTask(request: TaskRequest): Promise<TaskResult> {
    console.log(`[PROCESSOR-V2] Task from ${request.username}: ${request.task.substring(0, 50)}...`);

    const startTime = Date.now();

    try {
      // Validate input
      if (!request.task || request.task.trim() === '') {
        console.warn(`[PROCESSOR-V2] Empty task from ${request.username}`);
        return {
          success: false,
          response: "Please provide a task description. What would you like me to help you with?",
          error: "empty_input"
        };
      }

      // STEP 0: CLASSIFY TASK (check if browser needed)
      const classification = await classifyTask(request.task);
      console.log(`[PROCESSOR-V2] Classification: ${classification.taskType}, needsBrowser=${classification.needsBrowser}`);

      // Fast path for AI-only tasks (no browser needed)
      if (!classification.needsBrowser) {
        console.log("[PROCESSOR-V2] AI-only task detected, skipping browser");
        const taskId = await this.createTaskRecord(request, "simple", "processing");
        const result = await this.executeAIOnlyTask(request, classification.goal);
        await this.finalizeTaskRecord(taskId, result, Date.now() - startTime);
        return { ...result, planId: taskId };
      }

      // STEP 1: PLANNING PHASE (for browser tasks)
      const plan = await planningService.createPlan(request.userId, request.task);

      // Create task record linked to execution plan
      const taskId = await this.createTaskRecord(
        request,
        plan.estimatedSteps > 10 ? "complex" : plan.estimatedSteps > 5 ? "research" : "simple",
        plan.requireConfirmation ? "awaiting_confirmation" : "processing",
        plan.taskId
      );

      // Check if confirmation required
      if (plan.requireConfirmation) {
        await this.sendPlanForConfirmation(request, plan);
        return {
          success: true,
          response: "Plan created, awaiting your confirmation",
          planId: plan.taskId,
          awaitingConfirmation: true,
        };
      }

      // Auto-approved (simple task or settings allow)
      const result = await this.executePlan(request, plan);
      await this.finalizeTaskRecord(taskId, result, Date.now() - startTime);
      return result;

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      console.error("[PROCESSOR-V2] Error:", errorMsg);
      return { success: false, response: "", error: errorMsg };
    }
  }

  /**
   * Execute AI-only task (no browser needed)
   */
  private async executeAIOnlyTask(request: TaskRequest, goal: string): Promise<TaskResult> {
    try {
      // UNIFIED MEMORY: Load user's memory for ALL channels (email/SMS/voice/web)
      const memory = await loadMemory(request.userId);
      console.log(`[PROCESSOR-V2] Loaded memory for ${request.username}`);

      const aiResponse = await generateResponse(
        memory,
        goal, // subject
        request.task, // body
        request.username,
        "respond", // task type
        request.userId
      );

      const response = aiResponse.content || "I completed the task.";

      console.log(`[PROCESSOR-V2] AI-only response: ${response.substring(0, 100)}...`);

      return {
        success: true,
        response,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      console.error("[PROCESSOR-V2] AI-only task error:", errorMsg);
      return { success: false, response: "", error: errorMsg };
    }
  }

  /**
   * Execute confirmed plan
   */
  async executePlan(request: TaskRequest, plan: ExecutionPlan): Promise<TaskResult> {
    console.log(`[PROCESSOR-V2] Executing plan: ${plan.goal}`);

    // Initialize browser
    const browser = createMultiUserBrowser(request.userId);
    
    try {
      // Get page (initializes browser if needed)
      const page = await browser.init();

      // Create executor
      const executor = createAutonomousExecutor(request.userId, browser);

      // Execute with never-stop logic
      const result = await executor.execute(plan);

      // Quality verification - ALWAYS RUN (even on partial/failed results)
      let quality = null;
      let improvedResult = result;

      const taskType = this.determineTaskType(plan);

      // Run quality check on any result (success, partial, or failure)
      const resultToCheck = result.result || {
        error: result.error,
        partialData: result
      };

      console.log(`[PROCESSOR-V2] Running quality verification (result.success=${result.success})`);

      try {
        const qualityCheck = await qualityChecker.verifyWithImprovement(
          taskType,
          plan.goal,
          resultToCheck,
          page,
          5
        );
        quality = qualityCheck.quality;

        // If quality checker improved the result, use it
        if (qualityCheck.success && qualityCheck.finalResult) {
          console.log(`[PROCESSOR-V2] Quality checker improved result (${quality?.percentile || 0}th percentile)`);
          improvedResult = {
            ...result,
            success: true,
            result: qualityCheck.finalResult,
          };
        } else if (!result.success) {
          console.warn(`[PROCESSOR-V2] Execution failed and quality check couldn't recover (${quality?.percentile || 0}th percentile)`);
        }
      } catch (qualityError) {
        console.error(`[PROCESSOR-V2] Quality check threw error:`, qualityError);
        // Continue with original result if quality check fails
      }

      // Use improved result if available
      const finalResult = improvedResult;

      // Build response
      const response = this.buildResponse(finalResult, quality);

      // Save sessions
      await browser.saveAllSessions();

      // Update task record
      await this.updateTaskRecord(plan.taskId, finalResult, quality);

      return {
        success: finalResult.success,
        response,
      };

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      
      // Try fallback to Browserbase
      console.log("[PROCESSOR-V2] VPS failed, trying Browserbase fallback...");
      return this.executeWithFallback(request, plan);
      
    } finally {
      // Don't close browser - keep for reuse
      await browser.close();
    }
  }

  /**
   * Execute with Browserbase fallback
   */
  private async executeWithFallback(request: TaskRequest, plan: ExecutionPlan): Promise<TaskResult> {
    try {
      const fallback = await MultiUserBrowserService.createFallback(request.userId);
      const page = await fallback.init();
      
      // Use original executor with fallback browser
      const executor = createAutonomousExecutor(request.userId, fallback as any);
      const result = await executor.execute(plan);

      return {
        success: result.success,
        response: this.buildResponse(result, undefined),
      };
    } catch (error) {
      return {
        success: false,
        response: "Unable to complete task - all browser methods failed",
        error: error instanceof Error ? error.message : "Unknown",
      };
    }
  }

  /**
   * Send plan to user for confirmation
   */
  private async sendPlanForConfirmation(request: TaskRequest, plan: ExecutionPlan): Promise<void> {
    const highStakesList: string[] = [];
    if (plan.highStakes.spendingMoney) highStakesList.push(`spending $${plan.highStakes.amount || "money"}`);
    if (plan.highStakes.cancelingSubscription) highStakesList.push("canceling a subscription");
    if (plan.highStakes.deletingAccount) highStakesList.push("deleting an account");
    if (plan.highStakes.sharingPersonalInfo) highStakesList.push("sharing personal information");

    const message = `
I'll help you: ${plan.goal}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PLAN:
${plan.steps.map((s, i) => `${i + 1}. ${s.description}`).join("\n")}

ESTIMATED: ${plan.estimatedDuration} min, $${plan.estimatedCost.toFixed(2)}

${highStakesList.length > 0 ? `⚠️ HIGH STAKES: This involves ${highStakesList.join(", ")}` : ""}

ANTICIPATED OBSTACLES:
${plan.anticipatedObstacles.map(o => `• ${o.type} (${Math.round(o.probability * 100)}% chance) → ${o.mitigation}`).join("\n")}

ALTERNATIVE PATHS:
${plan.alternativePaths.map((a, i) => `${i + 1}. ${a.name}: ${a.description}`).join("\n")}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Reply:
• YES - Execute autonomously (I'll handle everything)
• NO - Cancel this task
• MODIFY - Add instructions (e.g., "Don't spend more than $50")

If I don't hear back in ${plan.userResponseTimeout} minutes, I'll proceed with the safest option.
`;

    await sendResponse({
      to: request.email,
      from: `${request.username}@aevoy.com`,
      subject: `Confirm: ${plan.goal}`,
      body: message,
    });

    // Update plan status
    await getSupabaseClient()
      .from("execution_plans")
      .update({
        confirmation_sent_at: new Date().toISOString(),
        confirmation_channel: request.channel,
      })
      .eq("id", plan.taskId);
  }

  /**
   * Handle confirmation response from user
   */
  async handleConfirmation(
    planId: string,
    userId: string,
    response: "yes" | "no" | "modify",
    modifications?: string
  ): Promise<TaskResult> {
    // Get plan
    const { data: plan } = await getSupabaseClient()
      .from("execution_plans")
      .select("*")
      .eq("id", planId)
      .eq("user_id", userId)
      .single();

    if (!plan) {
      return { success: false, response: "Plan not found" };
    }

    if (response === "no") {
      await planningService.rejectPlan(planId, "User cancelled");
      return { success: true, response: "Task cancelled as requested" };
    }

    if (response === "modify" && modifications) {
      // Update plan with modifications
      await getSupabaseClient()
        .from("execution_plans")
        .update({
          modifications,
          status: "modified",
        })
        .eq("id", planId);
      
      // Re-plan with modifications
      const newPlan = await planningService.createPlan(userId, `${plan.goal}\n\n[MODIFICATIONS] ${modifications}`);
      
      // Get user details
      const { data: profile } = await getSupabaseClient()
        .from("profiles")
        .select("username, email")
        .eq("id", userId)
        .single();

      if (newPlan.requireConfirmation) {
        await this.sendPlanForConfirmation(
          { userId, username: profile?.username || "", email: profile?.email || "", task: newPlan.goal, channel: "email" },
          newPlan
        );
        return { success: true, response: "Updated plan sent for confirmation", planId: newPlan.taskId };
      }

      return this.executePlan(
        { userId, username: profile?.username || "", email: profile?.email || "", task: newPlan.goal, channel: "email" },
        newPlan
      );
    }

    // YES - Execute
    await planningService.confirmAndExecute(planId, userId);

    const { data: profile } = await getSupabaseClient()
      .from("profiles")
      .select("username, email")
      .eq("id", userId)
      .single();

    return this.executePlan(
      { userId, username: profile?.username || "", email: profile?.email || "", task: plan.goal, channel: "email" },
      plan as ExecutionPlan
    );
  }

  /**
   * Determine task type for quality threshold
   */
  private determineTaskType(plan: ExecutionPlan): "simple" | "medium" | "complex" | "critical" {
    if (plan.highStakes.spendingMoney || plan.highStakes.deletingAccount) return "critical";
    if (plan.estimatedSteps > 10) return "complex";
    if (plan.estimatedSteps < 5) return "simple";
    return "medium";
  }

  /**
   * Build human-readable response
   */
  private buildResponse(result: any, quality: any): string {
    if (!result.success) {
      return `I wasn't able to complete this task. ${result.error || ""}\n\nI tried ${result.attempts || "multiple"} approaches before determining it requires your input.`;
    }

    let response = `Done! ${result.result?.goal || "Task completed"}`;

    if (result.stepsExecuted) {
      response += `\n\nCompleted in ${result.stepsExecuted} steps`;
    }

    if (quality) {
      response += `\n\nQuality score: ${quality.score}/100 (${quality.percentile}th percentile)`;
    }

    return response;
  }

  /**
   * Update task record in database
   */
  private async updateTaskRecord(
    planId: string,
    result: any,
    quality: any
  ): Promise<void> {
    const updateData: any = {
      status: result.success ? "completed" : "failed",
      completed_at: new Date().toISOString(),
      execution_time_ms: result.durationMs,
    };

    // Store result and quality data in verification_data
    if (result.result || quality) {
      updateData.verification_data = {
        result: result.result,
        quality_score: quality?.score,
        quality_percentile: quality?.percentile,
        steps_executed: result.stepsExecuted,
      };
      updateData.verification_status = quality?.percentile >= 95 ? "verified" : "completed";
    }

    // Store error message if failed
    if (!result.success && result.error) {
      updateData.error_message = result.error;
    }

    await getSupabaseClient()
      .from("tasks")
      .update(updateData)
      .eq("id", planId);
  }

  /**
   * Create initial task record
   */
  private async createTaskRecord(
    request: TaskRequest,
    type: "simple" | "research" | "complex",
    status: "processing" | "awaiting_confirmation",
    executionPlanId?: string
  ): Promise<string> {
    const insertData: any = {
      user_id: request.userId,
      status,
      type,
      email_subject: request.task.substring(0, 100),
      input_text: request.task,
      input_channel: request.channel,
      started_at: new Date().toISOString(),
    };

    // Store execution plan ID in checkpoint_data if provided
    if (executionPlanId) {
      insertData.checkpoint_data = { execution_plan_id: executionPlanId };
    }

    const { data: taskRecord, error } = await getSupabaseClient()
      .from("tasks")
      .insert(insertData)
      .select("id")
      .single();

    if (error || !taskRecord) {
      console.error("[PROCESSOR-V2] Failed to create task record:", error);
      throw new Error("Failed to create task record");
    }

    console.log(`[PROCESSOR-V2] Created task record: ${taskRecord.id}`);
    return taskRecord.id;
  }

  /**
   * Finalize task record with results
   */
  private async finalizeTaskRecord(
    taskId: string,
    result: TaskResult,
    durationMs: number
  ): Promise<void> {
    const updateData: any = {
      status: result.success ? "completed" : "failed",
      completed_at: new Date().toISOString(),
      execution_time_ms: durationMs,
      cost_usd: 0.001, // Default cost estimate
    };

    // Store error message if failed
    if (!result.success && result.error) {
      updateData.error_message = result.error;
    }

    // Store response in checkpoint_data (used for task result storage)
    if (result.response) {
      updateData.checkpoint_data = { response: result.response };
    }

    await getSupabaseClient()
      .from("tasks")
      .update(updateData)
      .eq("id", taskId);

    console.log(`[PROCESSOR-V2] Finalized task record: ${taskId} (${result.success ? "success" : "failed"})`);
  }
}

// Export singleton
export const processorV2 = new ProcessorV2();
