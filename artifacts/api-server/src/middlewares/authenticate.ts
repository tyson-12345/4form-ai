import type { Request, Response, NextFunction } from "express";
import { verifyToken } from "../lib/auth.js";
import { logger } from "../lib/logger.js";

export interface AuthRequest extends Request {
  userId?: string;
  userEmail?: string;
}

/**
 * Single generic message for every authentication failure.
 *
 * Distinguishing "no header" from "malformed token" from "expired token" tells
 * an attacker how far they got. The specific reason is logged instead.
 */
const AUTH_REQUIRED = "Authentication required. Please sign in.";

export function authenticate(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): void {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    logger.warn(
      { path: req.path, event: "auth_missing_header" },
      "Request without a bearer token",
    );
    res.status(401).json({ error: AUTH_REQUIRED });
    return;
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    res.status(401).json({ error: AUTH_REQUIRED });
    return;
  }

  try {
    const payload = verifyToken(token);
    req.userId = payload.userId;
    req.userEmail = payload.email;
    next();
  } catch (err) {
    // Log the reason (expired vs malformed vs bad signature) but never the token.
    logger.warn(
      {
        path: req.path,
        reason: err instanceof Error ? err.message : "unknown",
        event: "auth_token_rejected",
      },
      "Rejected bearer token",
    );
    res.status(401).json({ error: AUTH_REQUIRED });
  }
}
