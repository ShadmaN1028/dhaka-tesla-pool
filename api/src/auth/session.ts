import type { CookieOptions, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../env";

export const SESSION_COOKIE = "session";
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

const cookieOptions: CookieOptions = {
  httpOnly: true,
  sameSite: env.COOKIE_SAMESITE,
  secure: env.COOKIE_SECURE,
  path: "/",
};

export function startSession(res: Response, user: { id: string; role: string }) {
  const token = jwt.sign({ sub: user.id, role: user.role }, env.JWT_SECRET, {
    expiresIn: SESSION_TTL_SECONDS,
  });
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions, maxAge: SESSION_TTL_SECONDS * 1000 });
}

export function endSession(res: Response) {
  res.clearCookie(SESSION_COOKIE, cookieOptions);
}
