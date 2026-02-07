/**
 * Skill System API Routes
 */

import express, { Router, Request, Response, NextFunction } from "express";
import { SkillDiscovery, SkillInstaller, DynamicSkillExecutor } from "../skills/index.js";
import crypto from "crypto";

const router: Router = express.Router();

const WEBHOOK_SECRET = process.env.AGENT_WEBHOOK_SECRET;

function verifyWebhookSecret(provided: string | null | undefined): boolean {
  if (!provided || !WEBHOOK_SECRET) return false;
  if (provided.length !== WEBHOOK_SECRET.length) return false;
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(WEBHOOK_SECRET));
}

function requireWebhookAuth(req: Request, res: Response, next: NextFunction): void {
  const secret = req.headers["x-webhook-secret"];
  if (!verifyWebhookSecret(secret as string)) {
    res.status(401).json({ error: "unauthorized", message: "Invalid webhook secret" });
    return;
  }
  next();
}

const discovery = new SkillDiscovery();
const installer = new SkillInstaller();
const executor = new DynamicSkillExecutor();

/**
 * Search for skills
 * GET /skills/search?q=google%20sheets&limit=10&category=productivity
 */
router.get("/search", async (req, res) => {
  try {
    const { q, limit, category, sources } = req.query;

    const result = await discovery.searchSkills(String(q || ""), {
      limit: limit ? parseInt(String(limit)) : 10,
      category: category ? String(category) : undefined,
      sources: sources ? (String(sources).split(",") as ("curated" | "mcp" | "n8n")[]) : undefined,
    });

    res.json(result);
  } catch (error) {
    console.error("[SKILLS-API] Search failed:", error);
    res.status(500).json({
      error: "Search failed",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * Get skill by ID
 * GET /skills/:skillId
 */
router.get("/:skillId", async (req, res) => {
  try {
    const { skillId } = req.params;

    const skill = await discovery.getSkill(skillId);

    if (!skill) {
      return res.status(404).json({ error: "Skill not found" });
    }

    res.json(skill);
  } catch (error) {
    console.error("[SKILLS-API] Get skill failed:", error);
    res.status(500).json({
      error: "Get skill failed",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * Install skill
 * POST /skills/install
 * Body: { skillId: string, userId: string, skipAudit?: boolean }
 */
router.post("/install", requireWebhookAuth, async (req, res) => {
  try {
    const { skillId, userId, skipAudit } = req.body;

    if (!skillId || !userId) {
      return res.status(400).json({ error: "skillId and userId are required" });
    }

    const result = await installer.installSkill(skillId, userId, {
      skipAudit: skipAudit === true,
    });

    res.json(result);
  } catch (error) {
    console.error("[SKILLS-API] Install failed:", error);
    res.status(500).json({
      error: "Install failed",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * Uninstall skill
 * DELETE /skills/:skillId
 * Body: { userId: string }
 */
router.delete("/:skillId", requireWebhookAuth, async (req, res) => {
  try {
    const { skillId } = req.params;
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }

    const success = await installer.uninstallSkill(userId, skillId);

    if (success) {
      res.json({ success: true, message: "Skill uninstalled" });
    } else {
      res.status(500).json({ error: "Uninstall failed" });
    }
  } catch (error) {
    console.error("[SKILLS-API] Uninstall failed:", error);
    res.status(500).json({
      error: "Uninstall failed",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * List installed skills for user
 * GET /skills/installed/:userId
 */
router.get("/installed/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const skills = await installer.listInstalledSkills(userId);

    res.json({ skills, count: skills.length });
  } catch (error) {
    console.error("[SKILLS-API] List failed:", error);
    res.status(500).json({
      error: "List failed",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * Execute skill
 * POST /skills/execute
 * Body: { userId: string, skillId: string, params: {}, accessToken?: string }
 */
router.post("/execute", requireWebhookAuth, async (req, res) => {
  try {
    const { userId, skillId, params, accessToken } = req.body;

    if (!userId || !skillId || !params) {
      return res.status(400).json({ error: "userId, skillId, and params are required" });
    }

    const result = await executor.executeSkill(userId, skillId, params, {
      accessToken,
      autoInstall: true,
    });

    res.json(result);
  } catch (error) {
    console.error("[SKILLS-API] Execute failed:", error);
    res.status(500).json({
      error: "Execute failed",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * Get available skills (installed + registry)
 * GET /skills/available/:userId
 */
router.get("/available/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const { category } = req.query;

    const result = await executor.getAvailableSkills(userId, {
      category: category ? String(category) : undefined,
    });

    res.json(result);
  } catch (error) {
    console.error("[SKILLS-API] Available skills failed:", error);
    res.status(500).json({
      error: "Failed to get available skills",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

export default router;
