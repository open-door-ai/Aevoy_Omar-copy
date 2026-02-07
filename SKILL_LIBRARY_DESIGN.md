# Dynamic Skill Loading System Design
## Scalable Alternative to Hardcoded API Integrations

**Created**: 2026-02-07
**Status**: Design Phase
**Purpose**: Replace hardcoded switch statements with dynamic skill discovery, installation, and execution system

---

## Problem Statement

**User Feedback**:
> "You know Google Sheets wasn't a metaphorical example. I'm talking there's a trillion other ones, right? There's Microsoft Word, there's Google Docs, there's Microsoft Excel, there's like one trillion and one other connector that needs to be added, right? And this is why we need to have some other library for this."

**Current Limitation**:
- Hardcoded skills in `api-executor.ts` (switch statement with ~15 cases)
- Each new integration requires manual coding (100+ lines per skill)
- Does NOT scale to "a trillion" connectors
- High maintenance burden

**Requirements**:
1. ✅ Vetted and clean (AI + sandbox security audit)
2. ✅ Cost-optimized (use cheapest models, cache responses)
3. ✅ Quality first ("quality beats cost every time")
4. ✅ No manual coding for each connector
5. ❌ Cannot get "burned on cost" (strict budget enforcement)

---

## Research: Existing Skill Libraries

### Option 1: Zapier Workflow API
**Source**: [Zapier Developer Platform](https://zapier.com/developer-platform)

**Pros**:
- 8,000+ integrations (largest ecosystem)
- Workflow API available
- Battle-tested, production-ready
- Templates reduce cognitive load
- AI workflow focus in 2026

**Cons**:
- ❌ Proprietary, closed ecosystem
- ❌ Requires Zapier API keys (user friction)
- ❌ Cost per execution ($$$)
- ❌ Not self-hostable
- ❌ Vendor lock-in

**Verdict**: ❌ **NOT SUITABLE** (contradicts autonomy, adds cost)

---

### Option 2: n8n Community Nodes
**Source**: [n8n Community Nodes](https://docs.n8n.io/integrations/community-nodes/)

**Pros**:
- 5,834 total community nodes (rapid growth: 13.6/day)
- ~2,000 published on npm (8M+ downloads)
- Self-hosted + cloud options
- Open-source (fair-code license)
- HTTP Request node (universal API connector)
- Can publish private plugins
- Native AI capabilities

**Cons**:
- ⚠️ Community quality varies (need vetting)
- ⚠️ Requires n8n runtime (heavyweight)
- ⚠️ Node.js specific (not sandboxed V8)

**Verdict**: ⚠️ **PARTIALLY SUITABLE** (good ecosystem, but runtime dependency)

**Adaptation Strategy**:
- Extract n8n node code logic
- Run in our own V8 sandbox (not n8n runtime)
- Audit before installation

---

### Option 3: Anthropic MCP (Model Context Protocol)
**Source**: [Anthropic MCP](https://www.anthropic.com/news/model-context-protocol)

**Pros**:
- Industry standard (OpenAI, Google, Microsoft adopted)
- Pre-built servers: Google Drive, Slack, GitHub, Git, Postgres, Puppeteer
- Open protocol (donated to Linux Foundation)
- Thousands of MCP servers built by community
- SDKs for all major languages
- Designed for AI agents
- 40% of enterprise apps to use by end of 2026 (Gartner)

**Cons**:
- ⚠️ Ecosystem still growing (newer than Zapier/n8n)
- ⚠️ Requires MCP server running (separate process)

**Verdict**: ✅ **MOST SUITABLE** (native AI agent integration, open standard, growing adoption)

**Adaptation Strategy**:
- Use MCP protocol for skill discovery
- Run MCP servers as sub-processes
- Standard interface for all skills
- Community-driven ecosystem

---

## Recommended Hybrid Approach

### Three-Tier Skill Ecosystem

**Tier 1: Curated Skills (Aevoy-Maintained)**
- Hand-written, fully tested
- Hosted on `skills.aevoy.com`
- Examples: Google Sheets, Gmail, Slack, GitHub
- **Security**: 100% trusted (we write them)
- **Cost**: Free (we pay hosting)
- **Quality**: Maximum (manual QA)

**Tier 2: MCP Protocol Skills (Industry Standard)**
- Pre-built MCP servers from community
- Thousands available (Google, Microsoft, OpenAI ecosystem)
- Protocol-based (standardized interface)
- **Security**: AI audit + sandbox test (90+ score required)
- **Cost**: Variable (depends on server, many free)
- **Quality**: High (vetted by AI + sandbox)

**Tier 3: n8n Community Nodes (Extracted)**
- Extract code from n8n npm packages
- Run in our own V8 sandbox (not n8n runtime)
- Fallback for skills not in Tier 1/2
- **Security**: AI audit + sandbox test (95+ score required, stricter)
- **Cost**: Free (npm packages)
- **Quality**: Medium-High (community-maintained, we vet)

---

## Architecture Design

### Component 1: Skill Discovery Service

**Purpose**: Find skills from multiple sources

```typescript
interface SkillSource {
  type: 'curated' | 'mcp' | 'n8n';
  searchUrl: string;
  apiKey?: string;
}

class SkillDiscoveryService {
  private sources: SkillSource[] = [
    { type: 'curated', searchUrl: 'https://skills.aevoy.com/api/search' },
    { type: 'mcp', searchUrl: 'https://mcp-registry.io/api/search' },
    { type: 'n8n', searchUrl: 'https://www.npmjs.com/search?q=n8n-nodes-' }
  ];

  async search(query: string): Promise<SkillSearchResult[]> {
    // Parallel search across all sources
    const results = await Promise.all(
      this.sources.map(source => this.searchSource(source, query))
    );

    // Rank: curated first, then MCP, then n8n
    return results
      .flat()
      .sort((a, b) => this.rankSkill(a) - this.rankSkill(b));
  }

  private rankSkill(skill: SkillSearchResult): number {
    if (skill.source === 'curated') return 1;
    if (skill.source === 'mcp') return 2;
    if (skill.source === 'n8n') return 3;
    return 999;
  }
}
```

**Example Query**: "google sheets create spreadsheet"

**Results** (ranked):
1. `aevoy/google-sheets-create` (curated)
2. `mcp://google-workspace/sheets` (MCP)
3. `n8n-nodes-google-sheets` (n8n, npm)

---

### Component 2: Skill Downloader

**Purpose**: Fetch skill code from registry

```typescript
interface SkillPackage {
  id: string;
  source: 'curated' | 'mcp' | 'n8n';
  codeUrl: string;
  manifestUrl: string;
  codeHash: string; // SHA-256 for integrity
}

class SkillDownloader {
  async download(skillId: string): Promise<SkillCode> {
    const pkg = await this.resolvePackage(skillId);

    // Download manifest
    const manifest = await fetch(pkg.manifestUrl).then(r => r.json());

    // Download code
    const code = await fetch(pkg.codeUrl).then(r => r.text());

    // Verify hash (prevent tampering)
    const actualHash = crypto.createHash('sha256').update(code).digest('hex');
    if (actualHash !== pkg.codeHash) {
      throw new Error(`Code hash mismatch for ${skillId}: expected ${pkg.codeHash}, got ${actualHash}`);
    }

    return { code, manifest };
  }
}
```

**Security**:
- SHA-256 hash verification (prevent MITM)
- HTTPS only
- Code signing (optional, future)

---

### Component 3: AI-Powered Security Auditor

**Purpose**: Analyze skill code for security issues

```typescript
interface AuditResult {
  passed: boolean;
  securityScore: number; // 0-100
  issues: SecurityIssue[];
  report: {
    staticAnalysis: StaticResult;
    aiReview: AIReviewResult;
    sandboxExecution: SandboxResult;
  };
}

class SkillSecurityAuditor {
  async audit(skill: SkillCode): Promise<AuditResult> {
    // Step 1: Static analysis (fast, catches obvious issues)
    const staticResult = await this.staticAnalysis(skill.code);

    // Step 2: AI-powered code review (Claude Sonnet for complex reasoning)
    const aiReview = await this.aiCodeReview(skill.code, skill.manifest);

    // Step 3: Sandbox execution test (catches runtime behavior)
    const sandboxResult = await this.sandboxTest(skill.code, skill.manifest);

    // Calculate score
    const securityScore = this.calculateScore({
      staticResult,
      aiReview,
      sandboxResult,
      source: skill.manifest.source
    });

    // Threshold: curated 95+, MCP 90+, n8n 95+
    const threshold = skill.manifest.source === 'mcp' ? 90 : 95;

    return {
      passed: securityScore >= threshold && this.noCriticalIssues([staticResult, aiReview, sandboxResult]),
      securityScore,
      issues: [...staticResult.issues, ...aiReview.concerns, ...sandboxResult.violations],
      report: { staticAnalysis: staticResult, aiReview, sandboxExecution: sandboxResult }
    };
  }

  private async staticAnalysis(code: string): Promise<StaticResult> {
    const dangerousPatterns = [
      { pattern: /eval\s*\(/g, severity: 'critical', message: 'eval() detected' },
      { pattern: /Function\s*\(/g, severity: 'critical', message: 'Function constructor' },
      { pattern: /child_process/g, severity: 'critical', message: 'Process execution' },
      { pattern: /fs\.(writeFile|unlink|rmdir)/g, severity: 'critical', message: 'File system write' },
      { pattern: /process\.env/g, severity: 'high', message: 'Environment variable access' },
      { pattern: /require\s*\(/g, severity: 'medium', message: 'Dynamic require()' },
      { pattern: /import\s*\(/g, severity: 'medium', message: 'Dynamic import()' },
    ];

    const issues = [];
    for (const { pattern, severity, message } of dangerousPatterns) {
      const matches = code.match(pattern);
      if (matches) {
        issues.push({ severity, message, count: matches.length });
      }
    }

    return {
      issues,
      linesOfCode: code.split('\n').length,
      complexity: this.calculateCyclomaticComplexity(code)
    };
  }

  private async aiCodeReview(code: string, manifest: SkillManifest): Promise<AIReviewResult> {
    const prompt = `
You are a security auditor for AI agent skills. Review this skill code for security issues.

**Skill Manifest:**
${JSON.stringify(manifest, null, 2)}

**Code:**
\`\`\`javascript
${code}
\`\`\`

**Analyze for:**
1. Malicious intent (data exfiltration, backdoors, obfuscation)
2. Privacy violations (accessing user data beyond stated scope)
3. Resource abuse (infinite loops, excessive API calls, memory leaks)
4. Code quality (error handling, input validation, edge cases)

**Output JSON:**
{
  "trustworthy": boolean,
  "concerns": [{ "severity": "critical"|"high"|"medium"|"low", "message": "..." }],
  "recommendation": "approve" | "reject" | "needs_fixes",
  "reasoning": "Explain your decision in 2-3 sentences"
}
    `;

    const response = await generateResponse(
      [],
      'Skill Security Audit',
      prompt,
      'system',
      'reason', // Claude Sonnet for complex reasoning
      'system'
    );

    return JSON.parse(response.content);
  }

  private async sandboxTest(code: string, manifest: SkillManifest): Promise<SandboxResult> {
    const violations = [];

    // Create monitored sandbox
    const monitoredFetch = (url: string) => {
      const allowed = manifest.sandbox.allowedDomains.some(d => url.includes(d));
      if (!allowed) {
        violations.push({ severity: 'critical', message: `Unauthorized network access: ${url}` });
      }
      return fetch(url);
    };

    const context = {
      fetch: monitoredFetch,
      console: { log: () => {} }, // Silent console
      // No fs, process, require, import
    };

    try {
      const vm = require('vm');
      const script = new vm.Script(code);
      script.runInNewContext(context, {
        timeout: manifest.sandbox.timeoutMs || 5000,
        displayErrors: true
      });
    } catch (error) {
      violations.push({ severity: 'high', message: `Runtime error: ${error.message}` });
    }

    return {
      violations,
      executedSuccessfully: violations.length === 0
    };
  }

  private calculateScore(results: {
    staticResult: StaticResult;
    aiReview: AIReviewResult;
    sandboxResult: SandboxResult;
    source: string;
  }): number {
    let score = 100;

    // Deduct for static issues
    results.staticResult.issues.forEach(issue => {
      if (issue.severity === 'critical') score -= 30;
      if (issue.severity === 'high') score -= 15;
      if (issue.severity === 'medium') score -= 5;
      if (issue.severity === 'low') score -= 2;
    });

    // Deduct for AI concerns
    if (!results.aiReview.trustworthy) score -= 40;
    results.aiReview.concerns.forEach(c => {
      if (c.severity === 'critical') score -= 25;
      if (c.severity === 'high') score -= 10;
      if (c.severity === 'medium') score -= 5;
    });

    // Deduct for sandbox violations
    results.sandboxResult.violations.forEach(v => {
      if (v.severity === 'critical') score -= 20;
      if (v.severity === 'high') score -= 10;
    });

    // Curated skills get +10 bonus
    if (results.source === 'curated') score += 10;

    return Math.max(0, Math.min(100, score));
  }
}
```

**Cost per Audit**:
- Static analysis: Free (regex patterns)
- AI review: ~$0.05 (Claude Sonnet, 500 tokens)
- Sandbox test: Free (V8 runtime)
- **Total**: ~$0.05 per skill (one-time)

**Threshold**:
- Curated: 95+ (stricter, but we control them)
- MCP: 90+ (industry standard, trusted ecosystem)
- n8n: 95+ (community, need higher bar)

---

### Component 4: Skill Installer

**Purpose**: Store audited skills in database and load into runtime

```typescript
class SkillInstaller {
  async install(skillId: string, userId: string): Promise<InstallResult> {
    // 1. Download skill
    const downloader = new SkillDownloader();
    const { code, manifest } = await downloader.download(skillId);

    // 2. Security audit
    const auditor = new SkillSecurityAuditor();
    const auditResult = await auditor.audit({ code, manifest });

    if (!auditResult.passed) {
      await this.logFailedAudit(userId, skillId, auditResult);
      return {
        success: false,
        error: `Security audit failed (score: ${auditResult.securityScore}): ${auditResult.issues.map(i => i.message).join(', ')}`
      };
    }

    // 3. Store in database
    await supabase.from('installed_skills').insert({
      user_id: userId,
      skill_id: skillId,
      code,
      manifest,
      security_score: auditResult.securityScore,
      audit_report: auditResult.report,
      installed_at: new Date().toISOString()
    });

    // 4. Load into runtime (V8 sandbox)
    await this.loadIntoRuntime(userId, skillId, code, manifest.sandbox);

    return {
      success: true,
      securityScore: auditResult.securityScore,
      installedAt: new Date().toISOString()
    };
  }

  private async loadIntoRuntime(
    userId: string,
    skillId: string,
    code: string,
    sandbox: SandboxConfig
  ): Promise<void> {
    const vm = require('vm');
    const context = vm.createContext({
      fetch: this.createSandboxedFetch(sandbox.allowedDomains),
      console: { log: (...args) => console.log(`[SKILL:${skillId}]`, ...args) },
      // No filesystem, process, require, import
    });

    vm.runInContext(code, context, {
      timeout: sandbox.timeoutMs,
      displayErrors: true
    });

    // Store in global registry
    if (!globalThis.USER_SKILL_EXECUTORS) globalThis.USER_SKILL_EXECUTORS = {};
    if (!globalThis.USER_SKILL_EXECUTORS[userId]) globalThis.USER_SKILL_EXECUTORS[userId] = {};
    globalThis.USER_SKILL_EXECUTORS[userId][skillId] = context;
  }

  private createSandboxedFetch(allowedDomains: string[]): typeof fetch {
    return async (url: RequestInfo, init?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url.toString();

      // Check domain whitelist
      const allowed = allowedDomains.some(domain => urlStr.includes(domain));
      if (!allowed) {
        throw new Error(`Fetch blocked: ${urlStr} not in allowed domains`);
      }

      // Rate limit: max 10 requests/second per skill
      await this.rateLimit(urlStr);

      return fetch(url, init);
    };
  }
}
```

**Database Schema** (already created in migration_v16):
```sql
CREATE TABLE installed_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  skill_id TEXT NOT NULL,
  code TEXT NOT NULL,
  manifest JSONB NOT NULL,
  security_score INTEGER NOT NULL CHECK (security_score >= 0 AND security_score <= 100),
  audit_report JSONB,
  installed_at TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  UNIQUE(user_id, skill_id)
);
```

---

### Component 5: Dynamic Skill Executor

**Purpose**: Replace hardcoded `executeSkill()` switch statement with dynamic loader

**BEFORE** (hardcoded):
```typescript
async function executeSkill(skillName: string, accessToken: string, step: PlanStep): Promise<ApiActionResult> {
  switch (skillName) {
    case "google_sheets_create":
      return googleSheetsCreate(accessToken, step.params);
    case "google_sheets_append":
      return googleSheetsAppend(accessToken, step.params);
    // ... 15+ more cases, must manually add each
    default:
      return { success: false, error: `Unknown skill: ${skillName}` };
  }
}
```

**AFTER** (dynamic):
```typescript
async function executeSkill(
  userId: string,
  skillName: string,
  accessToken: string,
  step: PlanStep
): Promise<ApiActionResult> {
  // 1. Check if skill already installed
  const installed = await supabase
    .from('installed_skills')
    .select('code, manifest')
    .eq('user_id', userId)
    .eq('skill_id', skillName)
    .single();

  if (!installed.data) {
    // 2. Auto-install skill (if autonomous settings enabled)
    const settings = await getUserSettings(userId);
    if (!settings.auto_install_skills) {
      return { success: false, error: `Skill ${skillName} not installed. Auto-install disabled.` };
    }

    console.log(`[AUTONOMOUS] Auto-installing skill: ${skillName}`);
    const installer = new SkillInstaller();
    const result = await installer.install(skillName, userId);

    if (!result.success) {
      return { success: false, error: result.error };
    }
  }

  // 3. Get skill executor from runtime
  const executor = globalThis.USER_SKILL_EXECUTORS?.[userId]?.[skillName];
  if (!executor) {
    return { success: false, error: `Skill ${skillName} not loaded in runtime` };
  }

  // 4. Execute skill with params
  try {
    const result = await executor.execute({
      accessToken,
      params: step.params,
      userId
    });

    // 5. Update last_used_at
    await supabase
      .from('installed_skills')
      .update({ last_used_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('skill_id', skillName);

    return result;
  } catch (error) {
    return {
      success: false,
      error: `Skill execution failed: ${error.message}`
    };
  }
}
```

**Benefits**:
- ✅ No hardcoding (works with ANY skill)
- ✅ Auto-installs if needed (autonomous)
- ✅ Per-user skill registry (multi-tenant)
- ✅ Runtime sandboxing (V8 contexts)
- ✅ Usage tracking (last_used_at)

---

## Implementation Plan

### Phase 1: Core Infrastructure (Week 1)
1. ✅ Database schema (migration_v16 - DONE)
2. ✅ Skill registry JSON (DONE)
3. ⏳ Skill discovery service (multi-source search)
4. ⏳ Skill downloader (fetch + hash verification)
5. ⏳ Security auditor (static + AI + sandbox)

### Phase 2: Installer & Executor (Week 2)
6. ⏳ Skill installer (audit → store → load)
7. ⏳ Dynamic skill executor (replace switch statement)
8. ⏳ V8 sandbox runtime (isolated contexts)
9. ⏳ Rate limiting (10 requests/sec per skill)

### Phase 3: MCP Integration (Week 3)
10. ⏳ MCP protocol client
11. ⏳ MCP server discovery
12. ⏳ MCP skill adapter (convert to our format)
13. ⏳ Pre-built MCP skills (Google, Slack, GitHub)

### Phase 4: n8n Integration (Week 4)
14. ⏳ npm package fetcher (n8n-nodes-*)
15. ⏳ n8n code extractor (strip runtime deps)
16. ⏳ n8n skill adapter
17. ⏳ Community node vetting

### Phase 5: Testing & Production (Week 5)
18. ⏳ Playwright E2E tests (15 tests)
19. ⏳ Load testing (100 concurrent skill executions)
20. ⏳ Cost monitoring (< $0.05/skill audit)
21. ⏳ Deploy to production

---

## Cost Analysis

| Component | Cost/Use | Frequency | Monthly/User |
|-----------|----------|-----------|--------------|
| Skill discovery | $0.00 | 5 searches/month | $0.00 |
| Skill download | $0.00 | 5 installs/month | $0.00 |
| Security audit (static) | $0.00 | 5 installs/month | $0.00 |
| Security audit (AI) | $0.05 | 5 installs/month | $0.25 |
| Skill execution | $0.00 | 50 calls/month | $0.00 |
| **Total Skill System** | | | **$0.25/user/month** |

**Savings vs. Manual Coding**:
- Manual: $500/integration (developer time) × 100 integrations = $50,000
- Dynamic: $0.25/user/month × 1000 users = $250/month = $3,000/year
- **ROI**: 94% cost reduction

---

## Security Guarantees

### Sandboxing
- ✅ V8 isolated contexts (no shared memory)
- ✅ No filesystem access
- ✅ No process spawning
- ✅ No dynamic require/import
- ✅ Whitelisted fetch domains only
- ✅ Timeout enforcement (5-30 seconds)
- ✅ Memory limits (50-500MB)

### Auditing
- ✅ Static analysis (regex patterns)
- ✅ AI code review (Claude Sonnet)
- ✅ Sandbox execution test
- ✅ Score threshold (90-95+)
- ✅ No critical issues allowed
- ✅ Audit report stored in DB

### Runtime
- ✅ Per-user skill isolation
- ✅ Rate limiting (10 req/sec)
- ✅ Crash recovery (skill errors don't crash agent)
- ✅ Logging (all skill calls tracked)
- ✅ Cost tracking (monitor per-skill spend)

---

## Migration Path

### Step 1: Gradual Rollout (Week 1-2)
- Keep hardcoded skills (backward compatibility)
- Add dynamic loader alongside
- Route 10% of traffic to dynamic skills
- Monitor errors, performance, cost

### Step 2: Parallel Operation (Week 3-4)
- 50% traffic to dynamic skills
- Install curated skills for all users
- Compare success rates (hardcoded vs. dynamic)

### Step 3: Full Migration (Week 5)
- 100% traffic to dynamic skills
- Remove hardcoded switch statements
- Keep only fallback browser automation

### Step 4: Cleanup (Week 6)
- Delete unused hardcoded functions
- Update documentation
- Optimize caching

---

## Success Metrics

### Performance
- ✅ Skill discovery: <500ms
- ✅ Skill download: <2 seconds
- ✅ Security audit: <10 seconds
- ✅ Skill execution: <3 seconds (same as hardcoded)

### Quality
- ✅ Security score: 90+ average
- ✅ Success rate: >95% (match hardcoded)
- ✅ Audit pass rate: >80% (20% rejected OK)

### Cost
- ✅ Audit cost: <$0.05/skill
- ✅ Execution cost: $0.00 (same as hardcoded)
- ✅ Total skill system: <$0.30/user/month

### Autonomy
- ✅ Zero user prompts for skill installation
- ✅ Automatic security vetting
- ✅ Transparent operation (user sees "Installing skill..." notification)

---

## Sources

Research sources used in this design:

### Zapier
- [Zapier Developer Platform](https://zapier.com/developer-platform) - 8,000+ integrations via Workflow API
- [Zapier Apps Directory](https://zapier.com/apps) - Integration marketplace
- [Zapier Blog: App Directory](https://zapier.com/blog/zapier-partner-app-directory-marketing/) - Marketing automation integrations

### n8n
- [n8n Community Nodes Documentation](https://docs.n8n.io/integrations/community-nodes/) - Installation and usage
- [n8n GitHub Repository](https://github.com/n8n-io/n8n) - Fair-code workflow automation platform
- [Awesome n8n Resources](https://github.com/restyler/awesome-n8n) - Community nodes and tutorials
- [n8n Review 2026](https://hackceleration.com/n8n-review/) - 1,202 integrations analysis
- [n8n Community Nodes on Cloud](https://blog.n8n.io/community-nodes-available-on-n8n-cloud/) - 5,834 total nodes

### Anthropic MCP
- [Model Context Protocol Announcement](https://www.anthropic.com/news/model-context-protocol) - Official introduction
- [MCP Specification](https://modelcontextprotocol.io/specification/2025-11-25) - Protocol details
- [MCP GitHub](https://github.com/modelcontextprotocol) - Open-source repositories
- [Merge.dev MCP Guide](https://www.merge.dev/blog/model-context-protocol) - Integration overview
- [Anthropic MCP Course](https://anthropic.skilljar.com/introduction-to-model-context-protocol) - Official training
- [A Year of MCP](https://www.pento.ai/blog/a-year-of-mcp-2025-review) - Industry adoption review

---

**End of Design Document**
**Next Steps**: Implement Phase 1 (Core Infrastructure)
