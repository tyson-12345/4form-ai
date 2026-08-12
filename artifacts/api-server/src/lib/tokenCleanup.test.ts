/**
 * Reset-token pruning.
 *
 * The failure this guards against is not "the table grew" — it is deleting a
 * token that someone is about to use. That strands a user who is already locked
 * out of their account, which is the worst possible time to break their reset
 * link. So these tests care far more about what is *kept* than what is removed.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Database fake ───────────────────────────────────────────────────────────
//
// Captures the predicate the code builds and applies it to real rows, so the
// boundary conditions below are exercised against the actual logic rather than
// against a restatement of it.

interface TokenRow {
  id: string;
  expiresAt: Date;
  usedAt: Date | null;
}

const state = { rows: [] as TokenRow[], deleted: [] as TokenRow[] };

/**
 * Minimal predicate evaluator. Drizzle's operators are opaque objects, so the
 * mocks below build a plain tree the fake can walk.
 */
type Pred = (row: TokenRow) => boolean;

vi.mock("drizzle-orm", () => ({
  lt: (col: string, value: Date): Pred => (row) =>
    (row[col as keyof TokenRow] as Date | null) !== null &&
    (row[col as keyof TokenRow] as Date) < value,
  isNotNull: (col: string): Pred => (row) => row[col as keyof TokenRow] !== null,
  isNull: (col: string): Pred => (row) => row[col as keyof TokenRow] === null,
  gte: (col: string, value: Date): Pred => (row) =>
    (row[col as keyof TokenRow] as Date) >= value,
  and: (...preds: Pred[]): Pred => (row) => preds.every((p) => p(row)),
  or: (...preds: Pred[]): Pred => (row) => preds.some((p) => p(row)),
  sql: () => ({}),
}));

vi.mock("@workspace/db", () => ({
  db: {
    delete: () => ({
      where: (pred: Pred) => ({
        returning: () => {
          const removed = state.rows.filter(pred);
          state.deleted = removed;
          state.rows = state.rows.filter((r) => !pred(r));
          return Promise.resolve(removed.map((r) => ({ id: r.id })));
        },
      }),
    }),
  },
  passwordResetTokensTable: { id: "id", expiresAt: "expiresAt", usedAt: "usedAt" },
}));

const { pruneResetTokens } = await import("./tokenCleanup.js");

// ─── Fixtures ────────────────────────────────────────────────────────────────

const NOW = new Date("2026-08-12T12:00:00Z");
const HOUR = 60 * 60 * 1000;

function at(offsetMs: number): Date {
  return new Date(NOW.getTime() + offsetMs);
}

beforeEach(() => {
  state.rows = [];
  state.deleted = [];
});

function seed(rows: TokenRow[]): void {
  state.rows = rows;
}

const ids = () => state.rows.map((r) => r.id).sort();

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("pruneResetTokens — what must be kept", () => {
  it("keeps a live, unused token", async () => {
    seed([{ id: "live", expiresAt: at(29 * 60 * 1000), usedAt: null }]);
    await pruneResetTokens(NOW);
    expect(ids()).toEqual(["live"]);
  });

  it("keeps a token that expired only moments ago", async () => {
    // Inside the grace period. A user clicking a just-expired link should be
    // told it expired, not that it never existed.
    seed([{ id: "just-expired", expiresAt: at(-1 * HOUR), usedAt: null }]);
    await pruneResetTokens(NOW);
    expect(ids()).toEqual(["just-expired"]);
  });

  it("keeps a token used moments ago", async () => {
    // Double-click, or a mail client prefetching the link.
    seed([{ id: "just-used", expiresAt: at(20 * 60 * 1000), usedAt: at(-2 * HOUR) }]);
    await pruneResetTokens(NOW);
    expect(ids()).toEqual(["just-used"]);
  });

  it("keeps a token exactly at the grace boundary", async () => {
    // Strictly-less-than, so the boundary itself survives. Off-by-one here
    // deletes a link the user may still be holding.
    seed([{ id: "boundary", expiresAt: at(-24 * HOUR), usedAt: null }]);
    await pruneResetTokens(NOW);
    expect(ids()).toEqual(["boundary"]);
  });
});

describe("pruneResetTokens — what must be removed", () => {
  it("removes a long-expired unused token", async () => {
    seed([{ id: "stale", expiresAt: at(-48 * HOUR), usedAt: null }]);
    await pruneResetTokens(NOW);
    expect(ids()).toEqual([]);
  });

  it("removes a token used well past the grace period", async () => {
    seed([{ id: "spent", expiresAt: at(-72 * HOUR), usedAt: at(-72 * HOUR) }]);
    await pruneResetTokens(NOW);
    expect(ids()).toEqual([]);
  });

  it("removes a used token even when its expiry is still in the future", async () => {
    // Redeemed tokens are dead regardless of expiry — this is the case a naive
    // expiry-only predicate would leave behind forever.
    seed([{ id: "used-early", expiresAt: at(48 * HOUR), usedAt: at(-48 * HOUR) }]);
    await pruneResetTokens(NOW);
    expect(ids()).toEqual([]);
  });

  it("reports how many it removed", async () => {
    seed([
      { id: "a", expiresAt: at(-48 * HOUR), usedAt: null },
      { id: "b", expiresAt: at(-48 * HOUR), usedAt: null },
      { id: "keep", expiresAt: at(HOUR), usedAt: null },
    ]);
    expect(await pruneResetTokens(NOW)).toBe(2);
  });
});

describe("pruneResetTokens — mixed table", () => {
  it("removes only the dead rows and leaves every usable one", async () => {
    seed([
      { id: "live", expiresAt: at(25 * 60 * 1000), usedAt: null },
      { id: "just-expired", expiresAt: at(-1 * HOUR), usedAt: null },
      { id: "stale", expiresAt: at(-100 * HOUR), usedAt: null },
      { id: "spent", expiresAt: at(-100 * HOUR), usedAt: at(-100 * HOUR) },
      { id: "used-early", expiresAt: at(100 * HOUR), usedAt: at(-100 * HOUR) },
    ]);

    await pruneResetTokens(NOW);
    expect(ids()).toEqual(["just-expired", "live"]);
  });

  it("is a no-op on an empty table", async () => {
    seed([]);
    expect(await pruneResetTokens(NOW)).toBe(0);
  });
});
