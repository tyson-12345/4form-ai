/**
 * Federated sign-in: Apple and Google.
 *
 * ── The shape of the flow ───────────────────────────────────────────────────
 * `POST /auth/oauth` is the single entry point and it has three possible
 * outcomes, because a verified provider identity can mean three different
 * things:
 *
 *   200  We have seen this provider account before. Signed in.
 *   428  Verified, but no account yet. The provider does not tell us a date of
 *        birth and we cannot create an account without one, so the client is
 *        handed a short-lived registration token and comes back to
 *        `/auth/oauth/complete` with a birth date.
 *   409  Verified, but this address already belongs to an account. The client
 *        is handed a link challenge and comes back to `/auth/oauth/link` with
 *        that account's password.
 *
 * ── Why 409 is a challenge and not a silent link ────────────────────────────
 * The tempting shortcut is to see a matching email and just attach the identity
 * — one fewer screen, and it is what most apps do. It is also an account
 * takeover primitive the moment the email match is wrong in either direction,
 * and email matches are wrong more often than people expect: an address can be
 * recycled by a domain owner, a provider can assert an address it has not
 * actually verified, and a corporate Workspace admin can create a Google
 * account for any address in a domain they control. Every one of those turns
 * "sign in with Google" into "take over the account belonging to that address".
 *
 * Demanding the password once turns the provider's assertion from *proof of
 * ownership* into *a claim we then verify against something the real owner
 * knows*. It costs one screen, once, forever.
 *
 * ── Why an unverified provider email is refused outright ────────────────────
 * Below, an identity whose email the provider has not verified is not linked
 * and not registered — it is refused. Linking would be the takeover above.
 * Registering would collide with the `users.email` unique index if the address
 * is taken, and would silently create a second account with someone else's
 * address if it is not. There is no safe third option, so the flow stops and
 * points the user at email and password. In practice this is near-unreachable:
 * Apple always verifies, and so does Google for consumer accounts.
 *
 * ── On disclosing that an account exists ────────────────────────────────────
 * The 409 tells the caller that an account exists for that address, which
 * everywhere else in this codebase would be a leak worth a lot of care (see the
 * error-message policy in routes/auth.ts). It is not one here, and the reason
 * is worth stating precisely: reaching that response requires presenting a
 * provider-signed, audience-checked, unexpired token asserting a *verified*
 * address. Only someone who controls that mailbox at Apple or Google can obtain
 * one. That person can already learn the same fact by asking for a password
 * reset and reading their own inbox. So the 409 discloses nothing to anyone who
 * could not already find it out, and withholding it would only make the real
 * owner's linking flow inexplicable.
 */

import { Router, type Response } from "express";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  usersTable,
  identitiesTable,
  athleteProfilesTable,
  subscriptionsTable,
} from "@workspace/db";
import type { IdentityProvider } from "@workspace/db";

import { signToken } from "../lib/auth.js";
import { attemptPasswordAuth, completePasswordAuth } from "../lib/passwordAuth.js";
import {
  verifyIdentityToken,
  IdentityTokenError,
  IDENTITY_PROVIDERS,
  providerConfigured,
} from "../lib/oauthProviders.js";
import {
  signRegistrationToken,
  signLinkToken,
  verifyFlowToken,
  FlowTokenError,
} from "../lib/oauthFlowTokens.js";
import { logger } from "../lib/logger.js";
import { parseOrReject, safeBirthDate, safeEmail, safeText } from "../lib/validate.js";
import { clientIp } from "../lib/rateLimit.js";

const router = Router();

// ─── Canonical response strings ──────────────────────────────────────────────

/**
 * Byte-identical to the login route's constant, and asserted equal to it by
 * test/oauth-messages.test.ts.
 *
 * The link challenge checks a password, so it must fail exactly the way the
 * login endpoint fails. A second, slightly different phrasing here would let a
 * caller tell which endpoint rejected them apart from which credential was
 * wrong — and the whole point of the shared password path in lib/passwordAuth.ts
 * is that these two endpoints are indistinguishable.
 */
const INVALID_CREDENTIALS = "Incorrect email or password";

/** Anything wrong with the provider's token. Never says what. */
const PROVIDER_REJECTED =
  "We couldn't verify that sign-in. Please try again, or use your email and password.";

/** The provider gave us no usable, verified address to work from. */
const NO_VERIFIED_EMAIL =
  "That sign-in didn't include a verified email address, so we can't finish setting up your account. Please sign in with your email and password instead.";

/** A registration or link token that has expired or been tampered with. */
const FLOW_EXPIRED =
  "That took too long to finish. Please start signing in again.";

/**
 * Shown only if a client reaches a two-step outcome it does not understand.
 * The app branches on `code` and never displays these, but a stale build — or
 * curl — should still get a sentence rather than the generic "Something went
 * wrong" its error handling would otherwise fall back to.
 */
const LINK_REQUIRED_MESSAGE =
  "You already have an account with this email. Sign in with your password once and we'll connect them.";
const REGISTRATION_REQUIRED_MESSAGE =
  "Almost there — we just need your date of birth to finish setting up your account.";

const PROVIDER_UNAVAILABLE =
  "That sign-in option isn't available right now. Please use your email and password.";

// ─── Schemas ─────────────────────────────────────────────────────────────────

/**
 * Bounded well above a real token (Apple's run ~900 bytes, Google's ~1.2 KB)
 * and well below the 256 KB body cap, so a multi-megabyte string is rejected at
 * the schema rather than being base64-decoded and parsed.
 */
const identityTokenField = z.string().min(20).max(8192);

const startSchema = z.object({
  provider: z.enum(IDENTITY_PROVIDERS as [IdentityProvider, ...IdentityProvider[]]),
  identityToken: identityTokenField,
  /**
   * The raw nonce the client generated for this attempt. Optional so a client
   * that cannot generate one still works, but the mobile app always sends it.
   */
  nonce: z.string().min(16).max(256).regex(/^[A-Za-z0-9_-]+$/).optional(),
  /**
   * Display name, forwarded from the provider credential by the client.
   *
   * Apple returns the user's name to the *device* on first authorization and
   * never puts it in the token, so this cannot be verified and is treated as
   * ordinary untrusted user text. It only ever becomes a profile display name.
   */
  fullName: safeText(1, 80).optional(),
});

const completeSchema = z.object({
  registration: z.string().min(20).max(4096),
  dateOfBirth: safeBirthDate,
  /** Falls back to the name hint carried on the registration token. */
  name: safeText(1, 80).optional(),
});

const linkSchema = z.object({
  challenge: z.string().min(20).max(4096),
  password: z.string().min(1).max(200),
});

// ─── GET /api/auth/oauth/providers ───────────────────────────────────────────

/**
 * Which providers this deployment can actually verify.
 *
 * The app asks before it draws the buttons. Showing "Continue with Google" in a
 * build whose `GOOGLE_CLIENT_IDS` is unset produces a button that fails after
 * the user has already gone through Google's whole consent screen, which reads
 * as a broken app rather than a missing config.
 */
router.get("/auth/oauth/providers", (_req, res) => {
  res.json({ providers: IDENTITY_PROVIDERS.filter(providerConfigured) });
});

// ─── POST /api/auth/oauth ────────────────────────────────────────────────────

router.post("/auth/oauth", async (req, res) => {
  const data = parseOrReject(startSchema, req.body, res, {
    route: "auth/oauth",
    ip: clientIp(req),
  });
  if (!data) return;

  const ip = clientIp(req);
  const { provider } = data;
  // `safeText(...).optional()` widens to `{} | undefined` under this zod
  // version pairing. Narrow once, here, rather than at each use.
  const fullName = typeof data.fullName === "string" && data.fullName.length > 0
    ? data.fullName
    : null;

  if (!providerConfigured(provider)) {
    logger.error(
      { provider, ip, event: "oauth_provider_unconfigured" },
      "Federated sign-in attempted for a provider with no audience allowlist",
    );
    res.status(503).json({ error: PROVIDER_UNAVAILABLE });
    return;
  }

  let identity;
  try {
    identity = await verifyIdentityToken(provider, data.identityToken, data.nonce ?? null);
  } catch (err) {
    // The reason is diagnostic gold and must stay in the log. A caller learns
    // only that it did not work: distinguishing "expired" from "wrong audience"
    // from "bad signature" tells someone probing us exactly which knob to turn.
    logger.warn(
      {
        provider,
        ip,
        code: err instanceof IdentityTokenError ? err.code : "unknown",
        reason: err instanceof Error ? err.message : "unknown",
        event: "oauth_token_rejected",
      },
      "Rejected a provider identity token",
    );
    res.status(401).json({ error: PROVIDER_REJECTED });
    return;
  }

  // ── Returning user ──
  const [existingIdentity] = await db
    .select({ userId: identitiesTable.userId })
    .from(identitiesTable)
    .where(
      and(
        eq(identitiesTable.provider, provider),
        eq(identitiesTable.subject, identity.subject),
      ),
    )
    .limit(1);

  if (existingIdentity) {
    await signInLinkedIdentity(existingIdentity.userId, provider, identity.subject, res, ip);
    return;
  }

  // ── First time we have seen this provider account ──
  //
  // Apple omits the email on every authorization after the first, so a token
  // with no email here means the user has authorized this app before but we
  // have no identity row for them — they deleted their account, or the row was
  // lost. They cannot be identified without revoking the app in iOS Settings
  // so Apple treats the next attempt as a first authorization.
  if (!identity.email || !identity.emailVerified) {
    logger.warn(
      {
        provider,
        ip,
        hasEmail: Boolean(identity.email),
        emailVerified: identity.emailVerified,
        event: "oauth_no_verified_email",
      },
      "Federated sign-in for an unknown subject without a verified email",
    );
    res.status(409).json({ error: NO_VERIFIED_EMAIL, code: "NO_VERIFIED_EMAIL" });
    return;
  }

  // Run the provider's address through the same normalisation every stored
  // address goes through, so the comparison below cannot miss on case or
  // whitespace where the unique index would still collide.
  const parsedEmail = safeEmail.safeParse(identity.email);
  if (!parsedEmail.success) {
    logger.warn(
      { provider, ip, event: "oauth_unusable_email" },
      "Provider asserted an address that failed our own email validation",
    );
    res.status(409).json({ error: NO_VERIFIED_EMAIL, code: "NO_VERIFIED_EMAIL" });
    return;
  }
  const email = parsedEmail.data;

  const [collision] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);

  if (collision) {
    // Challenge-on-collision. See the header for why this is not a silent link.
    logger.info(
      { provider, userId: collision.id, ip, event: "oauth_link_challenge_issued" },
      "Issued an account-link challenge for a federated identity",
    );
    res.status(409).json({
      code: "LINK_REQUIRED",
      error: LINK_REQUIRED_MESSAGE,
      email,
      challenge: signLinkToken({
        provider,
        subject: identity.subject,
        providerEmail: email,
        uid: collision.id,
      }),
    });
    return;
  }

  logger.info(
    { provider, ip, event: "oauth_registration_required" },
    "Verified a new federated identity; awaiting date of birth",
  );
  res.status(428).json({
    code: "REGISTRATION_REQUIRED",
    error: REGISTRATION_REQUIRED_MESSAGE,
    email,
    suggestedName: fullName,
    registration: signRegistrationToken({
      provider,
      subject: identity.subject,
      email,
      ...(fullName ? { nameHint: fullName } : {}),
    }),
  });
});

// ─── POST /api/auth/oauth/complete ───────────────────────────────────────────

/**
 * Redeem a registration token and create the account.
 *
 * The birth date is collected here rather than being skipped for federated
 * signups, and that is the whole reason this second step exists. The age gate
 * is a COPPA/GDPR Art. 8 control (see lib/validate.ts and docs/LEGAL-RISK.md);
 * a signup path that does not ask is not a slightly weaker gate, it is a hole
 * straight through it — and it would be the *easier* path, so it would become
 * the one under-13s use.
 */
router.post("/auth/oauth/complete", async (req, res) => {
  const data = parseOrReject(completeSchema, req.body, res, {
    route: "auth/oauth/complete",
    ip: clientIp(req),
  });
  if (!data) return;

  const ip = clientIp(req);

  let claims;
  try {
    claims = verifyFlowToken(data.registration, "oauth_register");
  } catch (err) {
    logger.warn(
      {
        ip,
        reason: err instanceof FlowTokenError ? err.message : "unknown",
        event: "oauth_registration_token_rejected",
      },
      "Rejected an OAuth registration token",
    );
    res.status(400).json({ error: FLOW_EXPIRED });
    return;
  }

  const { provider, subject, email } = claims;
  const name = (typeof data.name === "string" ? data.name : null) ?? claims.nameHint ?? "";
  if (!name) {
    res.status(400).json({ error: "Please tell us your name to finish setting up your account." });
    return;
  }

  // Re-check both uniqueness conditions. They were true when the token was
  // minted up to twenty minutes ago, and this is the window in which someone
  // could have signed up with the same address by email in another tab — or the
  // same person could have completed this exact flow on a second device.
  const [alreadyLinked] = await db
    .select({ userId: identitiesTable.userId })
    .from(identitiesTable)
    .where(and(eq(identitiesTable.provider, provider), eq(identitiesTable.subject, subject)))
    .limit(1);

  if (alreadyLinked) {
    // The other device won. This is a success, not a conflict.
    await signInLinkedIdentity(alreadyLinked.userId, provider, subject, res, ip);
    return;
  }

  const [collision] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);

  if (collision) {
    // An account appeared under this address while the user was typing their
    // birth date. Fall back to the challenge rather than failing on the unique
    // index — same policy as the first step, just reached later.
    res.status(409).json({
      code: "LINK_REQUIRED",
      error: LINK_REQUIRED_MESSAGE,
      email,
      challenge: signLinkToken({ provider, subject, providerEmail: email, uid: collision.id }),
    });
    return;
  }

  const [user] = await db
    .insert(usersTable)
    .values({
      email,
      // No password. Not a random one: see the `password_hash` column comment.
      passwordHash: null,
      birthDate: data.dateOfBirth.toISOString().slice(0, 10),
    })
    .returning({ id: usersTable.id, email: usersTable.email });

  await Promise.all([
    db.insert(identitiesTable).values({
      userId: user.id,
      provider,
      subject,
      providerEmail: email,
      lastUsedAt: new Date(),
    }),
    db.insert(athleteProfilesTable).values({
      userId: user.id,
      name,
      sport: "",
      level: "beginner",
      goals: [],
      injuryConcerns: [],
    }),
    db.insert(subscriptionsTable).values({
      userId: user.id,
      tier: "free",
      status: "active",
    }),
  ]);

  logger.info(
    { userId: user.id, provider, event: "oauth_signup_success" },
    "Account created through a federated provider",
  );

  const token = signToken({ userId: user.id, email: user.email });
  res.status(201).json({ token, user: { id: user.id, email: user.email, name } });
});

// ─── POST /api/auth/oauth/link ───────────────────────────────────────────────

/**
 * Redeem a link challenge by proving the existing account's password.
 *
 * This endpoint checks a password, so it goes through exactly the same path as
 * `/auth/login` — same lockout counter, same progressive delay, same timing
 * equalisation, same response string. It is deliberately not a cheaper way to
 * test a password than the login endpoint, because if it were, it would simply
 * become the endpoint attackers use.
 *
 * Note what an attacker cannot do even so: they cannot obtain a challenge for
 * an address they do not control at the provider, so they cannot reach this
 * endpoint for someone else's account in the first place.
 */
router.post("/auth/oauth/link", async (req, res) => {
  const data = parseOrReject(linkSchema, req.body, res, {
    route: "auth/oauth/link",
    ip: clientIp(req),
  });
  if (!data) return;

  const ip = clientIp(req);

  let claims;
  try {
    claims = verifyFlowToken(data.challenge, "oauth_link");
  } catch (err) {
    logger.warn(
      {
        ip,
        reason: err instanceof FlowTokenError ? err.message : "unknown",
        event: "oauth_link_token_rejected",
      },
      "Rejected an OAuth link challenge",
    );
    res.status(400).json({ error: FLOW_EXPIRED });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, claims.uid))
    .limit(1);

  // `user` may be undefined if the account was deleted inside the challenge
  // window. `attemptPasswordAuth` handles that as an ordinary failure, at the
  // same cost as every other one.
  const attempt = await attemptPasswordAuth(user, data.password, ip);
  if (!attempt.ok) {
    res.status(401).json({ error: INVALID_CREDENTIALS });
    return;
  }

  await completePasswordAuth(attempt.user, data.password);

  await db
    .insert(identitiesTable)
    .values({
      userId: attempt.user.id,
      provider: claims.provider,
      subject: claims.subject,
      providerEmail: claims.providerEmail,
      lastUsedAt: new Date(),
    })
    // Two devices redeeming the same challenge, or a retry after a dropped
    // response, must not fail on the unique index — the end state is identical.
    .onConflictDoNothing();

  logger.info(
    { userId: attempt.user.id, provider: claims.provider, event: "oauth_identity_linked" },
    "Linked a federated identity to an existing account after password proof",
  );

  const token = signToken({ userId: attempt.user.id, email: attempt.user.email });
  res.json({
    token,
    user: { id: attempt.user.id, email: attempt.user.email },
  });
});

// ─── Shared success path ─────────────────────────────────────────────────────

/**
 * Sign in a user we have already linked to this provider account.
 *
 * Clears any password lockout. That is deliberate: the provider has just proved
 * the person is the account owner, which is the same standard a successful
 * password login meets, and leaving the lock in place would mean an attacker
 * spraying passwords could keep the real owner's password login disabled
 * indefinitely while they sail past it with Apple anyway.
 */
async function signInLinkedIdentity(
  userId: string,
  provider: IdentityProvider,
  subject: string,
  res: Response,
  ip: string,
): Promise<void> {
  const [user] = await db
    .select({ id: usersTable.id, email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (!user) {
    // The identity row outlived its user. The cascade should make this
    // impossible; if it happens, it is a bug worth seeing rather than a
    // condition to paper over.
    logger.error(
      { userId, provider, ip, event: "oauth_identity_orphaned" },
      "Identity row referenced a user that no longer exists",
    );
    res.status(401).json({ error: PROVIDER_REJECTED });
    return;
  }

  await Promise.all([
    db
      .update(identitiesTable)
      .set({ lastUsedAt: new Date() })
      .where(and(eq(identitiesTable.provider, provider), eq(identitiesTable.subject, subject))),
    db
      .update(usersTable)
      .set({ failedLoginAttempts: 0, lockedUntil: null, updatedAt: new Date() })
      .where(eq(usersTable.id, user.id)),
  ]);

  const [profile] = await db
    .select({ name: athleteProfilesTable.name })
    .from(athleteProfilesTable)
    .where(eq(athleteProfilesTable.userId, user.id))
    .limit(1);

  logger.info(
    { userId: user.id, provider, event: "oauth_login_success" },
    "Signed in through a federated provider",
  );

  const token = signToken({ userId: user.id, email: user.email });
  res.json({
    token,
    user: { id: user.id, email: user.email, name: profile?.name ?? "" },
  });
}

export default router;
