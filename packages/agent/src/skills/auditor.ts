/**
 * AI-Powered Security Auditor
 *
 * Three-layer security audit:
 * 1. Static analysis (fast pattern matching)
 * 2. AI code review (Claude Sonnet for deep analysis)
 * 3. Sandbox execution test (runtime behavior monitoring)
 */

import { SkillManifest } from "./discovery.js";
import { generateResponse } from "../services/ai.js";
import vm from "vm";

interface StaticAnalysisResult {
  issues: Array<{
    severity: "critical" | "high" | "medium" | "low";
    message: string;
    count?: number;
  }>;
  linesOfCode: number;
  complexity: number;
}

interface AIReviewResult {
  trustworthy: boolean;
  concerns: Array<{
    severity: "critical" | "high" | "medium" | "low";
    message: string;
  }>;
  recommendation: "approve" | "reject" | "needs_fixes";
}

interface SandboxExecutionResult {
  violations: Array<{
    severity: "critical" | "high" | "medium" | "low";
    message: string;
  }>;
  executedSuccessfully: boolean;
}

export interface AuditResult {
  passed: boolean;
  securityScore: number; // 0-100
  issues: string[];
  report: {
    staticAnalysis: StaticAnalysisResult;
    aiReview: AIReviewResult;
    sandboxExecution: SandboxExecutionResult;
  };
}

export class SkillAuditor {
  /**
   * Perform comprehensive security audit
   */
  async auditSkill(params: {
    code: string;
    manifest: SkillManifest;
    source: "curated" | "mcp" | "n8n";
  }): Promise<AuditResult> {
    const { code, manifest, source } = params;

    console.log(`[AUDITOR] Starting audit for skill: ${manifest.id}`);

    // Step 1: Static analysis (fast)
    const staticResult = await this.staticAnalysis(code);
    console.log(`[AUDITOR] Static analysis: ${staticResult.issues.length} issues found`);

    // Step 2: AI-powered code review (Claude Sonnet)
    const aiReview = await this.aiCodeReview(code, manifest);
    console.log(`[AUDITOR] AI review: ${aiReview.recommendation}`);

    // Step 3: Sandbox execution test
    const sandboxResult = await this.sandboxExecutionTest(code, manifest);
    console.log(
      `[AUDITOR] Sandbox test: ${sandboxResult.violations.length} violations found`
    );

    // Calculate security score
    const securityScore = this.calculateSecurityScore({
      staticResult,
      aiReview,
      sandboxResult,
      source,
    });

    console.log(`[AUDITOR] Final security score: ${securityScore}/100`);

    // Aggregate issues
    const issues = [
      ...staticResult.issues.map((i) => `${i.severity}: ${i.message}`),
      ...aiReview.concerns.map((c) => `${c.severity}: ${c.message}`),
      ...sandboxResult.violations.map((v) => `${v.severity}: ${v.message}`),
    ];

    // Determine pass/fail
    const threshold = source === "curated" ? 95 : 90;
    const criticalIssues = [
      ...staticResult.issues,
      ...aiReview.concerns,
      ...sandboxResult.violations,
    ].filter((i) => i.severity === "critical");

    const passed = securityScore >= threshold && criticalIssues.length === 0;

    return {
      passed,
      securityScore,
      issues,
      report: {
        staticAnalysis: staticResult,
        aiReview,
        sandboxExecution: sandboxResult,
      },
    };
  }

  /**
   * Static analysis - pattern-based security checks
   */
  async staticAnalysis(code: string): Promise<StaticAnalysisResult> {
    const dangerousPatterns = [
      {
        pattern: /eval\s*\(/g,
        severity: "critical" as const,
        message: "eval() usage detected - arbitrary code execution risk",
      },
      {
        pattern: /Function\s*\(/g,
        severity: "critical" as const,
        message: "Function constructor usage - code injection risk",
      },
      {
        pattern: /child_process/g,
        severity: "critical" as const,
        message: "child_process module - command execution attempt",
      },
      {
        pattern: /fs\.(writeFile|unlink|rmdir|rm)/g,
        severity: "critical" as const,
        message: "File system write/delete operations detected",
      },
      {
        pattern: /process\.env/g,
        severity: "high" as const,
        message: "Environment variable access - potential credential leak",
      },
      {
        pattern: /require\s*\(\s*['"`][./]/g,
        severity: "high" as const,
        message: "Relative require() - potential path traversal",
      },
      {
        pattern: /\.exec\s*\(/g,
        severity: "high" as const,
        message: "Exec method call - command injection risk",
      },
      {
        pattern: /crypto\.createHash/g,
        severity: "medium" as const,
        message: "Cryptographic operations - verify usage",
      },
      {
        pattern: /Buffer\s*\(/g,
        severity: "medium" as const,
        message: "Deprecated Buffer constructor",
      },
      {
        pattern: /\.then\s*\(\s*\)/g,
        severity: "low" as const,
        message: "Unhandled promise detected",
      },
    ];

    const issues: StaticAnalysisResult["issues"] = [];

    for (const { pattern, severity, message } of dangerousPatterns) {
      const matches = code.match(pattern);
      if (matches) {
        issues.push({
          severity,
          message,
          count: matches.length,
        });
      }
    }

    // Calculate cyclomatic complexity (simplified)
    const complexity = this.calculateCyclomaticComplexity(code);

    return {
      issues,
      linesOfCode: code.split("\n").length,
      complexity,
    };
  }

  /**
   * AI-powered code review using Claude Sonnet
   */
  async aiCodeReview(code: string, manifest: SkillManifest): Promise<AIReviewResult> {
    try {
      const prompt = `You are a security auditor for AI agent skills. Review this skill code for security issues.

**Skill Manifest:**
\`\`\`json
${JSON.stringify(manifest, null, 2)}
\`\`\`

**Code:**
\`\`\`javascript
${code.slice(0, 10000)} ${code.length > 10000 ? "\n... (truncated)" : ""}
\`\`\`

**Analyze for:**
1. Malicious intent (data exfiltration, backdoors, obfuscation)
2. Privacy violations (accessing user data beyond stated scope)
3. Resource abuse (infinite loops, excessive API calls, memory leaks)
4. Code quality (error handling, input validation, edge cases)
5. Compliance with sandbox restrictions

**Output JSON only, no markdown:**
{
  "trustworthy": boolean,
  "concerns": [{ "severity": "critical"|"high"|"medium"|"low", "message": "..." }],
  "recommendation": "approve" | "reject" | "needs_fixes"
}`;

      const aiResponse = await generateResponse(
        { facts: "", recentLogs: "" },
        "Skill Security Audit",
        prompt,
        "system",
        "reason", // Use Claude Sonnet for complex reasoning
        "system"
      );

      // Parse JSON response
      const cleanedContent = aiResponse.content.replace(/```json\n?/g, "").replace(/```\n?/g, "");
      const result = JSON.parse(cleanedContent);

      return {
        trustworthy: result.trustworthy ?? false,
        concerns: result.concerns ?? [],
        recommendation: result.recommendation ?? "reject",
      };
    } catch (error) {
      console.error("[AUDITOR] AI review failed:", error);

      // Fail-safe: reject on error
      return {
        trustworthy: false,
        concerns: [
          {
            severity: "high",
            message: `AI review failed: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        recommendation: "reject",
      };
    }
  }

  /**
   * Sandbox execution test - monitor runtime behavior
   */
  async sandboxExecutionTest(
    code: string,
    manifest: SkillManifest
  ): Promise<SandboxExecutionResult> {
    const violations: SandboxExecutionResult["violations"] = [];

    // Create monitored fetch
    const allowedDomains = manifest.sandbox?.allowedDomains || [];
    const monitoredFetch = (url: string, options?: RequestInit) => {
      const urlObj = new URL(url);
      const allowed = allowedDomains.some((domain) => urlObj.hostname.includes(domain));

      if (!allowed) {
        violations.push({
          severity: "critical",
          message: `Unauthorized network access to ${urlObj.hostname}`,
        });
      }

      // Still allow fetch to test behavior (but logged)
      return fetch(url, options);
    };

    // Create sandbox context
    const context = vm.createContext({
      fetch: monitoredFetch,
      console: {
        log: (...args: any[]) => {
          // Log to auditor console
          console.log("[SANDBOX]", ...args);
        },
        error: (...args: any[]) => {
          console.error("[SANDBOX ERROR]", ...args);
        },
      },
      setTimeout: (fn: Function, ms: number) => {
        if (ms > 30000) {
          violations.push({
            severity: "medium",
            message: `Long timeout detected: ${ms}ms`,
          });
        }
        return setTimeout(fn, ms);
      },
      // No file system, no process, no require
    });

    try {
      // Execute code in sandbox
      const script = new vm.Script(code, {
        filename: manifest.id,
      });

      script.runInContext(context, {
        timeout: manifest.sandbox?.timeoutMs || 5000,
        displayErrors: true,
      });

      // If execution completes without errors, success
      return {
        violations,
        executedSuccessfully: violations.filter((v) => v.severity === "critical").length === 0,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);

      // Check for timeout
      if (msg.includes("timeout")) {
        violations.push({
          severity: "high",
          message: `Execution timeout - potential infinite loop`,
        });
      } else {
        violations.push({
          severity: "high",
          message: `Runtime error: ${msg}`,
        });
      }

      return {
        violations,
        executedSuccessfully: false,
      };
    }
  }

  /**
   * Calculate security score (0-100)
   */
  private calculateSecurityScore(results: {
    staticResult: StaticAnalysisResult;
    aiReview: AIReviewResult;
    sandboxResult: SandboxExecutionResult;
    source: string;
  }): number {
    let score = 100;

    // Deduct for static analysis issues
    for (const issue of results.staticResult.issues) {
      if (issue.severity === "critical") score -= 30;
      else if (issue.severity === "high") score -= 15;
      else if (issue.severity === "medium") score -= 5;
      else if (issue.severity === "low") score -= 2;
    }

    // Deduct for AI concerns
    if (!results.aiReview.trustworthy) score -= 40;
    for (const concern of results.aiReview.concerns) {
      if (concern.severity === "critical") score -= 25;
      else if (concern.severity === "high") score -= 10;
      else if (concern.severity === "medium") score -= 5;
    }

    // Deduct for sandbox violations
    for (const violation of results.sandboxResult.violations) {
      if (violation.severity === "critical") score -= 20;
      else if (violation.severity === "high") score -= 10;
      else if (violation.severity === "medium") score -= 5;
    }

    // Curated skills start with +10 bonus
    if (results.source === "curated") score += 10;

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Calculate cyclomatic complexity (simplified)
   */
  private calculateCyclomaticComplexity(code: string): number {
    // Count decision points: if, for, while, case, &&, ||, ?
    const decisionPoints = [
      /\bif\s*\(/g,
      /\bfor\s*\(/g,
      /\bwhile\s*\(/g,
      /\bcase\s+/g,
      /&&/g,
      /\|\|/g,
      /\?/g,
    ];

    let complexity = 1; // Base complexity

    for (const pattern of decisionPoints) {
      const matches = code.match(pattern);
      if (matches) {
        complexity += matches.length;
      }
    }

    return complexity;
  }
}
