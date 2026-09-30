import type { Request } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { env } from "../env";
import { AppError } from "../errors";

export const AUTH_LIMIT = 20;

function limiter(keyGenerator: (req: Request) => string) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: AUTH_LIMIT,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator,
    skip: () => env.NODE_ENV === "test",
    handler: (_req, _res, next) =>
      next(new AppError(429, "RATE_LIMITED", "Too many attempts, please try again later")),
  });
}

const clientIp = (req: Request) => ipKeyGenerator(req.ip ?? "");

export const signupLimiter = limiter(clientIp);

// Keyed by client IP and account. Behind the Next.js proxy the API may not see the real client IP
// (Next adds no X-Forwarded-For), so the account is what stops one user's attempts from using up
// everybody else's budget, and it is also what password guessing targets.
export const loginLimiter = limiter(
  (req) => `${clientIp(req)}|${String(req.body?.email ?? "").trim().toLowerCase().slice(0, 254)}`,
);
