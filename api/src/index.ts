import path from "path";
import { config } from "dotenv";
config({ path: path.resolve(__dirname, "../../.env") });

import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";

const app = express();
app.use(cors({ origin: process.env.WEB_ORIGIN, credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.get("/health", (_req, res) => res.json({ status: "ok" }));

const port = Number(process.env.API_PORT) || 4000;
app.listen(port, () => console.log(`API listening on :${port}`));
