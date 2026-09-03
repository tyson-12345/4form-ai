/**
 * Who is making this request, resolved once and shared.
 *
 * ── Why this is not just `authenticate` ─────────────────────────────────────
 * Rate limiters are mounted in `app.ts`, above the router, so they run *before*
 * any route's `authenticate` middleware has set `req.userId`. A limiter that
 * wants to key on the account therefore has to work the bearer token out for
 * itself — and doing that naively means every authenticated request verifies its
 * own JWT twice, once for the limiter and once for the real check.
 *
 * So the verification is done once and memoised on the request. `authenticate`
 * reads the same cache, and remains the only thing that decides whether a
 * request is *allowed*: this module answers "who does this token claim to be",
 * never "should this proceed". It deliberately swallows every failure and
 * returns `null`, because a limiter must not be the thing that rejects a bad
 * token — the 401 belongs to `authenticate`, with its single generic message.
 */

import type { Request } from "express";
import { verifyToken, type VerifiedToken } from "./auth.js";

/** Memo slot. `null` means "resolved, and there is no valid claim". */
const CACHE = Symbol.for("fourform.requestIdentity");

interface Carrier {
  [CACHE]?: { token: VerifiedToken | null };
}

/**
 * The verified claim on this request's bearer token, or `null`.
 *
 * `null` covers every uninteresting case at once — no header, wrong scheme,
 * malformed token, bad signature, expired, or a flow token carrying a `purpose`
 * claim. None of those is a caller this function can name, and none is a
 * distinction worth exposing to a limiter.
 *
 * Note this says nothing about revocation: a token issued before the account's
 * `sessionsValidAfter`, or one whose `jti` has been signed out, still resolves
 * here. That is correct for a rate-limit key — the request is still *from* that
 * account, and bucketing a stream of revoked-token requests under the account
 * they name is better than scattering them across IPs.
 */
export function requestIdentity(req: Request): VerifiedToken | null {
  const carrier = req as unknown as Carrier;
  const cached = carrier[CACHE];
  if (cached) return cached.token;

  let token: VerifiedToken | null = null;
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    const raw = header.slice(7).trim();
    if (raw) {
      try {
        token = verifyToken(raw);
      } catch {
        // Not this module's business — see the header comment.
        token = null;
      }
    }
  }

  carrier[CACHE] = { token };
  return token;
}

/** Test seam: forget a memoised identity so one request object can be reused. */
export function __clearRequestIdentity(req: Request): void {
  delete (req as unknown as Carrier)[CACHE];
}
