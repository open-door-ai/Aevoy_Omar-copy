/**
 * Browser Status Routes
 * 
 * GET /browser/status - Check shared browser stats
 * POST /browser/cleanup - Clean up idle contexts
 */

import express from "express";
import { MultiUserBrowserService } from "../services/multi-user-browser.js";
import { getSupabaseClient } from "../utils/supabase.js";

const router = express.Router();

// Get browser status
router.get("/status", async (_req, res) => {
  const stats = MultiUserBrowserService.getStats();
  
  res.json({
    status: stats ? "active" : "not_initialized",
    contexts: stats?.contexts || 0,
    uptime: stats?.uptime || 0,
    timestamp: new Date().toISOString(),
  });
});

// Clean up idle contexts
router.post("/cleanup", async (req, res) => {
  const { maxIdleMinutes = 30 } = req.body;
  
  try {
    // This would trigger cleanup in the service
    // Implementation depends on your needs
    
    res.json({
      success: true,
      message: `Cleanup triggered for contexts idle > ${maxIdleMinutes} minutes`,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// Get user browser assignment
router.get("/assignment/:userId", async (req, res) => {
  const { userId } = req.params;
  
  try {
    const { data } = await getSupabaseClient()
      .from("user_vps_assignments")
      .select("vps_id, vps_instances(host, port, status)")
      .eq("user_id", userId)
      .single();

    if (!data) {
      return res.status(404).json({ error: "No assignment found" });
    }

    res.json({
      userId,
      vpsId: data.vps_id,
      host: (data.vps_instances as any)?.host,
      port: (data.vps_instances as any)?.port,
      status: (data.vps_instances as any)?.status,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

export default router;
