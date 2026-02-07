/**
 * Skill Installer
 *
 * Orchestrates the full skill installation flow:
 * 1. Download code (with hash verification)
 * 2. Security audit (static + AI + sandbox)
 * 3. Store in database
 * 4. Load into V8 runtime
 */

import { SkillDiscovery, SkillManifest } from "./discovery.js";
import { SkillDownloader } from "./downloader.js";
import { SkillAuditor } from "./auditor.js";
import { getSupabaseClient } from "../utils/supabase.js";
import vm from "vm";

export interface SkillInstallationResult {
  success: boolean;
  skillId: string;
  auditPassed: boolean;
  securityScore: number;
  installedAt?: string;
  error?: string;
}

export class SkillInstaller {
  private discovery: SkillDiscovery;
  private downloader: SkillDownloader;
  private auditor: SkillAuditor;

  constructor() {
    this.discovery = new SkillDiscovery();
    this.downloader = new SkillDownloader();
    this.auditor = new SkillAuditor();
  }

  /**
   * Install a skill from any source
   */
  async installSkill(
    skillId: string,
    userId?: string,
    options: {
      skipAudit?: boolean;
      forceReinstall?: boolean;
    } = {}
  ): Promise<SkillInstallationResult> {
    const { skipAudit = false, forceReinstall = false } = options;

    console.log(`[INSTALLER] Installing skill: ${skillId}`);

    try {
      // Step 1: Fetch skill manifest from registry
      const skill = await this.discovery.getSkill(skillId);

      if (!skill) {
        return {
          success: false,
          skillId,
          auditPassed: false,
          securityScore: 0,
          error: "Skill not found in registry",
        };
      }

      console.log(`[INSTALLER] Found skill: ${skill.name} from ${skill.source}`);

      // Step 2: Check if already installed (unless forceReinstall)
      if (!forceReinstall && userId) {
        const existing = await this.isSkillInstalled(userId, skillId);
        if (existing) {
          console.log(`[INSTALLER] Skill already installed for user ${userId}`);
          return {
            success: true,
            skillId,
            auditPassed: true,
            securityScore: 100, // Already audited
            installedAt: existing.installed_at,
          };
        }
      }

      // Step 3: Download skill code
      console.log(`[INSTALLER] Downloading code from ${skill.codeUrl}...`);
      const downloadResult = await this.downloader.downloadSkill(skill);

      if (!downloadResult.success || !downloadResult.code) {
        return {
          success: false,
          skillId,
          auditPassed: false,
          securityScore: 0,
          error: downloadResult.error || "Download failed",
        };
      }

      console.log(
        `[INSTALLER] Downloaded ${downloadResult.size} bytes, hash: ${downloadResult.hash?.slice(0, 16)}...`
      );

      // Step 4: Verify code hash (prevent tampering)
      if (skill.codeHash) {
        const hashMatch = this.downloader.verifyHash(downloadResult.code, skill.codeHash);
        if (!hashMatch) {
          return {
            success: false,
            skillId,
            auditPassed: false,
            securityScore: 0,
            error: "Code hash mismatch - potential tampering detected",
          };
        }
        console.log(`[INSTALLER] Hash verified ✓`);
      }

      // Step 5: Security audit
      let auditResult;
      if (!skipAudit) {
        console.log(`[INSTALLER] Starting security audit...`);
        auditResult = await this.auditor.auditSkill({
          code: downloadResult.code,
          manifest: skill,
          source: skill.source,
        });

        console.log(`[INSTALLER] Audit complete: ${auditResult.securityScore}/100`);

        if (!auditResult.passed || auditResult.securityScore < 85) {
          // Log security failure
          await this.logSecurityFailure(skillId, auditResult);

          return {
            success: false,
            skillId,
            auditPassed: false,
            securityScore: auditResult.securityScore,
            error: `Security audit failed: ${auditResult.issues.slice(0, 3).join(", ")}`,
          };
        }
      } else {
        console.log(`[INSTALLER] Skipping audit (skipAudit=true)`);
        auditResult = {
          passed: true,
          securityScore: 100,
          issues: [],
          report: {} as any,
        };
      }

      // Step 6: Store skill in database
      if (userId) {
        console.log(`[INSTALLER] Storing in database for user ${userId}...`);
        await this.storeSkill(userId, skillId, downloadResult.code, skill, auditResult);
      } else {
        console.log(`[INSTALLER] Storing globally (no user specified)...`);
        await this.storeSkillGlobally(skillId, downloadResult.code, skill, auditResult);
      }

      // Step 7: Load into runtime
      console.log(`[INSTALLER] Loading into V8 runtime...`);
      await this.loadSkillIntoRuntime(skillId, downloadResult.code, skill.sandbox || {});

      const installedAt = new Date().toISOString();

      console.log(`[INSTALLER] ✅ Installation complete: ${skillId}`);

      return {
        success: true,
        skillId,
        auditPassed: true,
        securityScore: auditResult.securityScore,
        installedAt,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[INSTALLER] Installation failed:`, error);

      return {
        success: false,
        skillId,
        auditPassed: false,
        securityScore: 0,
        error: msg,
      };
    }
  }

  /**
   * Check if skill is already installed for user
   */
  private async isSkillInstalled(
    userId: string,
    skillId: string
  ): Promise<{ installed_at: string } | null> {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from("installed_skills")
      .select("installed_at")
      .eq("user_id", userId)
      .eq("skill_id", skillId)
      .single();

    if (error || !data) return null;

    return data;
  }

  /**
   * Store skill in database (per-user)
   */
  private async storeSkill(
    userId: string,
    skillId: string,
    code: string,
    manifest: SkillManifest,
    auditResult: any
  ): Promise<void> {
    const supabase = getSupabaseClient();

    const { error } = await supabase.from("installed_skills").upsert(
      {
        user_id: userId,
        skill_id: skillId,
        code,
        manifest,
        security_score: auditResult.securityScore,
        audit_report: auditResult.report,
        installed_at: new Date().toISOString(),
      },
      { onConflict: "user_id,skill_id" }
    );

    if (error) {
      throw new Error(`Failed to store skill: ${error.message}`);
    }
  }

  /**
   * Store skill globally (no user specified)
   */
  private async storeSkillGlobally(
    skillId: string,
    code: string,
    manifest: SkillManifest,
    auditResult: any
  ): Promise<void> {
    // For global skills, store with a system user ID or in a separate table
    // For now, skip database storage for global installs
    console.log(`[INSTALLER] Global storage not yet implemented, skipping DB`);
  }

  /**
   * Load skill into V8 runtime
   */
  private async loadSkillIntoRuntime(
    skillId: string,
    code: string,
    sandbox: {
      allowedAPIs?: string[];
      allowedDomains?: string[];
      memoryLimit?: string;
      timeoutMs?: number;
    }
  ): Promise<void> {
    // Create sandboxed fetch
    const createSandboxedFetch = (allowedDomains: string[]) => {
      return async (url: string, options?: RequestInit) => {
        const urlObj = new URL(url);
        const allowed = allowedDomains.some((domain) => urlObj.hostname.includes(domain));

        if (!allowed) {
          throw new Error(`Network access denied: ${urlObj.hostname} not in allowed domains`);
        }

        return fetch(url, options);
      };
    };

    // Create isolated V8 context with limited permissions
    const context = vm.createContext({
      fetch: createSandboxedFetch(sandbox.allowedDomains || []),
      console: {
        log: (...args: any[]) => console.log(`[SKILL:${skillId}]`, ...args),
        error: (...args: any[]) => console.error(`[SKILL:${skillId}]`, ...args),
      },
      setTimeout,
      clearTimeout,
      // No file system, no process, no require
    });

    // Execute code in context
    vm.runInContext(code, context, {
      timeout: sandbox.timeoutMs || 30000,
      displayErrors: true,
    });

    // Store context in global skill executor registry
    if (!globalThis.SKILL_EXECUTORS) {
      globalThis.SKILL_EXECUTORS = {};
    }

    globalThis.SKILL_EXECUTORS[skillId] = context;

    console.log(`[INSTALLER] Skill loaded into runtime: ${skillId}`);
  }

  /**
   * Log security audit failure
   */
  private async logSecurityFailure(skillId: string, auditResult: any): Promise<void> {
    const supabase = getSupabaseClient();

    await supabase.from("error_logs").insert({
      level: "warn",
      message: `Skill audit failed: ${skillId}`,
      context: {
        skillId,
        securityScore: auditResult.securityScore,
        issues: auditResult.issues.slice(0, 10),
      },
    });
  }

  /**
   * Uninstall skill
   */
  async uninstallSkill(userId: string, skillId: string): Promise<boolean> {
    try {
      const supabase = getSupabaseClient();

      // Remove from database
      const { error } = await supabase
        .from("installed_skills")
        .delete()
        .eq("user_id", userId)
        .eq("skill_id", skillId);

      if (error) {
        console.error(`[INSTALLER] Uninstall failed:`, error);
        return false;
      }

      // Remove from runtime
      if (globalThis.SKILL_EXECUTORS && globalThis.SKILL_EXECUTORS[skillId]) {
        delete globalThis.SKILL_EXECUTORS[skillId];
      }

      console.log(`[INSTALLER] Uninstalled: ${skillId}`);
      return true;
    } catch (error) {
      console.error(`[INSTALLER] Uninstall error:`, error);
      return false;
    }
  }

  /**
   * List all installed skills for user
   */
  async listInstalledSkills(userId: string): Promise<SkillManifest[]> {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from("installed_skills")
      .select("manifest")
      .eq("user_id", userId)
      .order("installed_at", { ascending: false });

    if (error || !data) {
      console.error(`[INSTALLER] List failed:`, error);
      return [];
    }

    return data.map((row: { manifest: unknown }) => row.manifest as SkillManifest);
  }
}

// Global skill executor registry
declare global {
  var SKILL_EXECUTORS: Record<string, vm.Context>;
}
