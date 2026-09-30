import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { env } from "./env";
import { httpLogger } from "./logger";
import { errorHandler, notFound } from "./middleware/errorHandler";
import { areasRouter } from "./routes/areas";
import { authRouter } from "./routes/auth";
import { requestsRouter } from "./routes/requests";

export const app = express();

app.use(httpLogger);
app.use(helmet());
app.use(cors({ origin: env.WEB_ORIGIN, credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.use("/auth", authRouter);
app.use("/areas", areasRouter);
app.use("/requests", requestsRouter);

app.use(notFound);
app.use(errorHandler);
