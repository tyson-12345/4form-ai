import { describe, expect, it } from "vitest";

import { auditUsers, bcryptCost, classify, detectAlgo, type AuditRow } from "./password-audit.js";

/** Shapes only — `detectAlgo` reads the prefix/length, never the contents. */
const BCRYPT_CURRENT = `$2b$12$${"K".repeat(53)}`;
const BCRYPT_WEAK_COST = `$2a$10$${"K".repeat(53)}`;
const MD5 = "d".repeat(32);
const SHA1 = "e".repeat(40);
const SHA256 = "f".repeat(64);

describe("detectAlgo", () => {
  it("identifies each stored format by shape", () => {
    expect(detectAlgo(BCRYPT_CURRENT)).toBe("bcrypt");
    expect(detectAlgo(BCRYPT_WEAK_COST)).toBe("bcrypt");
    expect(detectAlgo(MD5)).toBe("md5");
    expect(detectAlgo(SHA1)).toBe("sha1");
    expect(detectAlgo(SHA256)).toBe("sha256");
    expect(detectAlgo("hunter2")).toBe("plaintext");
  });

  /**
   * Pins the coercion trap this module exists to avoid. `RegExp.prototype.test`
   * stringifies its argument, so a NULL hash reaching here would be tested as
   * the literal text "null", match nothing, and be reported as a plaintext
   * password. Callers must go through `classify`.
   */
  it("would misread a stringified null as plaintext — which is why null never reaches it", () => {
    expect(detectAlgo(String(null))).toBe("plaintext");
  });
});

describe("bcryptCost", () => {
  it("reads the cost factor out of a bcrypt hash", () => {
    expect(bcryptCost(BCRYPT_CURRENT)).toBe(12);
    expect(bcryptCost(BCRYPT_WEAK_COST)).toBe(10);
  });

  it("returns null for anything that is not bcrypt", () => {
    expect(bcryptCost(MD5)).toBeNull();
    expect(bcryptCost("hunter2")).toBeNull();
  });
});

describe("classify", () => {
  it("treats a NULL hash as 'no password', not as a plaintext password", () => {
    expect(classify(null)).toBe("none");
  });

  it("delegates a real hash to detectAlgo", () => {
    expect(classify(BCRYPT_CURRENT)).toBe("bcrypt");
    expect(classify(SHA256)).toBe("sha256");
  });
});

describe("auditUsers — federated-only accounts", () => {
  const federated: AuditRow[] = [
    { id: "apple-user", passwordHash: null },
    { id: "google-user", passwordHash: null },
  ];

  it("counts them under 'none' rather than 'plaintext'", () => {
    const { counts } = auditUsers(federated);
    expect(counts.none).toBe(2);
    expect(counts.plaintext).toBeUndefined();
  });

  /**
   * The regression this module was written for. Before the fix these rows were
   * listed as weak, and `--apply` wrote `password_algo = "plaintext"` — which
   * sends the next login down `verifyPassword`'s fast string-compare branch
   * instead of bcrypt, making federated accounts distinguishable by response
   * time. `attemptPasswordAuth` equalises that timing on purpose.
   */
  it("never reports them as needing migration, so --apply can never tag one", () => {
    const { needsAttention } = auditUsers(federated);
    expect(needsAttention).toEqual([]);
  });

  it("does not let them mask a real finding alongside them", () => {
    const { needsAttention } = auditUsers([...federated, { id: "legacy", passwordHash: MD5 }]);
    expect(needsAttention).toHaveLength(1);
    expect(needsAttention[0]?.id).toBe("legacy");
  });
});

describe("auditUsers — password rows", () => {
  it("leaves a current bcrypt hash alone", () => {
    const { counts, needsAttention } = auditUsers([{ id: "u", passwordHash: BCRYPT_CURRENT }]);
    expect(counts.bcrypt).toBe(1);
    expect(needsAttention).toEqual([]);
  });

  it("flags a bcrypt hash below the current cost, naming the cost", () => {
    const { needsAttention } = auditUsers([{ id: "u", passwordHash: BCRYPT_WEAK_COST }]);
    expect(needsAttention).toHaveLength(1);
    expect(needsAttention[0]?.detected).toBe("bcrypt");
    expect(needsAttention[0]?.reason).toContain("cost 10");
  });

  it.each([
    ["md5", MD5],
    ["sha1", SHA1],
    ["sha256", SHA256],
    ["plaintext", "hunter2"],
  ])("flags a %s hash with its detected algorithm", (algo, hash) => {
    const { needsAttention } = auditUsers([{ id: "u", passwordHash: hash }]);
    expect(needsAttention).toHaveLength(1);
    expect(needsAttention[0]?.detected).toBe(algo);
  });

  /**
   * An empty `password_hash` is not a documented state — the column is either
   * NULL or a real hash. It is deliberately *not* folded into "none": corrupt
   * data should reach a human rather than be counted as a healthy federated
   * account. Pinned so the behaviour cannot change silently.
   */
  it("treats an empty hash as corrupt data worth flagging, not as 'no password'", () => {
    const { counts, needsAttention } = auditUsers([{ id: "u", passwordHash: "" }]);
    expect(counts.none).toBeUndefined();
    expect(needsAttention).toHaveLength(1);
  });
});

describe("auditUsers — mixed population", () => {
  const users: AuditRow[] = [
    { id: "a", passwordHash: null },
    { id: "b", passwordHash: null },
    { id: "c", passwordHash: BCRYPT_CURRENT },
    { id: "d", passwordHash: BCRYPT_WEAK_COST },
    { id: "e", passwordHash: MD5 },
    { id: "f", passwordHash: "hunter2" },
  ];

  it("tallies every row exactly once", () => {
    const { counts } = auditUsers(users);
    expect(counts).toEqual({ none: 2, bcrypt: 2, md5: 1, plaintext: 1 });
    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
    expect(total).toBe(users.length);
  });

  it("flags only the three rows that actually store a weak or outdated password", () => {
    const { needsAttention } = auditUsers(users);
    expect(needsAttention.map((f) => f.id).sort()).toEqual(["d", "e", "f"]);
  });

  /**
   * `--apply` writes `detected` straight into `password_algo`, so every value
   * it can reach must be one the login path understands. "none" must never
   * appear here.
   */
  it("only ever proposes writing a real algorithm to password_algo", () => {
    const { needsAttention } = auditUsers(users);
    for (const finding of needsAttention) {
      expect(["bcrypt", "md5", "sha1", "sha256", "plaintext"]).toContain(finding.detected);
    }
  });

  it("does not mutate the rows it is given", () => {
    const snapshot = JSON.parse(JSON.stringify(users));
    auditUsers(users);
    expect(users).toEqual(snapshot);
  });
});
