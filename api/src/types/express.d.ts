import type { AuthUser } from "../auth/session";

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
