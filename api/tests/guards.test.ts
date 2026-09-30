import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { httpLogger } from "../src/logger";
import { requireAuth, requireRole } from "../src/middleware/auth";
import { errorHandler } from "../src/middleware/errorHandler";
import { loginAs } from "./helpers";

// A separate mini app, so the real guards are exercised without adding routes to the main app.
const guarded = express();
guarded.use(httpLogger, cookieParser());
guarded.get("/driver-only", requireAuth, requireRole("DRIVER"), (req, res) => {
  res.json({ user: req.user });
});
guarded.use(errorHandler);

describe("requireRole('DRIVER')", () => {
  it("answers 403 FORBIDDEN to a passenger (Nusrat)", async () => {
    const cookie = await loginAs("nusrat");
    const res = await request(guarded).get("/driver-only").set("Cookie", cookie);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("lets the driver (Jashim) through", async () => {
    const cookie = await loginAs("jashim");
    const res = await request(guarded).get("/driver-only").set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe("DRIVER");
  });
});
