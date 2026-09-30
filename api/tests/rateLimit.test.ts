import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../src/app";
import { env } from "../src/env";
import { AUTH_LIMIT } from "../src/middleware/rateLimit";

// The limiters are skipped when NODE_ENV is "test"; these tests switch them on.
async function withLimitersOn(run: () => Promise<void>) {
  const original = env.NODE_ENV;
  env.NODE_ENV = "development";
  try {
    await run();
  } finally {
    env.NODE_ENV = original;
  }
}

async function withTrustProxy(value: boolean | number | string, run: () => Promise<void>) {
  app.set("trust proxy", value);
  try {
    await run();
  } finally {
    app.set("trust proxy", env.TRUST_PROXY);
  }
}

// Bodies that fail validation are answered quickly (400), but the limiter runs first and still counts them.
const login = (email: string, forwardedFor?: string) => {
  const req = request(app).post("/auth/login");
  return (forwardedFor ? req.set("X-Forwarded-For", forwardedFor) : req).send({ email });
};
const signup = (forwardedFor: string) =>
  request(app).post("/auth/signup").set("X-Forwarded-For", forwardedFor).send({});

describe("the login rate limit", () => {
  it("gives every account its own budget, however the email is written", async () => {
    await withLimitersOn(async () => {
      for (let i = 0; i < AUTH_LIMIT; i++) {
        expect((await login("a@teslapool.dev")).status).toBe(400);
      }
      const blocked = await login("a@teslapool.dev");
      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe("RATE_LIMITED");

      expect((await login("  A@TeslaPool.dev ")).status).toBe(429);
      // Other accounts from the same address are unaffected, so one user cannot use up everyone's budget.
      expect((await login("b@teslapool.dev")).status).toBe(400);
    });
  }, 30_000);

  it("is not reset by a forged X-Forwarded-For while proxy headers are not trusted", async () => {
    await withLimitersOn(() =>
      withTrustProxy(false, async () => {
        for (let i = 0; i < AUTH_LIMIT; i++) {
          expect((await login("c@teslapool.dev", "1.1.1.1")).status).toBe(400);
        }
        expect((await login("c@teslapool.dev", "1.1.1.1")).status).toBe(429);
        expect((await login("c@teslapool.dev", "2.2.2.2")).status).toBe(429);
        expect((await login("c@teslapool.dev")).status).toBe(429);
      }),
    );
  }, 30_000);
});

describe("the signup rate limit", () => {
  it("with a trusted proxy, gives each forwarded client IP its own budget and ignores forged leading hops", async () => {
    await withLimitersOn(() =>
      withTrustProxy(1, async () => {
        for (let i = 0; i < AUTH_LIMIT; i++) {
          expect((await signup("10.0.0.1")).status).toBe(400);
        }
        expect((await signup("10.0.0.1")).status).toBe(429);

        expect((await signup("10.0.0.2")).status).toBe(400);
        // Only the last hop (added by the trusted proxy) counts, so a forged first hop changes nothing.
        expect((await signup("99.99.99.99, 10.0.0.1")).status).toBe(429);
      }),
    );
  }, 30_000);
});
