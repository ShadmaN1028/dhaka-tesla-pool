import type { ErrorRequestHandler, RequestHandler } from "express";
import { AppError } from "../errors";

type Mapping = [status: number, code: string, message: string];

const BODY_PARSER_ERRORS: Record<string, Mapping> = {
  "entity.parse.failed": [400, "INVALID_JSON", "Request body is not valid JSON"],
  "entity.too.large": [413, "PAYLOAD_TOO_LARGE", "Request body is too large"],
};

// Postgres unique violations (23505), keyed by constraint or index name.
const UNIQUE_VIOLATIONS: Record<string, Mapping> = {
  ride_requests_one_active_per_passenger_idx: [
    409,
    "ACTIVE_REQUEST_EXISTS",
    "You already have an active ride request",
  ],
  rides_one_active_per_vehicle_idx: [
    409,
    "VEHICLE_HAS_ACTIVE_RIDE",
    "This vehicle already has an active ride",
  ],
};

// Drizzle wraps driver errors, so the pg error can sit further down the cause chain.
function fromUniqueViolation(err: unknown): AppError | undefined {
  let current = err;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
    const { code, constraint, cause } = current as {
      code?: unknown;
      constraint?: unknown;
      cause?: unknown;
    };
    const mapped =
      code === "23505" && typeof constraint === "string" ? UNIQUE_VIOLATIONS[constraint] : undefined;
    if (mapped) return new AppError(...mapped);
    current = cause;
  }
  return undefined;
}

function fromBodyParser(err: unknown): AppError | undefined {
  const type = (err as { type?: unknown } | null)?.type;
  const mapped = typeof type === "string" ? BODY_PARSER_ERRORS[type] : undefined;
  return mapped && new AppError(...mapped);
}

function toAppError(err: unknown): AppError | undefined {
  if (err instanceof AppError) return err;
  return fromUniqueViolation(err) ?? fromBodyParser(err);
}

export const notFound: RequestHandler = (req, _res, next) => {
  next(new AppError(404, "NOT_FOUND", `Route not found: ${req.method} ${req.path}`));
};

export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) return next(err);

  const appError = toAppError(err);
  if (appError) {
    res
      .status(appError.status)
      .json({ error: { code: appError.code, message: appError.message } });
    return;
  }

  req.log.error({ err }, "unhandled error");
  res
    .status(500)
    .json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
};
