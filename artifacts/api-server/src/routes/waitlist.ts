/**
 * `POST /waitlist` — the landing page's email capture.
 *
 * ── Why it lives at the root, not under /api ────────────────────────────────
 * This is a form on a web page, submitted by a person, and it is the target of
 * that form's `action` attribute. Putting it under `/api` would mean the
 * landing page's CSP had to allow `form-action /api/…`, and it would inherit
 * rate limits tuned for a mobile client polling an API rather than for a human
 * pressing a button twice. Same reasoning as the reset page.
 *
 * ── Two callers, one handler ────────────────────────────────────────────────
 * The form works with scripting off: the browser posts it, this responds 303,
 * and the page comes back rendered in its joined state (Post/Redirect/Get, so a
 * refresh cannot resubmit). With scripting on, the page's own script intercepts
 * the submit and posts JSON instead, so the reader keeps their scroll position.
 * The two paths differ only in how the answer is shaped — never in what is
 * stored — so there is no second code path that can drift.
 *
 * ── What is not here ────────────────────────────────────────────────────────
 * No confirmation email. The page promises exactly one email, when TestFlight
 * opens; sending a "you joined the waitlist" email would already be two, and
 * the second one would be the kind of mail the copy specifically says we do not
 * send. It also means this endpoint has no mail dependency to fail.
 *
 * No enumeration concern to defend against, either: a waitlist is not an
 * account, and the response is identical whether or not the address was already
 * on the list — because from the reader's side those are the same event.
 *
 * And no CSRF token. There is no session to ride and nothing of the caller's to
 * change: the worst a forged cross-site post achieves is putting an address on
 * a list that will one day send it a single email. Double opt-in would close
 * even that, at the cost of sending a second email to everyone — which is the
 * exact thing the page promises not to do. The rate limit bounds the volume;
 * this is the trade, made deliberately.
 */

import { Router, type IRouter } from "express";

import { addToWaitlist } from "../repositories/waitlistRepository.js";
import { safeEmail } from "../lib/validate.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

/**
 * Where the browser is sent back to, per form. Never taken from the request.
 *
 * A null-prototype object, because a plain one answers `RETURN_TO["constructor"]`
 * with a function rather than undefined — and `?? "/"` only guards null. A
 * non-string then reached `withQuery()`, which called `.indexOf` on it and threw
 * *after* the row had been written: the person was on the list and was told the
 * submission had failed, and an unauthenticated caller had a one-field way to
 * mint 500s and Sentry events.
 */
const RETURN_TO: Record<string, string> = Object.assign(Object.create(null) as Record<string, string>, {
  hero: "/",
  close: "/#waitlist",
});

/**
 * Does this caller want JSON?
 *
 * A browser posting a form sends `Accept: text/html,...` and
 * `Content-Type: application/x-www-form-urlencoded`. The page's own fetch sends
 * `Accept: application/json`. Anything ambiguous is treated as a browser, so
 * the worst case for a hand-rolled client is a redirect it can follow.
 *
 * Exported because the rate limiter in front of this route has to answer the
 * same two audiences, and one of them must not be handed JSON to render.
 */
export function wantsJson(accept: string | undefined, contentType: string | undefined): boolean {
  if (contentType?.includes("application/json")) return true;
  if (!accept) return false;
  return accept.includes("application/json") && !accept.includes("text/html");
}

/** `/#waitlist` + `joined=1` → `/?joined=1#waitlist`, which is the legal form. */
function withQuery(target: string, query: string): string {
  const hash = target.indexOf("#");
  if (hash === -1) return `${target}?${query}`;
  return `${target.slice(0, hash)}?${query}${target.slice(hash)}`;
}

router.post("/waitlist", async (req, res) => {
  const asJson = wantsJson(req.get("accept"), req.get("content-type"));
  const body: Record<string, unknown> =
    req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};

  const from = typeof body["from"] === "string" ? body["from"] : "";
  const back = RETURN_TO[from] ?? "/";

  const parsed = safeEmail.safeParse(typeof body["email"] === "string" ? body["email"] : "");
  if (!parsed.success) {
    if (asJson) {
      res.status(400).json({ error: "That does not look like an email address." });
      return;
    }
    // The query parameter is the whole state: the page re-renders with the
    // message in place, and there is no session to lose.
    res.redirect(303, withQuery(back, "email=invalid"));
    return;
  }

  const created = await addToWaitlist(parsed.data);

  // The address itself is never logged — it is the one piece of personal data
  // this endpoint handles, and a count is all anyone needs from the logs.
  logger.info(
    { created, event: "waitlist_signup" },
    created ? "New waitlist signup" : "Waitlist signup already on the list",
  );

  if (asJson) {
    res.status(200).json({ ok: true });
    return;
  }
  res.redirect(303, withQuery(back, "joined=1"));
});

export default router;
