import pino from "pino";
import { pinoHttp } from "pino-http";
import { env } from "./env";

export const logger = pino({
  level: env.NODE_ENV === "test" ? "silent" : "info",
  // Session JWTs travel in cookies, so they must never reach the logs.
  redact: ["req.headers.authorization", "req.headers.cookie", 'res.headers["set-cookie"]'],
});

export const httpLogger = pinoHttp({ logger });
