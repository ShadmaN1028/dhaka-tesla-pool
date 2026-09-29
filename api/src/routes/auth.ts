import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { endSession, startSession } from "../auth/session";
import { db } from "../db/client";
import { users } from "../db/schema";
import { AppError } from "../errors";
import { authLimiter } from "../middleware/rateLimit";
import { validate } from "../middleware/validate";

const BCRYPT_ROUNDS = 10;
// Checked against when the email is unknown, so a wrong email takes as long as a wrong password.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", BCRYPT_ROUNDS);

const email = z.string().trim().toLowerCase().pipe(z.email());

const signupBody = z.object({
  name: z.string().trim().min(2).max(50),
  email,
  password: z.string().min(8).max(72),
});

const loginBody = z.object({
  email,
  password: z.string().min(1),
});

const publicUser = (u: Pick<typeof users.$inferSelect, "id" | "name" | "email" | "role">) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
});

export const authRouter = Router();

authRouter.post("/signup", authLimiter, validate({ body: signupBody }), async (req, res) => {
  const { name, email, password } = req.body as z.infer<typeof signupBody>;
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const [user] = await db
    .insert(users)
    .values({ name, email, passwordHash, role: "PASSENGER" })
    .onConflictDoNothing({ target: users.email })
    .returning({ id: users.id, name: users.name, email: users.email, role: users.role });
  if (!user) throw new AppError(409, "EMAIL_TAKEN", "An account with this email already exists");

  startSession(res, user);
  res.status(201).json({ user });
});

authRouter.post("/login", authLimiter, validate({ body: loginBody }), async (req, res) => {
  const { email, password } = req.body as z.infer<typeof loginBody>;

  const [user] = await db.select().from(users).where(eq(users.email, email));
  const passwordMatches = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !passwordMatches) {
    throw new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password");
  }

  startSession(res, user);
  res.json({ user: publicUser(user) });
});

authRouter.post("/logout", (_req, res) => {
  endSession(res);
  res.status(204).end();
});
