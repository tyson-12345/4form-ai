/**
 * The monthly analysis quota: how a slot is spent, and what must never spend one.
 *
 * Two defects lived here, and both were arithmetic the database was never asked
 * to settle:
 *
 *  - The count and the insert ran as two unsynchronised statements, so
 *    concurrent uploads from one free account all read the same `used` and all
 *    passed. Twenty simultaneous requests turned a three-a-month plan into
 *    twenty, and every admitted one bought a Claude call. The IP limiter in
 *    front of the route bounds a network origin and has never bounded an
 *    account.
 *  - A clip whose coaching write-up failed was still counted, so a free user
 *    could spend their last slot on measurements and an apology — with no
 *    retry, no queue and no regenerate control anywhere in the codebase that
 *    would ever produce the missing half.
 *
 * ── About the fake ──────────────────────────────────────────────────────────
 * The database is replaced with an in-memory fake, as in `login-lockout.test.ts`.
 * It is not a Postgres emulator and it cannot prove what `FOR UPDATE` does. What
 * it does model is the one property the lock buys: a `.for("update")` on a
 * `users` row is held until that transaction ends, and a second transaction
 * asking for the same row waits. Given that, the concurrency test below is a
 * real test of *this* code — it passes only if the count runs inside the locked
 * section and the insert lands before it is released. The previous shape (count
 * first, then insert) fails it.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ─── Table stand-ins ─────────────────────────────────────────────────────────

/**
 * Hoisted because `vi.mock` factories run before the module body. Each table is
 * a proxy whose property access yields `{ table, column }`, which is all the
 * predicate interpreter below needs to know about a column.
 */
const fixtures = vi.hoisted(() => {
  function table(name: string) {
    return new Proxy(
      {},
      {
        get: (_t, prop) => {
          if (typeof prop === "symbol") return undefined;
          if (prop === "__table") return name;
          return { table: name, column: prop };
        },
      },
    ) as Record<string, never> & { __table: string };
  }

  return {
    users: table("users"),
    analyses: table("analyses"),
    coachingTips: table("coaching_tips"),
    injuryRisks: table("injury_risks"),
    progressEntries: table("progress_entries"),
    subscriptions: table("subscriptions"),
    athleteProfiles: table("athlete_profiles"),
  };
});

// ─── Operators, reduced to inspectable objects ───────────────────────────────

interface ColumnRef {
  table: string;
  column: string;
}
type Predicate =
  | { kind: "and"; parts: Predicate[] }
  | { kind: "eq" | "ne" | "gte" | "lt"; col: ColumnRef; value: unknown }
  | { kind: "isNull" | "isNotNull"; col: ColumnRef }
  | undefined;

vi.mock("drizzle-orm", () => {
  const binary = (kind: string) => (col: unknown, value: unknown) => ({ kind, col, value });
  return {
    eq: binary("eq"),
    ne: binary("ne"),
    gte: binary("gte"),
    lt: binary("lt"),
    and: (...parts: unknown[]) => ({ kind: "and", parts: parts.filter(Boolean) }),
    desc: (col: unknown) => col,
    isNull: (col: unknown) => ({ kind: "isNull", col }),
    isNotNull: (col: unknown) => ({ kind: "isNotNull", col }),
    count: () => ({ kind: "count" }),
  };
});

// ─── In-memory database ──────────────────────────────────────────────────────

interface Row {
  [column: string]: unknown;
}

const state = {
  analyses: [] as Row[],
  subscriptions: [] as Row[],
  /** Ordered log of what the repositories asked the database to do. */
  journal: [] as string[],
  /** Every `.set()` payload, oldest first. */
  updates: [] as Row[],
};

/** Row locks currently held or queued, keyed `table:id`. */
const lockQueue = new Map<string, Promise<void>>();

function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}

function atLeast(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() >= b.getTime();
  return (a as number) >= (b as number);
}

function matches(row: Row, predicate: Predicate): boolean {
  if (!predicate) return true;
  switch (predicate.kind) {
    case "and":
      return predicate.parts.every((p) => matches(row, p));
    case "eq":
      return sameValue(row[predicate.col.column], predicate.value);
    case "ne":
      return !sameValue(row[predicate.col.column], predicate.value);
    case "gte":
      return atLeast(row[predicate.col.column], predicate.value);
    case "lt":
      return !atLeast(row[predicate.col.column], predicate.value);
    case "isNull":
      return row[predicate.col.column] == null;
    case "isNotNull":
      return row[predicate.col.column] != null;
  }
}

/** What a transaction is holding, so the locks can be released when it ends. */
interface TxContext {
  releases: (() => void)[];
}

function tableRows(name: string): Row[] | null {
  if (name === "analyses") return state.analyses;
  if (name === "subscriptions") return state.subscriptions;
  return null;
}

function handle(tx: TxContext | null) {
  const scope = tx ? "tx" : "db";

  function select(projection?: Record<string, unknown>) {
    let table = "";
    let where: Predicate;
    let lock = "";

    const run = async (): Promise<Row[]> => {
      if (lock) {
        state.journal.push(`${scope}:lock ${table} ${lock}`);
        // The property the row lock actually buys, and the only one modelled:
        // one holder at a time, until the transaction that took it ends.
        const id = where && "value" in where ? String(where.value) : "*";
        const key = `${table}:${id}`;
        const ahead = lockQueue.get(key) ?? Promise.resolve();
        let release!: () => void;
        const held = new Promise<void>((resolve) => (release = resolve));
        lockQueue.set(
          key,
          ahead.then(() => held),
        );
        await ahead;
        tx?.releases.push(release);
        return [{ id }];
      }

      const counting = Boolean(projection && "total" in projection);
      state.journal.push(`${scope}:select ${table}${counting ? " count" : ""}`);

      const rows = (tableRows(table) ?? []).filter((r) => matches(r, where));
      return counting ? [{ total: rows.length }] : rows;
    };

    const self: Record<string, unknown> = {
      from: (t: { __table: string }) => ((table = t.__table), self),
      where: (p: Predicate) => ((where = p), self),
      limit: () => self,
      orderBy: () => self,
      for: (mode: string) => ((lock = mode), self),
      then: (ok: (v: Row[]) => unknown, err?: (e: unknown) => unknown) => run().then(ok, err),
    };
    return self;
  }

  function insert(t: { __table: string }) {
    let values: Row | Row[] = [];
    const run = async (): Promise<Row[]> => {
      const rows = Array.isArray(values) ? values : [values];
      state.journal.push(`${scope}:insert ${t.__table}`);
      const target = tableRows(t.__table);
      if (!target) return rows;
      const created = rows.map((r, i) => ({
        id: `analysis-${target.length + i + 1}`,
        uploadedAt: new Date(),
        deletedAt: null,
        narrativeStatus: "ok",
        ...r,
      }));
      target.push(...created);
      return created;
    };

    const self: Record<string, unknown> = {
      values: (v: Row | Row[]) => ((values = v), self),
      returning: () => self,
      then: (ok: (v: Row[]) => unknown, err?: (e: unknown) => unknown) => run().then(ok, err),
    };
    return self;
  }

  function update(t: { __table: string }) {
    let payload: Row = {};
    let where: Predicate;
    const run = async (): Promise<Row[]> => {
      state.journal.push(`${scope}:update ${t.__table}`);
      state.updates.push(payload);
      const target = tableRows(t.__table) ?? [];
      const hit = target.filter((r) => matches(r, where));
      for (const row of hit) Object.assign(row, payload);
      return hit;
    };

    const self: Record<string, unknown> = {
      set: (v: Row) => ((payload = v), self),
      where: (p: Predicate) => ((where = p), self),
      returning: () => self,
      then: (ok: (v: Row[]) => unknown, err?: (e: unknown) => unknown) => run().then(ok, err),
    };
    return self;
  }

  return { select, insert, update };
}

const db = {
  ...handle(null),
  delete: () => ({
    where: () => ({
      returning: () => Promise.resolve([]),
      then: (ok: (v: Row[]) => unknown) => Promise.resolve([]).then(ok),
    }),
  }),
  async transaction<T>(body: (tx: ReturnType<typeof handle>) => Promise<T>): Promise<T> {
    const ctx: TxContext = { releases: [] };
    state.journal.push("begin");
    try {
      const out = await body(handle(ctx));
      state.journal.push("commit");
      return out;
    } catch (err) {
      state.journal.push("rollback");
      throw err;
    } finally {
      for (const release of ctx.releases) release();
    }
  },
};

vi.mock("@workspace/db", () => ({
  db,
  usersTable: fixtures.users,
  analysesTable: fixtures.analyses,
  coachingTipsTable: fixtures.coachingTips,
  injuryRisksTable: fixtures.injuryRisks,
  progressEntriesTable: fixtures.progressEntries,
  subscriptionsTable: fixtures.subscriptions,
  athleteProfilesTable: fixtures.athleteProfiles,
}));

// ─── The coach, always unreachable ───────────────────────────────────────────

const coach = vi.hoisted(() => {
  class CoachUnavailableError extends Error {}
  return { CoachUnavailableError };
});

vi.mock("../src/lib/claude.js", () => ({
  CoachUnavailableError: coach.CoachUnavailableError,
  generateNarrative: vi.fn(async () => {
    throw new coach.CoachUnavailableError("no API key configured");
  }),
}));

const { startAnalysis, runPipeline } = await import("../src/services/analysisService.js");
const { countAnalysesSince } = await import("../src/repositories/analysisRepository.js");
const { startOfMonth, TIER_LIMITS } = await import("../src/services/entitlementService.js");

// ─── Fixtures ────────────────────────────────────────────────────────────────

const USER = "11111111-1111-4111-8111-111111111111";
const FREE_LIMIT = TIER_LIMITS.free.analysesPerMonth;

/** A row shaped like one that has spent a slot. */
function spent(over: Row = {}): Row {
  return {
    id: `seed-${state.analyses.length + 1}`,
    userId: USER,
    status: "complete",
    analysisMethod: "pose-measured",
    narrativeStatus: "ok",
    uploadedAt: new Date(),
    deletedAt: null,
    ...over,
  };
}

/** Measurements good enough for `isScorable`, so the pipeline reaches the coach. */
const METRICS = {
  frameCount: 120,
  trackingQuality: 0.9,
  durationSec: 12,
  joints: { leftKnee: { min: 70, max: 170, mean: 120, stdDev: 20 } },
  riskFrames: { leftKnee: { caution: 0, risk: 0 } },
};

const UPLOAD = { title: "Back squat", sport: "weightlifting" };

beforeEach(() => {
  state.analyses = [];
  state.subscriptions = [];
  state.journal = [];
  state.updates = [];
  lockQueue.clear();
});

// ─── Finding 1: the slot and the row are written together ────────────────────

describe("a monthly slot is claimed by the transaction that spends it", () => {
  it("refuses the upload past the limit, and writes no row for it", async () => {
    for (let i = 0; i < FREE_LIMIT; i++) state.analyses.push(spent());

    const result = await startAnalysis(USER, { ...UPLOAD, poseMetrics: METRICS });

    expect(result.admitted).toBe(false);
    expect(state.analyses).toHaveLength(FREE_LIMIT);
    expect(state.journal).not.toContain("tx:insert analyses");
  });

  it("keeps the refusal copy the pricing screen promises", async () => {
    for (let i = 0; i < FREE_LIMIT; i++) state.analyses.push(spent());

    const result = await startAnalysis(USER, { ...UPLOAD, poseMetrics: METRICS });

    // User-facing, and load-bearing: the number here is the number on the
    // pricing screen, and the date is when the athlete can film again.
    expect(result.admitted).toBe(false);
    if (result.admitted) return;
    expect(result.rejection.error).toBe("Monthly analysis limit reached");
    expect(result.rejection.code).toBe("UPGRADE_REQUIRED");
    expect(result.rejection.message).toMatch(
      new RegExp(`Your plan includes ${FREE_LIMIT} analyses per month\\.`),
    );
    expect(Date.parse(result.rejection.resetsAt)).toBeGreaterThan(Date.now());
  });

  it("admits the last upload inside the allowance", async () => {
    for (let i = 0; i < FREE_LIMIT - 1; i++) state.analyses.push(spent());

    const result = await startAnalysis(USER, { ...UPLOAD, poseMetrics: METRICS });

    expect(result.admitted).toBe(true);
    expect(state.analyses).toHaveLength(FREE_LIMIT);
  });

  it("locks the owner, counts, then inserts — in that order, in one transaction", async () => {
    await startAnalysis(USER, { ...UPLOAD, poseMetrics: METRICS });

    // The ordering *is* the fix. A count before `begin`, or an insert after
    // `commit`, is the shape that let twenty uploads through.
    expect(state.journal).toEqual([
      "db:select subscriptions",
      "begin",
      "tx:lock users update",
      "tx:select analyses count",
      "tx:insert analyses",
      "commit",
    ]);
  });

  it("admits exactly the allowance when the whole month arrives at once", async () => {
    // The reported defect, reproduced: twenty concurrent uploads from one free
    // account. Under the old check-then-act all twenty observed `used = 0`.
    const attempts = await Promise.all(
      Array.from({ length: 20 }, () =>
        startAnalysis(USER, { ...UPLOAD, poseMetrics: METRICS }),
      ),
    );

    expect(attempts.filter((a) => a.admitted)).toHaveLength(FREE_LIMIT);
    expect(state.analyses).toHaveLength(FREE_LIMIT);
  });

  it("does not serialise an unlimited plan behind its own user row", async () => {
    state.subscriptions.push({
      userId: USER,
      tier: "pro",
      status: "active",
      currentPeriodEnd: new Date(Date.now() + 86_400_000),
    });

    const result = await startAnalysis(USER, { ...UPLOAD, poseMetrics: METRICS });

    expect(result.admitted).toBe(true);
    // Nothing to race, so nothing to lock: an unlimited account's uploads must
    // not queue behind each other for a count that can never refuse them.
    expect(state.journal).not.toContain("begin");
    expect(state.journal.some((entry) => entry.includes("lock"))).toBe(false);
  });
});

// ─── Finding 2: half an analysis is not an analysis ──────────────────────────

describe("an analysis whose write-up never arrived", () => {
  async function measureWithNoCoach(): Promise<void> {
    const created = await startAnalysis(USER, { ...UPLOAD, poseMetrics: METRICS });
    expect(created.admitted).toBe(true);
    if (!created.admitted) return;
    await runPipeline(created.analysis.id, USER, UPLOAD, undefined, METRICS as never);
  }

  it("stops counting against the month", async () => {
    await measureWithNoCoach();

    expect(state.analyses).toHaveLength(1);
    expect(state.analyses[0].narrativeStatus).toBe("unavailable");
    // The athlete got measurements and no coaching. Nothing retries the missing
    // half, so the slot has to be released now or never.
    expect(await countAnalysesSince(USER, startOfMonth())).toBe(0);
  });

  it("leaves the measurements intact and the analysis complete", async () => {
    await measureWithNoCoach();

    // The scores are real and were persisted before the coach was called; the
    // flag is about the prose, not the measurement.
    expect(state.analyses[0].status).toBe("complete");
    expect(state.analyses[0].analysisMethod).toBe("pose-measured");
    expect(state.analyses[0].overallScore).not.toBeNull();
  });

  it("does not promise coaching notes that are never coming", async () => {
    await measureWithNoCoach();

    const summary = String(state.analyses[0].summary);
    // There is no retry, no queue and no regenerate control in this codebase.
    // "They will appear here shortly" was a promise nothing could keep — the
    // same class of defect as the "Pull to refresh" copy it replaced, on a
    // screen with no RefreshControl.
    expect(summary).not.toMatch(/shortly|will appear|pull to refresh|try again later/i);
    expect(summary).toMatch(/couldn't be generated/i);
  });

  it("frees the slot the athlete could not use", async () => {
    // The whole month, then a failed write-up on the last one: the athlete is
    // owed that slot back, and the copy says so.
    for (let i = 0; i < FREE_LIMIT - 1; i++) state.analyses.push(spent());
    await measureWithNoCoach();

    expect(await countAnalysesSince(USER, startOfMonth())).toBe(FREE_LIMIT - 1);
    expect(String(state.analyses.at(-1)?.summary)).toMatch(/doesn't count/i);
  });
});

// ─── The shape that caused it, kept out ──────────────────────────────────────

describe("no quota verdict is read outside the write that acts on it", () => {
  const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");
  const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), "utf8");
  const stripComments = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("the create route does not count before it inserts", () => {
    // `checkQuota` returned a verdict the route was expected to act on, and the
    // gap between reading it and acting was the bug. A route that reads a count
    // and then decides has reopened it, whatever the helper is called.
    const src = stripComments(read("routes/analyses.ts"));
    const createHandler = src.slice(src.indexOf('router.post("/analyses"'));

    expect(createHandler).not.toMatch(/checkQuota|countAnalysesSince/);
    expect(createHandler.indexOf("getUsage")).toBe(-1);
  });

  it("the enforcing count and the displayed count are one predicate", () => {
    // Two spellings of "what spends a slot" drift, and the shape of that bug is
    // an athlete told they have one analysis left and then refused it.
    const src = stripComments(read("repositories/analysisRepository.ts"));
    const uses = src.match(/quotaConsuming\(/g) ?? [];
    expect(uses.length).toBeGreaterThanOrEqual(3); // the definition and both call sites
    expect(src).toMatch(/ne\(analysesTable\.narrativeStatus, "unavailable"\)/);
  });
});
