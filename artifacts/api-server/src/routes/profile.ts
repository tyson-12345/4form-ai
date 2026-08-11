/**
 * Profile and account routes — HTTP only.
 *
 * Data access lives in `repositories/userRepository.ts`.
 */

import { Router } from "express";
import { z } from "zod";
import { authenticate, type AuthRequest } from "../middlewares/authenticate.js";
import { parseOrReject, safeText } from "../lib/validate.js";
import { verifyPassword, type PasswordAlgo } from "../lib/auth.js";
import { logger } from "../lib/logger.js";
import { clientIp } from "../lib/rateLimit.js";
import {
  findProfileByUserId,
  findSubscriptionByUserId,
  updateProfile,
  findUserById,
  deleteUser,
} from "../repositories/userRepository.js";

const router = Router();

const updateProfileSchema = z.object({
  name: safeText(1, 80).optional(),
  sport: safeText(0, 40).optional(),
  level: z.enum(["beginner", "intermediate", "advanced", "elite"]).optional(),
  goals: z.array(safeText(1, 120)).max(10).optional(),
  injuryConcerns: z.array(safeText(1, 120)).max(10).optional(),
  weeklyGoal: z.number().int().min(1).max(14).optional(),
});

// ─── GET /api/profile ────────────────────────────────────────────────────────

router.get("/profile", authenticate, async (req: AuthRequest, res) => {
  const profile = await findProfileByUserId(req.userId!);
  if (!profile) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }

  const subscription = await findSubscriptionByUserId(req.userId!);
  res.json({ profile, subscription });
});

// ─── PATCH /api/profile ──────────────────────────────────────────────────────

router.patch("/profile", authenticate, async (req: AuthRequest, res) => {
  const data = parseOrReject(updateProfileSchema, req.body, res, {
    route: "profile",
    ip: clientIp(req),
    userId: req.userId,
  });
  if (!data) return;

  const profile = await updateProfile(req.userId!, data);
  res.json({ profile });
});

// ─── DELETE /api/profile/account ─────────────────────────────────────────────

const deleteAccountSchema = z.object({
  /** Re-authentication. A stolen phone must not be able to erase the account. */
  password: z.string().min(1).max(200),
});

/**
 * Permanently delete the account and everything attached to it.
 *
 * Required by both the App Store and Play Store: an app that lets you create an
 * account in-app must let you delete it in-app.
 *
 * Deletion is immediate and total — see `deleteUser` for how the cascade
 * works. Videos live on the device and are removed by the client.
 */
router.delete("/profile/account", authenticate, async (req: AuthRequest, res) => {
  const data = parseOrReject(deleteAccountSchema, req.body, res, {
    route: "profile/account",
    ip: clientIp(req),
    userId: req.userId,
  });
  if (!data) return;

  const user = await findUserById(req.userId!);
  if (!user) {
    res.status(401).json({ error: "Authentication required. Please sign in." });
    return;
  }

  const valid = await verifyPassword(
    data.password,
    user.passwordHash,
    user.passwordAlgo as PasswordAlgo,
  );

  if (!valid) {
    logger.warn(
      { userId: req.userId, ip: clientIp(req), event: "account_delete_bad_password" },
      "Account deletion attempted with an incorrect password",
    );
    // Same wording as a failed sign-in — this is a credential check.
    res.status(401).json({ error: "Incorrect email or password" });
    return;
  }

  await deleteUser(req.userId!);

  logger.info(
    { userId: req.userId, event: "account_deleted" },
    "Account and all associated data deleted",
  );

  res.json({ deleted: true });
});

export default router;
