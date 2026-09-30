import { rateLimit } from "express-rate-limit";
import { env } from "../env";
import { AppError } from "../errors";

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => env.NODE_ENV === "test",
  handler: (_req, _res, next) =>
    next(new AppError(429, "RATE_LIMITED", "Too many attempts, please try again later")),
});
