import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../src/app";
import { loginAs } from "./helpers";

describe("POST /auth/signup", () => {
  it("creates a PASSENGER, normalizes the email and sets an httpOnly session cookie", async () => {
    const res = await request(app)
      .post("/auth/signup")
      .send({ name: "Shirin Test", email: "  Shirin.Test@TeslaPool.dev ", password: "tesla1234" });

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({
      name: "Shirin Test",
      email: "shirin.test@teslapool.dev",
      role: "PASSENGER",
    });
    expect(JSON.stringify(res.body)).not.toMatch(/password|\$2[aby]\$/i);

    const cookie = res.get("Set-Cookie")?.find((c) => c.startsWith("session="));
    expect(cookie).toBeDefined();
    expect(cookie).toMatch(/HttpOnly/i);
  });

  it("rejects a duplicate email with 409 EMAIL_TAKEN", async () => {
    const newUser = { name: "Shirin Test", email: "shirin.test@teslapool.dev", password: "tesla1234" };
    expect((await request(app).post("/auth/signup").send(newUser)).status).toBe(201);

    const again = await request(app).post("/auth/signup").send(newUser);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("EMAIL_TAKEN");

    // Nusrat is already seeded; casing and whitespace must not get around the check.
    const seeded = await request(app)
      .post("/auth/signup")
      .send({ name: "Nusrat Again", email: " NUSRAT@teslapool.dev", password: "tesla1234" });
    expect(seeded.status).toBe(409);
    expect(seeded.body.error.code).toBe("EMAIL_TAKEN");
  });
});

describe("POST /auth/login", () => {
  it("rejects a wrong password with 401 INVALID_CREDENTIALS and sets no cookie", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ email: "nusrat@teslapool.dev", password: "not-her-password" });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
    expect(res.get("Set-Cookie")).toBeUndefined();
  });
});

describe("GET /auth/me", () => {
  it("returns 401 UNAUTHENTICATED without a cookie", async () => {
    const res = await request(app).get("/auth/me");

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("returns Nusrat, and never the password hash, with her cookie", async () => {
    const cookie = await loginAs("nusrat");
    const res = await request(app).get("/auth/me").set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      name: "Nusrat",
      email: "nusrat@teslapool.dev",
      role: "PASSENGER",
      is_online: false,
    });
    expect(JSON.stringify(res.body)).not.toMatch(/password|\$2[aby]\$/i);
  });
});
