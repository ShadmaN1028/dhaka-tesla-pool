import type { ErrorRequestHandler, RequestHandler } from "express";
import { AppError } from "../errors";

const BODY_PARSER_ERRORS: Record<string, [status: number, code: string, message: string]> = {
  "entity.parse.failed": [400, "INVALID_JSON", "Request body is not valid JSON"],
  "entity.too.large": [413, "PAYLOAD_TOO_LARGE", "Request body is too large"],
};

function toAppError(err: unknown): AppError | undefined {
  if (err instanceof AppError) return err;
  const type = (err as { type?: unknown } | null)?.type;
  const mapped = typeof type === "string" ? BODY_PARSER_ERRORS[type] : undefined;
  return mapped && new AppError(...mapped);
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
