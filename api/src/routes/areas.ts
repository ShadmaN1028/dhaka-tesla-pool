import { Router } from "express";
import { db } from "../db/client";
import { areas } from "../db/schema";
import { requireAuth } from "../middleware/auth";

export const areasRouter = Router();

areasRouter.get("/", requireAuth, async (_req, res) => {
  res.json(await db.select({ id: areas.id, name: areas.name }).from(areas).orderBy(areas.name));
});
