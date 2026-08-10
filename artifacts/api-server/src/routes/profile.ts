import { Router } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { athleteProfilesTable, subscriptionsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { authenticate, type AuthRequest } from "../middlewares/authenticate.js";
import { parseOrReject, safeText } from "../lib/validate.js";
import { verifyPassword, type PasswordAlgo } from "../lib/auth.js";
import { logger } from "../lib/logger.js";
import { clientIp } from "../lib/rateLimit.js";

const router = Router();

const updateProfileSchema = z.object({
  name: safeText(1, 80).optional(),
  sport: safeText(0, 40).optional(),
  level: z.enum(["beginner", "intermediate", "advanced", "elite"]).optional(),
  goals: z.array(safeText(1, 120)).max(10).optional(),
  injuryConcerns: z.array(safeText(1, 120)).max(10).optional(),
  weeklyGoal: z.number().int().min(1).max(14).optional(),
});

// GET /api/profile
router.get("/profile", authenticate, async (req: AuthRequest, res) => {
  const [profile] = await db
    .select()
    .from(athleteProfilesTable)
    .where(eq(athleteProfilesTable.userId, req.userId!))
    .limit(1);

  if (!profile) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }

  const [subscription] = await db
    .select()
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.userId, req.userId!))
    .limit(1);

  res.json({ profile, subscription });
});

// PATCH /api/profile
router.patch("/profile", authenticate, async (req: AuthRequest, res) => {
  const data = parseOrReject(updateProfileSchema, req.body, res, {
    route: "profile",
    ip: clientIp(req),
    userId: req.userId,
  });
  if (!data) return;

  const [updated] = await db
    .update(athleteProfilesTable)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(athleteProfilesTable.userId, req.userId!))
    .returning();

  res.json({ profile: updated });
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
 * Deletion is immediate and total. Every child table declares
 * `onDelete: "cascade"` against `users.id`, so removing the user row also
 * removes profile, subscription, analyses, coaching tips, injury risks,
 * progress entries, chat messages, achievements, and reset tokens. Videos live
 * on the device and are removed by the client.
 */
router.delete("/profile/account", authenticate, async (req: AuthRequest, res) => {
  const data = parseOrReject(deleteAccountSchema, req.body, res, {
    route: "profile/account",
    ip: clientIp(req),
    userId: req.userId,
  });
  if (!data) return;

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, req.userId!))
    .limit(1);

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

  await db.delete(usersTable).where(eq(usersTable.id, req.userId!));

  logger.info(
    { userId: req.userId, event: "account_deleted" },
    "Account and all associated data deleted",
  );

  res.json({ deleted: true });
});

export default router;
