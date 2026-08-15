/**
 * Grant a subscription tier to specific accounts, by email.
 *
 * For team, tester and comp accounts — the cases where someone should have
 * paid entitlements without a payment. There is no admin UI, and the API
 * deliberately refuses to let a client assert its own tier (see the header of
 * `api-server/src/services/entitlementService.ts`, which exists because an
 * earlier `POST /subscriptions/update` wrote `req.body.tier` straight to the
 * database and let any authenticated user grant themselves `elite` forever).
 * Changing entitlements is therefore an operator action, run against the
 * database with the credentials to match, and this is that action written down.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run grant-tier -- a@b.com c@d.com
 *   pnpm --filter @workspace/scripts run grant-tier -- a@b.com --tier=elite --apply
 *
 * Dry run by default: it prints what each account would change from and to,
 * and touches nothing until `--apply`.
 *
 * ── On `elite` ──────────────────────────────────────────────────────────────
 * `elite` is no longer sold — `available: false` in PLANS — but it is retained
 * in the enum and in TIER_LIMITS precisely so existing rows keep resolving, and
 * it is the only tier with every entitlement switched on: unlimited analyses,
 * AI chat, comparisons, priority processing. That makes it the right target for
 * "full access", and it carries no risk of colliding with a real purchase,
 * because nobody can buy it.
 *
 * ── On expiry ───────────────────────────────────────────────────────────────
 * `currentPeriodEnd` is set to NULL rather than a far-future date.
 * `resolveEffectiveTier` treats a null end date as "no expiry" and a past one
 * as free, so NULL is the honest encoding of a grant that does not renew and
 * does not lapse. A date years out would merely be a bug with a long fuse.
 */

import { eq, inArray } from "drizzle-orm";
import { db, usersTable, subscriptionsTable } from "@workspace/db";

const TIERS = ["free", "pro", "elite"] as const;
type Tier = (typeof TIERS)[number];

function parseArgs(argv: string[]): { emails: string[]; tier: Tier; apply: boolean } {
  const apply = argv.includes("--apply");
  const tierArg = argv.find((a) => a.startsWith("--tier="));
  const tier = (tierArg?.split("=")[1] ?? "elite") as Tier;

  if (!TIERS.includes(tier)) {
    throw new Error(`Unknown tier "${tier}". Expected one of: ${TIERS.join(", ")}`);
  }

  // Normalised the same way the API stores them, so a capitalised address
  // typed on the command line still matches the row it should.
  const emails = argv
    .filter((a) => !a.startsWith("--"))
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean);

  if (emails.length === 0) {
    throw new Error("No emails given. Pass at least one address.");
  }

  return { emails, tier, apply };
}

async function main(): Promise<void> {
  const { emails, tier, apply } = parseArgs(process.argv.slice(2));

  const users = await db
    .select({ id: usersTable.id, email: usersTable.email })
    .from(usersTable)
    .where(inArray(usersTable.email, emails));

  const found = new Map(users.map((u) => [u.email, u.id]));
  const missing = emails.filter((e) => !found.has(e));

  console.log(`Grant tier: ${tier}`);
  console.log("─".repeat(46));

  for (const email of emails) {
    const userId = found.get(email);
    if (!userId) {
      console.log(`  ${email}\n    NO ACCOUNT — sign up first, then re-run.`);
      continue;
    }

    const [existing] = await db
      .select({
        tier: subscriptionsTable.tier,
        status: subscriptionsTable.status,
        currentPeriodEnd: subscriptionsTable.currentPeriodEnd,
      })
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.userId, userId))
      .limit(1);

    const from = existing
      ? `${existing.tier} (${existing.status}${
          existing.currentPeriodEnd ? `, ends ${existing.currentPeriodEnd.toISOString().slice(0, 10)}` : ""
        })`
      : "no subscription row";

    console.log(`  ${email}\n    ${from}  ->  ${tier} (active, no expiry)`);

    if (!apply) continue;

    if (existing) {
      await db
        .update(subscriptionsTable)
        .set({ tier, status: "active", currentPeriodEnd: null, updatedAt: new Date() })
        .where(eq(subscriptionsTable.userId, userId));
    } else {
      // userId is unique on this table, so a missing row is the only case that
      // needs an insert; everything else is an update.
      await db.insert(subscriptionsTable).values({
        userId,
        tier,
        status: "active",
        currentPeriodStart: new Date(),
        currentPeriodEnd: null,
      });
    }
  }

  console.log("");
  if (!apply) {
    console.log("Dry run. Nothing was written. Re-run with --apply to commit.");
  } else {
    console.log(`Applied to ${emails.length - missing.length} account(s).`);
    console.log("The app reads the tier per request, so it takes effect on the next call —");
    console.log("no redeploy. Pull to refresh on the device if a screen looks stale.");
  }

  if (missing.length > 0) {
    console.log("");
    console.log(`Skipped ${missing.length} address(es) with no account: ${missing.join(", ")}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
