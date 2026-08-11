/**
 * Achievement routes — HTTP only.
 *
 * Catalog and unlock logic live in `services/achievementService.ts`.
 */

import { Router } from "express";
import { authenticate, type AuthRequest } from "../middlewares/authenticate.js";
import { listAchievements } from "../services/achievementService.js";

const router = Router();

// ─── GET /api/achievements ───────────────────────────────────────────────────

router.get("/achievements", authenticate, async (req: AuthRequest, res) => {
  const achievements = await listAchievements(req.userId!);
  res.json({ achievements });
});

export default router;
