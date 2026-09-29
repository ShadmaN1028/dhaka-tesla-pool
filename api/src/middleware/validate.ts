import type { RequestHandler } from "express";
import type { ZodType } from "zod";
import { AppError } from "../errors";

const SOURCES = ["body", "params", "query"] as const;
type Source = (typeof SOURCES)[number];

export function validate(schemas: Partial<Record<Source, ZodType>>): RequestHandler {
  return (req, _res, next) => {
    const problems: string[] = [];
    const parsed: Partial<Record<Source, unknown>> = {};

    for (const source of SOURCES) {
      const schema = schemas[source];
      if (!schema) continue;
      const result = schema.safeParse(req[source]);
      if (result.success) {
        parsed[source] = result.data;
      } else {
        for (const issue of result.error.issues) {
          problems.push(`${[source, ...issue.path.map(String)].join(".")}: ${issue.message}`);
        }
      }
    }

    if (problems.length > 0) {
      return next(new AppError(400, "VALIDATION_ERROR", problems.join("; ")));
    }

    if ("body" in parsed) req.body = parsed.body;
    if ("params" in parsed) req.params = parsed.params as typeof req.params;
    // Express 5 defines req.query as a read-only getter, so it has to be redefined.
    if ("query" in parsed) {
      Object.defineProperty(req, "query", {
        value: parsed.query,
        configurable: true,
        enumerable: true,
        writable: true,
      });
    }
    next();
  };
}
