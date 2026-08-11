/**
 * Progress routes — HTTP only.
 */

import { Router } from "express";
import { authenticate, type AuthRequest } from "../middlewares/authenticate.js";
import { findProgressEntries } from "../repositories/analysisRepository.js";

const router = Router();

// ─── GET /api/progress ───────────────────────────────────────────────────────

router.get("/progress", authenticate, async (req: AuthRequest, res) => {
  // Fetched newest-first for the LIMIT, returned oldest-first for charting.
  const entries = await findProgressEntries(req.userId!, 90);
  res.json({ entries: entries.reverse() });
});

export default router;
