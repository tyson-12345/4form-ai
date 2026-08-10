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
 * Passwords and hashes are never printed. Output is counts and user ids only.
 */

import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

type PasswordAlgo = "bcrypt" | "md5" | "sha1" | "sha256" | "plaintext";

const BCRYPT_ROUNDS = 12;

/** Identify the storage format of a hash by shape. */
function detectAlgo(hash: string): PasswordAlgo {
  if (/^\$2[aby]\$\d{2}\$/.test(hash)) return "bcrypt";
  if (/^[a-f0-9]{32}$/i.test(hash)) return "md5";
  if (/^[a-f0-9]{40}$/i.test(hash)) return "sha1";
  if (/^[a-f0-9]{64}$/i.test(hash)) return "sha256";
  return "plaintext";
}

function bcryptCost(hash: string): number | null {
  const m = /^\$2[aby]\$(\d{2})\$/.exec(hash);
  return m ? Number(m[1]) : null;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");

  const users = await db
    .select({
      id: usersTable.id,
      passwordHash: usersTable.passwordHash,
      passwordAlgo: usersTable.passwordAlgo,
    })
    .from(usersTable);

  const counts: Record<string, number> = {};
  const needsAttention: { id: string; detected: PasswordAlgo; reason: string }[] = [];

  for (const user of users) {
    const detected = detectAlgo(user.passwordHash);
    counts[detected] = (counts[detected] ?? 0) + 1;

    if (detected !== "bcrypt") {
      needsAttention.push({
        id: user.id,
        detected,
        reason: `stored as ${detected} — will be re-hashed on next successful login`,
      });
      continue;
    }

    const cost = bcryptCost(user.passwordHash);
    if (cost !== null && cost < BCRYPT_ROUNDS) {
      needsAttention.push({
        id: user.id,
        detected,
        reason: `bcrypt cost ${cost} is below the current ${BCRYPT_ROUNDS} — will be re-hashed on next successful login`,
      });
    }
  }

  console.log("Password storage audit");
  console.log("──────────────────────");
  console.log(`Total users: ${users.length}`);
  for (const [algo, n] of Object.entries(counts).sort()) {
    const marker = algo === "bcrypt" ? "ok  " : "WEAK";
    console.log(`  [${marker}] ${algo.padEnd(10)} ${n}`);
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
