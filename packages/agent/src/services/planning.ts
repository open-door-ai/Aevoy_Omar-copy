/**
 * Planning Phase - Autonomous Task Planning & Confirmation
 * 
 * Before ANY execution, we:
 * 1. Analyze task complexity
 * 2. Identify all auth requirements
 * 3. Anticipate obstacles (CAPTCHA, 2FA, etc.)
 * 4. Generate alternative paths
 * 5. Get user confirmation
 * 
 * After confirmation: 100% autonomous execution, no interruptions
 */

import { generateResponse } from "./ai.js";
import { getCredential } from "./credential-vault.js";
import { getSupabaseClient } from "../utils/supabase.js";

export interface ExecutionPlan {
  taskId: string;
  goal: string;
  estimatedSteps: number;
  estimatedDuration: number; // minutes
  estimatedCost: number; // USD
  
  // Auth requirements
  requiredAuth: Array<{
    service: string;
    domain: string;
    status: "ready" | "missing" | "needs_refresh";
    authType: "oauth" | "password" | "2fa" | "captcha";
    preAuthUrl?: string;
    instructions?: string;
  }>;
  
  // Anticipated obstacles
  anticipatedObstacles: Array<{
    type: string;
    probability: number; // 0-1
    mitigation: string;
    fallbackAction: string;
  }>;
  
  // Alternative execution paths
  alternativePaths: Array<{
    name: string;
    description: string;
    triggerCondition: string;
    estimatedSuccessRate: number;
  }>;
  
  // Steps to execute
  steps: ExecutionStep[];
  
  // High-stakes flags
  highStakes: {
    spendingMoney: boolean;
    cancelingSubscription: boolean;
    deletingAccount: boolean;
    sharingPersonalInfo: boolean;
    amount?: number; // If spending money
  };
  
  // User settings
  requireConfirmation: boolean;
  confirmationReason?: string;
  userResponseTimeout: number; // minutes (20 default)
}

interface ExecutionStep {
  order: number;
  type: "navigate" | "login" | "fill" | "click" | "select" | "captcha" | "2fa" | "verify" | "api" | "wait";
  description: string;
  target?: string; // URL, selector, etc.
  expectedOutcome: string;
  canSkip: boolean;
  alternativeAction?: string;
}

interface UserSettings {
  confirmSpending: boolean;
  confirmCanceling: boolean;
  confirmDeleting: boolean;
  confirmSharing: boolean;
  maxAutonomousSpend: number;
  responseTimeoutMinutes: number;
  qualityThreshold: number; // 90, 95, or 99
}

export class PlanningService {
  /**
   * Create execution plan for a task
   */
  async createPlan(
    userId: string,
    taskDescription: string
  ): Promise<ExecutionPlan> {
    // Get user settings
    const settings = await this.getUserSettings(userId);
    
    // AI analyzes task
    const analysis = await this.analyzeTask(taskDescription);
    
    // Check credentials
    const auth = await this.checkAuthRequirements(userId, analysis.requiredServices);
    
    // Identify high-stakes actions
    const highStakes = this.identifyHighStakes(taskDescription, analysis);
    
    // Determine if confirmation needed
    const requireConfirmation = this.requiresConfirmation(highStakes, settings);
    
    // Generate alternative paths
    const alternatives = await this.generateAlternatives(analysis);
    
    // Build execution steps
    const steps = await this.buildSteps(analysis, auth);
    
    // Calculate estimates
    const estimatedCost = this.estimateCost(steps);
    const estimatedDuration = this.estimateDuration(steps);
    
    const plan: ExecutionPlan = {
      taskId: crypto.randomUUID(),
      goal: analysis.goal,
      estimatedSteps: steps.length,
      estimatedDuration,
      estimatedCost,
      requiredAuth: auth,
      anticipatedObstacles: analysis.obstacles,
      alternativePaths: alternatives,
      steps,
      highStakes,
      requireConfirmation,
      confirmationReason: requireConfirmation ? this.getConfirmationReason(highStakes) : undefined,
      userResponseTimeout: settings.responseTimeoutMinutes,
    };

    // Store plan
    await this.storePlan(userId, plan);

    return plan;
  }

  /**
   * Analyze task with AI
   */
  private async analyzeTask(taskDescription: string): Promise<any> {
    const prompt = `
Analyze this task and provide structured information:

TASK: "${taskDescription}"

Respond with JSON:
{
  "goal": "clear one-sentence goal",
  "complexity": "simple|medium|complex",
  "requiredServices": ["netflix.com", "gmail.com", etc],
  "needsBrowser": true/false,
  "obstacles": [
    {
      "type": "CAPTCHA|2FA|login_required|payment_confirmation|rate_limit",
      "probability": 0.0-1.0,
      "mitigation": "how to handle",
      "fallbackAction": "what to do if this fails"
    }
  ],
  "likelyFlow": ["step 1", "step 2", ...]
}
`;

    const response = await generateResponse(
      { userId: "", facts: [] },
      "Task Analysis",
      prompt,
      "system"
    );

    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch {
      // Fallback to default
    }

    return {
      goal: taskDescription,
      complexity: "medium",
      requiredServices: [],
      needsBrowser: true,
      obstacles: [],
      likelyFlow: [],
    };
  }

  /**
   * Check which services user has auth for
   */
  private async checkAuthRequirements(
    userId: string,
    services: string[]
  ): Promise<ExecutionPlan["requiredAuth"]> {
    const auth: ExecutionPlan["requiredAuth"] = [];

    for (const domain of services) {
      // Check credential vault
      const cred = await getCredential(userId, domain);
      
      // Check OAuth connections
      const { data: oauth } = await getSupabaseClient()
        .from("oauth_connections")
        .select("provider, expires_at")
        .eq("user_id", userId)
        .ilike("provider", `%${domain}%`)
        .single();

      if (cred || oauth) {
        auth.push({
          service: domain,
          domain,
          status: "ready",
          authType: oauth ? "oauth" : "password",
        });
      } else {
        auth.push({
          service: domain,
          domain,
          status: "missing",
          authType: "password",
          preAuthUrl: `https://${domain}/login`,
          instructions: `Please sign in to ${domain} first`,
        });
      }
    }

    return auth;
  }

  /**
   * Identify high-stakes actions
   */
  private identifyHighStakes(taskDescription: string, analysis: any): ExecutionPlan["highStakes"] {
    const lower = taskDescription.toLowerCase();
    
    // Spending money
    const spendingPatterns = [
      /buy\s/i, /purchase\s/i, /pay\s/i, /spend\s/i, /order\s/i,
      /\$\d+/, /\d+\s*dollars/i, /subscribe/i, /upgrade/i
    ];
    const spendingMoney = spendingPatterns.some(p => p.test(lower));
    
    // Extract amount
    let amount: number | undefined;
    const amountMatch = lower.match(/\$(\d+(?:\.\d{2})?)/);
    if (amountMatch) amount = parseFloat(amountMatch[1]);

    // Canceling
    const cancelPatterns = [/cancel\s/i, /unsubscribe/i, /terminate/i, /close\s.*account/i];
    const cancelingSubscription = cancelPatterns.some(p => p.test(lower));

    // Deleting
    const deletePatterns = [/delete\s.*account/i, /remove\s.*account/i, /erase\s/i];
    const deletingAccount = deletePatterns.some(p => p.test(lower));

    // Sharing
    const sharePatterns = [/share\s/i, /send\s.*to\s/i, /give\s.*to\s/i, /post\s.*on\s/i];
    const sharingPersonalInfo = sharePatterns.some(p => p.test(lower));

    return {
      spendingMoney,
      cancelingSubscription,
      deletingAccount,
      sharingPersonalInfo,
      amount,
    };
  }

  /**
   * Determine if confirmation required
   */
  private requiresConfirmation(highStakes: ExecutionPlan["highStakes"], settings: UserSettings): boolean {
    if (highStakes.spendingMoney && settings.confirmSpending) return true;
    if (highStakes.cancelingSubscription && settings.confirmCanceling) return true;
    if (highStakes.deletingAccount && settings.confirmDeleting) return true;
    if (highStakes.sharingPersonalInfo && settings.confirmSharing) return true;
    return false;
  }

  private getConfirmationReason(highStakes: ExecutionPlan["highStakes"]): string {
    const reasons: string[] = [];
    if (highStakes.spendingMoney) reasons.push(`spending $${highStakes.amount || "money"}`);
    if (highStakes.cancelingSubscription) reasons.push("canceling a subscription");
    if (highStakes.deletingAccount) reasons.push("deleting an account");
    if (highStakes.sharingPersonalInfo) reasons.push("sharing personal information");
    return `This task involves: ${reasons.join(", ")}`;
  }

  /**
   * Generate alternative execution paths
   */
  private async generateAlternatives(analysis: any): Promise<ExecutionPlan["alternativePaths"]> {
    const alternatives: ExecutionPlan["alternativePaths"] = [];

    // Generic alternatives
    alternatives.push({
      name: "API Alternative",
      description: "Use service API instead of browser automation",
      triggerCondition: "Browser blocked or rate limited",
      estimatedSuccessRate: 0.85,
    });

    alternatives.push({
      name: "Mobile Site",
      description: "Try mobile version of site",
      triggerCondition: "Desktop site has issues",
      estimatedSuccessRate: 0.75,
    });

    alternatives.push({
      name: "Email Fallback",
      description: "Send email to support",
      triggerCondition: "All automation fails",
      estimatedSuccessRate: 0.60,
    });

    return alternatives;
  }

  /**
   * Build execution steps
   */
  private async buildSteps(analysis: any, auth: ExecutionPlan["requiredAuth"]): Promise<ExecutionStep[]> {
    const steps: ExecutionStep[] = [];
    let order = 1;

    // Auth steps first
    for (const a of auth) {
      if (a.status === "ready") {
        steps.push({
          order: order++,
          type: "login",
          description: `Authenticate to ${a.service}`,
          target: a.domain,
          expectedOutcome: `Logged in to ${a.service}`,
          canSkip: false,
        });
      }
    }

    // Main flow steps from analysis
    for (const flowStep of analysis.likelyFlow || []) {
      steps.push({
        order: order++,
        type: this.inferStepType(flowStep),
        description: flowStep,
        expectedOutcome: "completed",
        canSkip: false,
      });
    }

    // Verification step
    steps.push({
      order: order++,
      type: "verify",
      description: "Verify task completion",
      expectedOutcome: "Task completed successfully",
      canSkip: false,
    });

    return steps;
  }

  private inferStepType(description: string): ExecutionStep["type"] {
    const lower = description.toLowerCase();
    if (lower.includes("navigate") || lower.includes("go to")) return "navigate";
    if (lower.includes("login") || lower.includes("sign in")) return "login";
    if (lower.includes("fill") || lower.includes("enter")) return "fill";
    if (lower.includes("click") || lower.includes("press")) return "click";
    if (lower.includes("select") || lower.includes("choose")) return "select";
    if (lower.includes("captcha")) return "captcha";
    if (lower.includes("2fa") || lower.includes("code")) return "2fa";
    if (lower.includes("wait")) return "wait";
    return "click";
  }

  /**
   * Estimate cost
   */
  private estimateCost(steps: ExecutionStep[]): number {
    let cost = 0.02; // Base AI cost
    
    for (const step of steps) {
      switch (step.type) {
        case "captcha":
          cost += 0.003; // 2captcha
          break;
        case "2fa":
          cost += 0.01; // SMS/Twilio
          break;
        case "api":
          cost += 0.001; // API call
          break;
        default:
          cost += 0.001; // Browser action
      }
    }

    return Math.round(cost * 100) / 100;
  }

  /**
   * Estimate duration
   */
  private estimateDuration(steps: ExecutionStep[]): number {
    let seconds = 30; // Setup
    
    for (const step of steps) {
      switch (step.type) {
        case "navigate":
          seconds += 5;
          break;
        case "login":
          seconds += 10;
          break;
        case "captcha":
          seconds += 30; // 2captcha polling
          break;
        case "2fa":
          seconds += 60; // Wait for user
          break;
        case "wait":
          seconds += 5;
          break;
        default:
          seconds += 3;
      }
    }

    return Math.ceil(seconds / 60);
  }

  /**
   * Get user settings
   */
  private async getUserSettings(userId: string): Promise<UserSettings> {
    const { data } = await getSupabaseClient()
      .from("user_settings")
      .select("*")
      .eq("user_id", userId)
      .single();

    if (!data) {
      return {
        confirmSpending: true,
        confirmCanceling: true,
        confirmDeleting: true,
        confirmSharing: true,
        maxAutonomousSpend: 100,
        responseTimeoutMinutes: 20,
        qualityThreshold: 99,
      };
    }

    return {
      confirmSpending: data.confirm_spending ?? true,
      confirmCanceling: data.confirm_canceling ?? true,
      confirmDeleting: data.confirm_deleting ?? true,
      confirmSharing: data.confirm_sharing ?? true,
      maxAutonomousSpend: data.max_autonomous_spend ?? 100,
      responseTimeoutMinutes: data.response_timeout_minutes ?? 20,
      qualityThreshold: data.quality_threshold ?? 99,
    };
  }

  /**
   * Store plan in database
   */
  private async storePlan(userId: string, plan: ExecutionPlan): Promise<void> {
    await getSupabaseClient()
      .from("execution_plans")
      .insert({
        id: plan.taskId,
        user_id: userId,
        goal: plan.goal,
        plan_steps: plan.steps,
        required_auth: plan.requiredAuth,
        high_stakes: plan.highStakes,
        estimated_cost: plan.estimatedCost,
        estimated_duration: plan.estimatedDuration,
        status: plan.requireConfirmation ? "pending_approval" : "approved",
      });
  }

  /**
   * Confirm plan and execute
   */
  async confirmAndExecute(
    planId: string,
    userId: string
  ): Promise<{ success: boolean; message: string }> {
    // Update plan status
    await getSupabaseClient()
      .from("execution_plans")
      .update({ status: "approved", approved_at: new Date().toISOString() })
      .eq("id", planId);

    // Queue for execution
    await getSupabaseClient()
      .from("task_queue")
      .insert({
        plan_id: planId,
        user_id: userId,
        status: "queued",
      });

    return { success: true, message: "Task queued for execution" };
  }

  /**
   * Reject plan
   */
  async rejectPlan(
    planId: string,
    reason: string
  ): Promise<void> {
    await getSupabaseClient()
      .from("execution_plans")
      .update({ 
        status: "rejected", 
        rejection_reason: reason,
        rejected_at: new Date().toISOString()
      })
      .eq("id", planId);
  }
}

export const planningService = new PlanningService();
