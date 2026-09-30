import type { CookieOptions, Response } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { userRole } from "../db/schema";
import { env } from "../env";

export type UserRole = (typeof userRole.enumValues)[number];
export interface AuthUser {
  id: string;
  role: UserRole;
}

export const SESSION_COOKIE = "session";
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

const sessionPayload = z.object({ sub: z.uuid(), role: z.enum(userRole.enumValues) });

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

export function verifySession(token: string): AuthUser | null {
  try {
    const payload = sessionPayload.parse(
      jwt.verify(token, env.JWT_SECRET, { algorithms: ["HS256"] }),
    );
    return { id: payload.sub, role: payload.role };
  } catch {
    return null;
  }
}

export function endSession(res: Response) {
  res.clearCookie(SESSION_COOKIE, cookieOptions);
}
