/**
 * Dynamic Skill Executor
 *
 * Replaces hardcoded switch statements in api-executor.ts
 * Executes skills dynamically from V8 isolated contexts
 */

import { SkillDiscovery } from "./discovery.js";
import { SkillInstaller } from "./installer.js";
import vm from "vm";

export interface SkillExecutionResult {
  success: boolean;
  result?: unknown;
  error?: string;
  duration?: number;
  cost?: number;
}

export class DynamicSkillExecutor {
  private discovery: SkillDiscovery;
  private installer: SkillInstaller;

  constructor() {
    this.discovery = new SkillDiscovery();
    this.installer = new SkillInstaller();
  }

  /**
   * Execute a skill dynamically
   */
  async executeSkill(
    userId: string,
    skillId: string,
    params: Record<string, unknown>,
    options: {
      accessToken?: string;
      timeout?: number;
      autoInstall?: boolean;
    } = {}
  ): Promise<SkillExecutionResult> {
    const { accessToken, timeout = 30000, autoInstall = true } = options;

    const startTime = Date.now();

    try {
      console.log(`[EXECUTOR] Executing skill: ${skillId}`);

      // Step 1: Check if skill is loaded in runtime
      if (!globalThis.SKILL_EXECUTORS || !globalThis.SKILL_EXECUTORS[skillId]) {
        console.log(`[EXECUTOR] Skill not loaded, checking installation...`);

        // Check if installed in database
        const installedSkills = await this.installer.listInstalledSkills(userId);
        const installed = installedSkills.find((s) => s.id === skillId);

        if (!installed) {
          if (!autoInstall) {
            return {
              success: false,
              error: `Skill not installed: ${skillId}`,
            };
          }

          // Auto-install skill
          console.log(`[EXECUTOR] Auto-installing skill: ${skillId}`);
          const installResult = await this.installer.installSkill(skillId, userId);

          if (!installResult.success) {
            return {
              success: false,
              error: installResult.error || "Installation failed",
            };
          }
        } else {
          // Reinstall from database
          console.log(`[EXECUTOR] Reinstalling from database...`);
          await this.installer.installSkill(skillId, userId, { forceReinstall: true });
        }
      }

      // Step 2: Get skill context
      const context = globalThis.SKILL_EXECUTORS[skillId];
      if (!context) {
        return {
          success: false,
          error: `Skill context not found: ${skillId}`,
        };
      }

      // Step 3: Prepare execution parameters
      const executionParams = {
        ...params,
        accessToken,
      };

      // Step 4: Execute skill in isolated context
      console.log(`[EXECUTOR] Running skill with params:`, Object.keys(executionParams));

      const executionCode = `
        (async () => {
          const params = ${JSON.stringify(executionParams)};

          // Call the skill's main function (assumes exported as 'execute')
          if (typeof execute === 'function') {
            return await execute(params);
          } else if (typeof main === 'function') {
            return await main(params);
          } else {
            throw new Error('Skill does not export execute() or main() function');
          }
        })()
      `;

      const script = new vm.Script(executionCode);
      const resultPromise = script.runInContext(context, {
        timeout,
        displayErrors: true,
      });

      // Wait for async result
      const result = await resultPromise;

      const duration = Date.now() - startTime;

      console.log(`[EXECUTOR] ✅ Execution complete in ${duration}ms`);

      return {
        success: true,
        result,
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const msg = error instanceof Error ? error.message : String(error);

      console.error(`[EXECUTOR] Execution failed:`, error);

      return {
        success: false,
        error: msg,
        duration,
      };
    }
  }

  /**
   * Execute skill by name (searches registry first)
   */
  async executeSkillByName(
    userId: string,
    skillName: string,
    params: Record<string, unknown>,
    options: {
      accessToken?: string;
      timeout?: number;
      autoInstall?: boolean;
    } = {}
  ): Promise<SkillExecutionResult> {
    // Search for skill by name
    const searchResult = await this.discovery.searchSkills(skillName, { limit: 1 });

    if (searchResult.skills.length === 0) {
      return {
        success: false,
        error: `Skill not found: ${skillName}`,
      };
    }

    const skill = searchResult.skills[0];
    return this.executeSkill(userId, skill.id, params, options);
  }

  /**
   * Batch execute multiple skills in parallel
   */
  async executeSkillsBatch(
    userId: string,
    executions: Array<{
      skillId: string;
      params: Record<string, unknown>;
    }>,
    options: {
      accessToken?: string;
      timeout?: number;
      autoInstall?: boolean;
      maxConcurrency?: number;
    } = {}
  ): Promise<SkillExecutionResult[]> {
    const { maxConcurrency = 5 } = options;

    console.log(`[EXECUTOR] Batch executing ${executions.length} skills...`);

    // Split into batches
    const batches: typeof executions[] = [];
    for (let i = 0; i < executions.length; i += maxConcurrency) {
      batches.push(executions.slice(i, i + maxConcurrency));
    }

    const allResults: SkillExecutionResult[] = [];

    // Execute batches sequentially, skills within batch in parallel
    for (const batch of batches) {
      const batchResults = await Promise.allSettled(
        batch.map((exec) => this.executeSkill(userId, exec.skillId, exec.params, options))
      );

      const results = batchResults.map((result) =>
        result.status === "fulfilled"
          ? result.value
          : { success: false, error: result.reason?.message || "Unknown error" }
      );

      allResults.push(...results);
    }

    console.log(
      `[EXECUTOR] Batch complete: ${allResults.filter((r) => r.success).length}/${allResults.length} succeeded`
    );

    return allResults;
  }

  /**
   * Get available skills (installed + discoverable)
   */
  async getAvailableSkills(
    userId: string,
    options: {
      includeInstalled?: boolean;
      includeRegistry?: boolean;
      category?: string;
    } = {}
  ): Promise<{
    installed: any[];
    registry: any[];
  }> {
    const { includeInstalled = true, includeRegistry = true, category } = options;

    const result: { installed: any[]; registry: any[] } = {
      installed: [],
      registry: [],
    };

    // Get installed skills
    if (includeInstalled) {
      result.installed = await this.installer.listInstalledSkills(userId);
    }

    // Get registry skills
    if (includeRegistry) {
      const searchResult = await this.discovery.searchSkills("", {
        limit: 100,
        category,
      });
      result.registry = searchResult.skills;
    }

    return result;
  }
}
