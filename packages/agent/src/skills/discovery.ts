/**
 * Skill Discovery Service
 *
 * Multi-source skill search across:
 * 1. Curated registry (local registry.json)
 * 2. Anthropic MCP registry (https://mcp.so)
 * 3. n8n community nodes (npm registry)
 */

import { getSupabaseClient } from "../utils/supabase.js";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface SkillManifest {
  id: string;
  name: string;
  description: string;
  source: "curated" | "mcp" | "n8n";
  provider: string;
  category: string;
  requiredScopes?: string[];
  costPerUse: number;
  trustLevel: "verified" | "community_verified" | "unverified";
  codeUrl: string;
  codeHash?: string;
  interface: {
    input: Record<string, string>;
    output: Record<string, string>;
  };
  sandbox?: {
    allowedAPIs: string[];
    allowedDomains: string[];
    memoryLimit: string;
    timeoutMs: number;
  };
  version?: string;
  author?: string;
  tags?: string[];
}

export interface SkillSearchResult {
  skills: SkillManifest[];
  totalCount: number;
  sources: {
    curated: number;
    mcp: number;
    n8n: number;
  };
}

export class SkillDiscovery {
  private curatedRegistry: { version: string; skills: SkillManifest[] } | null = null;

  /**
   * Search for skills across all sources
   */
  async searchSkills(
    query: string,
    options: {
      limit?: number;
      sources?: ("curated" | "mcp" | "n8n")[];
      category?: string;
    } = {}
  ): Promise<SkillSearchResult> {
    const { limit = 10, sources = ["curated", "mcp", "n8n"], category } = options;

    const results: SkillManifest[] = [];
    const sourceCounts = { curated: 0, mcp: 0, n8n: 0 };

    // Search curated registry
    if (sources.includes("curated")) {
      const curatedResults = await this.searchCurated(query, category);
      results.push(...curatedResults);
      sourceCounts.curated = curatedResults.length;
    }

    // Search MCP registry
    if (sources.includes("mcp")) {
      const mcpResults = await this.searchMCP(query, category);
      results.push(...mcpResults);
      sourceCounts.mcp = mcpResults.length;
    }

    // Search n8n registry
    if (sources.includes("n8n")) {
      const n8nResults = await this.searchN8n(query, category);
      results.push(...n8nResults);
      sourceCounts.n8n = n8nResults.length;
    }

    // Rank results by relevance
    const rankedResults = this.rankResults(results, query);

    return {
      skills: rankedResults.slice(0, limit),
      totalCount: rankedResults.length,
      sources: sourceCounts,
    };
  }

  /**
   * Get skill by ID from any source
   */
  async getSkill(skillId: string): Promise<SkillManifest | null> {
    // Try curated first
    const curated = await this.getCuratedSkill(skillId);
    if (curated) return curated;

    // Try installed skills
    const installed = await this.getInstalledSkill(skillId);
    if (installed) return installed;

    // Try MCP
    const mcp = await this.getMCPSkill(skillId);
    if (mcp) return mcp;

    // Try n8n
    const n8n = await this.getN8nSkill(skillId);
    if (n8n) return n8n;

    return null;
  }

  /**
   * Search curated registry (local registry.json)
   */
  private async searchCurated(query: string, category?: string): Promise<SkillManifest[]> {
    await this.loadCuratedRegistry();

    if (!this.curatedRegistry) return [];

    const lowerQuery = query.toLowerCase();
    return this.curatedRegistry.skills.filter((skill) => {
      const matchesQuery =
        skill.name.toLowerCase().includes(lowerQuery) ||
        skill.description.toLowerCase().includes(lowerQuery) ||
        skill.id.toLowerCase().includes(lowerQuery) ||
        skill.provider.toLowerCase().includes(lowerQuery);

      const matchesCategory = category ? skill.category === category : true;

      return matchesQuery && matchesCategory;
    });
  }

  /**
   * Search Anthropic MCP registry via web scraping
   */
  private async searchMCP(query: string, category?: string): Promise<SkillManifest[]> {
    try {
      // MCP registry URL: https://mcp.so
      // For now, return empty (will implement web scraping in next phase)
      // TODO: Implement MCP registry search via puppeteer/cheerio
      console.log(`[SKILL-DISCOVERY] MCP search for "${query}" - not yet implemented`);
      return [];
    } catch (error) {
      console.error("[SKILL-DISCOVERY] MCP search failed:", error);
      return [];
    }
  }

  /**
   * Search n8n community nodes via npm registry API
   */
  private async searchN8n(query: string, category?: string): Promise<SkillManifest[]> {
    try {
      // npm search API: https://registry.npmjs.org/-/v1/search?text=n8n-nodes-{query}
      const searchUrl = `https://registry.npmjs.org/-/v1/search?text=n8n-nodes-${encodeURIComponent(
        query
      )}&size=10`;

      const response = await fetch(searchUrl);
      if (!response.ok) {
        console.error(`[SKILL-DISCOVERY] npm search failed: ${response.status}`);
        return [];
      }

      const data = await response.json();

      // Convert npm packages to SkillManifest format
      const skills: SkillManifest[] = data.objects.map((pkg: any) => ({
        id: pkg.package.name,
        name: pkg.package.name.replace("n8n-nodes-", ""),
        description: pkg.package.description || "No description",
        source: "n8n" as const,
        provider: pkg.package.publisher?.username || "unknown",
        category: category || "general",
        costPerUse: 0,
        trustLevel: "community_verified" as const,
        codeUrl: pkg.package.links?.npm || "",
        version: pkg.package.version,
        author: pkg.package.author?.name,
        interface: {
          input: {},
          output: {},
        },
      }));

      return skills;
    } catch (error) {
      console.error("[SKILL-DISCOVERY] n8n search failed:", error);
      return [];
    }
  }

  /**
   * Load curated registry from registry.json
   */
  private async loadCuratedRegistry(): Promise<void> {
    if (this.curatedRegistry) return;

    try {
      const registryPath = path.join(__dirname, "registry.json");
      const content = await fs.readFile(registryPath, "utf-8");
      this.curatedRegistry = JSON.parse(content);
    } catch (error) {
      console.error("[SKILL-DISCOVERY] Failed to load curated registry:", error);
      this.curatedRegistry = { version: "1.0.0", skills: [] };
    }
  }

  /**
   * Get curated skill by ID
   */
  private async getCuratedSkill(skillId: string): Promise<SkillManifest | null> {
    await this.loadCuratedRegistry();
    if (!this.curatedRegistry) return null;

    return this.curatedRegistry.skills.find((s) => s.id === skillId) || null;
  }

  /**
   * Get installed skill from database
   */
  private async getInstalledSkill(skillId: string): Promise<SkillManifest | null> {
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from("installed_skills")
        .select("manifest")
        .eq("skill_id", skillId)
        .single();

      if (error || !data) return null;

      return data.manifest as SkillManifest;
    } catch (error) {
      console.error(`[SKILL-DISCOVERY] Failed to get installed skill ${skillId}:`, error);
      return null;
    }
  }

  /**
   * Get MCP skill by ID (placeholder)
   */
  private async getMCPSkill(skillId: string): Promise<SkillManifest | null> {
    // TODO: Implement MCP skill fetching
    return null;
  }

  /**
   * Get n8n skill by ID from npm registry
   */
  private async getN8nSkill(skillId: string): Promise<SkillManifest | null> {
    try {
      const response = await fetch(`https://registry.npmjs.org/${skillId}`);
      if (!response.ok) return null;

      const pkg = await response.json();

      return {
        id: pkg.name,
        name: pkg.name.replace("n8n-nodes-", ""),
        description: pkg.description || "No description",
        source: "n8n",
        provider: pkg.author?.name || "unknown",
        category: "general",
        costPerUse: 0,
        trustLevel: "community_verified",
        codeUrl: pkg.dist?.tarball || "",
        version: pkg["dist-tags"]?.latest,
        author: pkg.author?.name,
        interface: {
          input: {},
          output: {},
        },
      };
    } catch (error) {
      console.error(`[SKILL-DISCOVERY] Failed to get n8n skill ${skillId}:`, error);
      return null;
    }
  }

  /**
   * Rank search results by relevance
   */
  private rankResults(skills: SkillManifest[], query: string): SkillManifest[] {
    const lowerQuery = query.toLowerCase();

    return skills.sort((a, b) => {
      // Score calculation
      const scoreA = this.calculateRelevanceScore(a, lowerQuery);
      const scoreB = this.calculateRelevanceScore(b, lowerQuery);

      // Sort descending by score
      return scoreB - scoreA;
    });
  }

  /**
   * Calculate relevance score for a skill
   */
  private calculateRelevanceScore(skill: SkillManifest, query: string): number {
    let score = 0;

    // Exact ID match = highest score
    if (skill.id.toLowerCase() === query) score += 100;

    // ID contains query
    if (skill.id.toLowerCase().includes(query)) score += 50;

    // Name exact match
    if (skill.name.toLowerCase() === query) score += 80;

    // Name contains query
    if (skill.name.toLowerCase().includes(query)) score += 40;

    // Description contains query
    if (skill.description.toLowerCase().includes(query)) score += 20;

    // Provider contains query
    if (skill.provider.toLowerCase().includes(query)) score += 10;

    // Trust level bonus
    if (skill.trustLevel === "verified") score += 30;
    if (skill.trustLevel === "community_verified") score += 15;

    // Source bonus (curated > mcp > n8n)
    if (skill.source === "curated") score += 20;
    if (skill.source === "mcp") score += 10;

    return score;
  }
}
