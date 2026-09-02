import {
  pgTable,
  text,
  integer,
  real,
  boolean,
  timestamp,
  date,
  jsonb,
  uuid,
  pgEnum,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { relations } from "drizzle-orm";

// ─── Enums ─────────────────────────────────────────────────────────────────

export const subscriptionTierEnum = pgEnum("subscription_tier", [
  "free",
  "pro",
  "elite",
]);

export const athleteLevelEnum = pgEnum("athlete_level", [
  "beginner",
  "intermediate",
  "advanced",
  "elite",
]);

export const analysisStatusEnum = pgEnum("analysis_status", [
  "pending",
  "processing",
  "complete",
  "failed",
]);

export const tipCategoryEnum = pgEnum("tip_category", [
  "technique",
  "injury-risk",
  "mobility",
  "strength",
  "conditioning",
]);

export const tipSeverityEnum = pgEnum("tip_severity", [
  "info",
  "warning",
  "critical",
]);

export const chatRoleEnum = pgEnum("chat_role", ["user", "assistant"]);

// ─── Users ─────────────────────────────────────────────────────────────────

export const usersTable = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  /**
   * NULL for an account that only ever signs in through a federated provider
   * (see `identitiesTable`). Such an account has no password at all.
   *
   * The login route needs no branch for this. It already substitutes a real
   * dummy bcrypt hash whenever the stored hash is absent, so a password attempt
   * against a social-only account burns the same ~250ms and returns the same
   * INVALID_CREDENTIALS string as a wrong password on a password account —
   * which is what stops "does this address use Google?" from being answerable.
   */
  passwordHash: text("password_hash"),
  /**
   * Which algorithm produced `passwordHash`. Anything other than "bcrypt" is a
   * legacy hash that must be re-hashed the next time the user authenticates
   * successfully. See `migratePasswordHash` in routes/auth.ts.
   */
  passwordAlgo: text("password_algo").notNull().default("bcrypt"),
  /** Consecutive failed logins. Reset to 0 on any successful login. */
  failedLoginAttempts: integer("failed_login_attempts").notNull().default(0),
  /** When set and in the future, authentication is refused regardless of password. */
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  lastFailedLoginAt: timestamp("last_failed_login_at", { withTimezone: true }),
  /**
   * Session cutoff. Any JWT issued at or before this instant is refused, even
   * though its signature is valid and it has not expired.
   *
   * JWTs are stateless: once signed, nothing can call one back. Tokens here live
   * for 7 days, so without this column a password reset does not evict an
   * attacker who already holds a token — the user does the one thing they are
   * told to do when they suspect compromise, and the session survives it for up
   * to a week. Set on password reset (see routes/auth.ts) and checked on every
   * authenticated request (see middlewares/authenticate.ts).
   */
  sessionsValidAfter: timestamp("sessions_valid_after", { withTimezone: true }),
  /**
   * Date of birth, for the under-13 age gate (COPPA, GDPR Art. 8).
   *
   * A `date`, not a timestamp — the time of day is not information we need, and
   * collecting less of a minor's data is the point of the control. NULL means
   * the account predates migration 0004; new signups cannot be NULL.
   */
  birthDate: date("birth_date"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;

// ─── Password Reset Tokens ──────────────────────────────────────────────────

/**
 * Single-use password reset tokens.
 *
 * Only the SHA-256 hash of the token is stored — a database leak therefore does
 * not let an attacker reset accounts, because the raw token (emailed to the
 * user) cannot be recovered from the hash.
 */
export const passwordResetTokensTable = pgTable("password_reset_tokens", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  /** SHA-256 of the raw token. Never store the raw value. */
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  /** Set when redeemed; a token with this set is refused. */
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type PasswordResetToken = typeof passwordResetTokensTable.$inferSelect;

// ─── Federated identities ───────────────────────────────────────────────────

/**
 * A link between one of our users and one account at an external identity
 * provider (Apple, Google).
 *
 * ── Why this is keyed on `subject`, not email ───────────────────────────────
 * Apple returns the user's email address only on the *first* authorization for
 * an app, and omits it from every token afterwards. An email-keyed table would
 * therefore fail to recognise a returning user and try to create a duplicate
 * account on their second sign-in. `subject` — the `sub` claim — is stable for
 * the lifetime of the relationship and is the only key that survives.
 *
 * `providerEmail` is descriptive: kept so support can see what the provider
 * asserted, and so drift is visible. It is deliberately not unique and must
 * never be looked up. Apple Private Relay hands out a per-app forwarding
 * address, and a user can switch relay off later — same person, same `subject`,
 * different email.
 */
export const identitiesTable = pgTable(
  "identities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    /** "apple" | "google". Text rather than an enum so adding a provider is a code change, not a migration. */
    provider: text("provider").notNull(),
    /** The provider's `sub` claim. Opaque, stable, and scoped to our team. */
    subject: text("subject").notNull(),
    providerEmail: text("provider_email"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (t) => [
    // One provider account maps to exactly one user. Without this two users
    // could both claim the same Apple ID and sign-in would resolve by row
    // order — silently, and differently on each query plan.
    uniqueIndex("identities_provider_subject_key").on(t.provider, t.subject),
    // One identity per provider per user, so revoking "their Google login"
    // is unambiguous.
    uniqueIndex("identities_user_provider_key").on(t.userId, t.provider),
    index("identities_user_id_idx").on(t.userId),
  ],
);

export type Identity = typeof identitiesTable.$inferSelect;

/**
 * Providers this server accepts tokens from.
 *
 * A type, not a runtime list: the list of *configured* providers belongs with
 * the code that knows their issuers, key endpoints and audiences
 * (api-server/src/lib/oauthProviders.ts), and a second copy here would be a
 * copy that can silently disagree.
 */
export type IdentityProvider = "apple" | "google";

// ─── Waitlist ───────────────────────────────────────────────────────────────

/**
 * Addresses collected by the landing page, ahead of the TestFlight build.
 *
 * Not a user, and deliberately not related to one. Someone on the waitlist has
 * no account, and joining must never create one — so there is no `userId` and
 * no foreign key. The table's whole job is a single announcement, after which
 * it can be dropped.
 *
 * `email` is the natural key and carries the unique index; the value written is
 * always `normalizeEmail()`'s output, exactly as `users.email` is, so a second
 * submission of the same address in a different case is a no-op rather than a
 * duplicate send.
 *
 * The ownership rule that governs every other table here — every read and write
 * of a user-owned row takes a `userId` and puts it in the WHERE clause, see
 * `api-server/src/repositories/analysisRepository.ts` — does not apply, because
 * these rows are not user-owned. That is an exemption, not an oversight.
 */
export const waitlistSignupsTable = pgTable(
  "waitlist_signups",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("waitlist_signups_email_key").on(t.email),
    index("waitlist_signups_created_at_idx").on(t.createdAt),
  ],
);

export type WaitlistSignup = typeof waitlistSignupsTable.$inferSelect;

// ─── Athlete Profiles ───────────────────────────────────────────────────────

export const athleteProfilesTable = pgTable("athlete_profiles", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" })
    .unique(),
  name: text("name").notNull(),
  sport: text("sport").notNull().default(""),
  level: athleteLevelEnum("level").notNull().default("beginner"),
  goals: jsonb("goals").$type<string[]>().notNull().default([]),
  injuryConcerns: jsonb("injury_concerns").$type<string[]>().notNull().default([]),
  weeklyGoal: integer("weekly_goal").notNull().default(3),
  weeklyProgress: integer("weekly_progress").notNull().default(0),
  streakDays: integer("streak_days").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertAthleteProfileSchema = createInsertSchema(athleteProfilesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAthleteProfile = z.infer<typeof insertAthleteProfileSchema>;
export type AthleteProfile = typeof athleteProfilesTable.$inferSelect;

// ─── Subscriptions ──────────────────────────────────────────────────────────

export const subscriptionsTable = pgTable("subscriptions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" })
    .unique(),
  tier: subscriptionTierEnum("tier").notNull().default("free"),
  status: text("status").notNull().default("active"),
  revenueCatCustomerId: text("revenue_cat_customer_id"),
  currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertSubscriptionSchema = createInsertSchema(subscriptionsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;
export type Subscription = typeof subscriptionsTable.$inferSelect;

// ─── Analyses ───────────────────────────────────────────────────────────────

export const analysesTable = pgTable("analyses", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  sport: text("sport").notNull(),
  status: analysisStatusEnum("status").notNull().default("pending"),
  videoUrl: text("video_url"),
  thumbnailUrl: text("thumbnail_url"),
  duration: real("duration"),
  overallScore: real("overall_score"),
  techniqueScore: real("technique_score"),
  powerScore: real("power_score"),
  balanceScore: real("balance_score"),
  consistencyScore: real("consistency_score"),
  mobilityScore: real("mobility_score"),
  speedScore: real("speed_score"),
  strengths: jsonb("strengths").$type<string[]>().notNull().default([]),
  improvements: jsonb("improvements").$type<string[]>().notNull().default([]),
  /** Plain-language readout generated from the measurements. */
  summary: text("summary"),
  /**
   * The raw pose measurements this analysis was computed from.
   *
   * Stored so a score is always reproducible and auditable: re-running
   * `computeScores` on this blob must reproduce the stored scores exactly.
   */
  poseMetrics: jsonb("pose_metrics"),
  /**
   * How the scores were produced. "pose-measured" is the only value that
   * represents real measurement; "unscored" means the clip could not be
   * tracked well enough to score.
   */
  analysisMethod: text("analysis_method").notNull().default("pose-measured"),
  /**
   * Set only when the measured movement contradicts the sport chosen for this
   * clip. Sport is picked per clip and cross-training is supported, so this is
   * a note to the athlete, never a correction to the data.
   *
   * NULL means "not assessed": every analysis from before this column existed,
   * and any clip tracked too poorly to judge. That is deliberately distinct
   * from a verdict that the sport matches.
   */
  sportMismatch: jsonb("sport_mismatch").$type<{
    suggestedSport: string;
    confidence: "medium" | "high";
    message: string;
  }>(),
  comparedToAthlete: text("compared_to_athlete"),
  similarityScore: real("similarity_score"),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  /**
   * Soft-delete marker. A deleted analysis disappears from every read path but
   * the row survives (scrubbed of content) until the monthly quota window it
   * was created in has closed — hard deletion would refund the quota slot, and
   * create-measure-delete-repeat would make the free tier unlimited. Rows are
   * hard-pruned by the cleanup sweep once they can no longer affect a count.
   * Account deletion still cascades immediately and removes everything.
   */
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (t) => [
  // The list screen: every analysis for one user, newest first. The composite
  // serves both the filter and the sort, so this is an index-only ordering
  // rather than a sort of the whole user partition.
  index("analyses_user_uploaded_idx").on(t.userId, t.uploadedAt),
  // The monthly quota count, which runs on every upload attempt.
  index("analyses_user_status_idx").on(t.userId, t.status),
]);

export const insertAnalysisSchema = createInsertSchema(analysesTable).omit({
  id: true,
  createdAt: true,
  uploadedAt: true,
});
export type InsertAnalysis = z.infer<typeof insertAnalysisSchema>;
export type Analysis = typeof analysesTable.$inferSelect;

// ─── Coaching Tips ──────────────────────────────────────────────────────────

export const coachingTipsTable = pgTable("coaching_tips", {
  id: uuid("id").defaultRandom().primaryKey(),
  analysisId: uuid("analysis_id")
    .notNull()
    .references(() => analysesTable.id, { onDelete: "cascade" }),
  category: tipCategoryEnum("category").notNull(),
  severity: tipSeverityEnum("severity").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  drill: text("drill"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("coaching_tips_analysis_idx").on(t.analysisId),
]);

export const insertCoachingTipSchema = createInsertSchema(coachingTipsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertCoachingTip = z.infer<typeof insertCoachingTipSchema>;
export type CoachingTip = typeof coachingTipsTable.$inferSelect;

// ─── Injury Risks ───────────────────────────────────────────────────────────

export const injuryRisksTable = pgTable("injury_risks", {
  id: uuid("id").defaultRandom().primaryKey(),
  analysisId: uuid("analysis_id")
    .notNull()
    .references(() => analysesTable.id, { onDelete: "cascade" }),
  joint: text("joint").notNull(),
  /**
   * Share of tracked frames the joint spent in the risk band.
   *
   * This is a measurement of time-in-position, NOT a predicted probability of
   * injury. UI copy must not present it as the latter.
   */
  riskPercent: real("risk_percent").notNull(),
  /** Share of tracked frames in the (milder) caution band. */
  cautionPercent: real("caution_percent"),
  /** Angle extremes actually observed for this joint, in degrees. */
  observedMin: real("observed_min"),
  observedMax: real("observed_max"),
  description: text("description").notNull(),
  prevention: text("prevention").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertInjuryRiskSchema = createInsertSchema(injuryRisksTable).omit({
  id: true,
  createdAt: true,
});
export type InsertInjuryRisk = z.infer<typeof insertInjuryRiskSchema>;
export type InjuryRisk = typeof injuryRisksTable.$inferSelect;

// ─── Progress Entries ───────────────────────────────────────────────────────

export const progressEntriesTable = pgTable("progress_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  /**
   * The analysis this entry's scores came from. Deliberately a bare uuid, not
   * a foreign key: the source row is scrubbed on user deletion and hard-pruned
   * a month later, and this entry's fate must follow the *user's* delete (the
   * entry goes when they delete the session), not the janitor's. Null on rows
   * created before provenance existed — those pre-date per-session deletion.
   */
  analysisId: uuid("analysis_id"),
  date: text("date").notNull(),
  overallScore: real("overall_score").notNull(),
  techniqueScore: real("technique_score"),
  powerScore: real("power_score"),
  balanceScore: real("balance_score"),
  consistencyScore: real("consistency_score"),
  mobilityScore: real("mobility_score"),
  speedScore: real("speed_score"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("progress_entries_user_date_idx").on(t.userId, t.date),
]);

export const insertProgressEntrySchema = createInsertSchema(progressEntriesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertProgressEntry = z.infer<typeof insertProgressEntrySchema>;
export type ProgressEntry = typeof progressEntriesTable.$inferSelect;

// ─── Achievements (catalog) ─────────────────────────────────────────────────

export const achievementsTable = pgTable("achievements", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  icon: text("icon").notNull(),
  requiredCount: integer("required_count").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Achievement = typeof achievementsTable.$inferSelect;

// ─── User Achievements ──────────────────────────────────────────────────────

export const userAchievementsTable = pgTable("user_achievements", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  achievementId: text("achievement_id")
    .notNull()
    .references(() => achievementsTable.id, { onDelete: "cascade" }),
  progress: integer("progress").notNull().default(0),
  total: integer("total").notNull().default(1),
  unlockedAt: timestamp("unlocked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type UserAchievement = typeof userAchievementsTable.$inferSelect;

// ─── Chat Messages ──────────────────────────────────────────────────────────

export const chatMessagesTable = pgTable("chat_messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  role: chatRoleEnum("role").notNull(),
  content: text("content").notNull(),
  referencedAnalysisId: uuid("referenced_analysis_id").references(
    () => analysesTable.id,
    { onDelete: "set null" }
  ),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  // Every chat read is "newest N for this user" — see chatRepository.
  index("chat_messages_user_created_idx").on(t.userId, t.createdAt),
]);

export const insertChatMessageSchema = createInsertSchema(chatMessagesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;
export type ChatMessage = typeof chatMessagesTable.$inferSelect;

// ─── Relations ──────────────────────────────────────────────────────────────

export const usersRelations = relations(usersTable, ({ one, many }) => ({
  profile: one(athleteProfilesTable, {
    fields: [usersTable.id],
    references: [athleteProfilesTable.userId],
  }),
  subscription: one(subscriptionsTable, {
    fields: [usersTable.id],
    references: [subscriptionsTable.userId],
  }),
  analyses: many(analysesTable),
  progressEntries: many(progressEntriesTable),
  chatMessages: many(chatMessagesTable),
  userAchievements: many(userAchievementsTable),
}));

export const analysesRelations = relations(analysesTable, ({ one, many }) => ({
  user: one(usersTable, {
    fields: [analysesTable.userId],
    references: [usersTable.id],
  }),
  tips: many(coachingTipsTable),
  injuryRisks: many(injuryRisksTable),
}));

export const coachingTipsRelations = relations(coachingTipsTable, ({ one }) => ({
  analysis: one(analysesTable, {
    fields: [coachingTipsTable.analysisId],
    references: [analysesTable.id],
  }),
}));

export const injuryRisksRelations = relations(injuryRisksTable, ({ one }) => ({
  analysis: one(analysesTable, {
    fields: [injuryRisksTable.analysisId],
    references: [analysesTable.id],
  }),
}));

export const progressEntriesRelations = relations(progressEntriesTable, ({ one }) => ({
  user: one(usersTable, {
    fields: [progressEntriesTable.userId],
    references: [usersTable.id],
  }),
}));

export const chatMessagesRelations = relations(chatMessagesTable, ({ one }) => ({
  user: one(usersTable, {
    fields: [chatMessagesTable.userId],
    references: [usersTable.id],
  }),
  referencedAnalysis: one(analysesTable, {
    fields: [chatMessagesTable.referencedAnalysisId],
    references: [analysesTable.id],
  }),
}));

export const userAchievementsRelations = relations(userAchievementsTable, ({ one }) => ({
  user: one(usersTable, {
    fields: [userAchievementsTable.userId],
    references: [usersTable.id],
  }),
  achievement: one(achievementsTable, {
    fields: [userAchievementsTable.achievementId],
    references: [achievementsTable.id],
  }),
}));
