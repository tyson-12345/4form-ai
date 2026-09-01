/**
 * Password storage audit and migration.
 *
 * Scans the users table for password hashes that are not bcrypt-at-current-cost
 * and tags each row with the algorithm actually used. The login path
 * (`migratePasswordHash` in api-server/src/routes/auth.ts) reads that tag and
 * transparently re-hashes with bcrypt the next time the user signs in
 * successfully.
 *
 * Why tag rather than rehash here: a hash cannot be converted without the
 * plaintext, and we do not have it. Tagging is the only correct offline step —
 * the actual upgrade must happen at the one moment the plaintext is legitimately
 * in memory, which is login.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run migrate-passwords          # report only
 *   pnpm --filter @workspace/scripts run migrate-passwords -- --apply
 *
 * Federated-only accounts (Apple/Google) have a NULL `password_hash` and are
 * reported under `none`. They are never listed as weak and never tagged — see
 * `auditUsers` in ./password-audit.ts for why tagging one would be harmful.
 *
 * Passwords and hashes are never printed. Output is counts and user ids only.
 */

import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { auditUsers } from "./password-audit.js";

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");

  const users = await db
    .select({
      id: usersTable.id,
      passwordHash: usersTable.passwordHash,
      passwordAlgo: usersTable.passwordAlgo,
    })
    .from(usersTable);

  const { counts, needsAttention } = auditUsers(users);

  console.log("Password storage audit");
  console.log("──────────────────────");
  console.log(`Total users: ${users.length}`);
  for (const [algo, n] of Object.entries(counts).sort()) {
    const marker = algo === "bcrypt" || algo === "none" ? "ok  " : "WEAK";
    const note = algo === "none" ? "  federated-only (Apple/Google), no password stored" : "";
    console.log(`  [${marker}] ${algo.padEnd(10)} ${n}${note}`);
  }
  console.log("");

  if (needsAttention.length === 0) {
    console.log("No weak or outdated password hashes found. Nothing to do.");
    await shutdown();
    return;
  }

  console.log(`${needsAttention.length} user(s) need migration:`);
  for (const item of needsAttention.slice(0, 50)) {
    console.log(`  ${item.id}  ${item.reason}`);
  }
  if (needsAttention.length > 50) {
    console.log(`  … and ${needsAttention.length - 50} more`);
  }
  console.log("");

  if (!apply) {
    console.log("Dry run. Re-run with --apply to tag these rows so login-time");
    console.log("re-hashing picks them up.");
    await shutdown();
    return;
  }

  let tagged = 0;
  for (const item of needsAttention) {
    if (item.detected === "bcrypt") continue; // cost upgrade needs no tag change
    await db
      .update(usersTable)
      .set({ passwordAlgo: item.detected, updatedAt: new Date() })
      .where(eq(usersTable.id, item.id));
    tagged++;
  }

  console.log(`Tagged ${tagged} row(s) with their actual algorithm.`);
  console.log("These will upgrade to bcrypt automatically on next login.");
  console.log("");
  console.log("If any password was stored in plaintext, treat it as compromised:");
  console.log("force a reset for those users rather than waiting for them to sign in.");

  await shutdown();
}

async function shutdown(): Promise<void> {
  const { pool } = await import("@workspace/db");
  await pool.end();
}

main().catch((err) => {
  // Never let an error carrying a hash or connection string reach stdout raw.
  console.error("Migration failed:", err instanceof Error ? err.message : "unknown error");
  process.exit(1);
});
