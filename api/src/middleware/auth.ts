import type { RequestHandler } from "express";
import { SESSION_COOKIE, verifySession, type UserRole } from "../auth/session";
import { AppError } from "../errors";

const unauthenticated = () => new AppError(401, "UNAUTHENTICATED", "Authentication required");

export const requireAuth: RequestHandler = (req, _res, next) => {
  const token: unknown = req.cookies?.[SESSION_COOKIE];
  const user = typeof token === "string" ? verifySession(token) : null;
  if (!user) return next(unauthenticated());
  req.user = user;
  next();
};

// Must run after requireAuth.
export const requireRole =
  (role: UserRole): RequestHandler =>
  (req, _res, next) => {
    if (!req.user) return next(unauthenticated());
    if (req.user.role !== role) {
      return next(new AppError(403, "FORBIDDEN", `This action requires the ${role} role`));
    }
    next();
  };
