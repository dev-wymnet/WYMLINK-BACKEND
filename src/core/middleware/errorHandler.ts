import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";

import { AppError } from "../errors/AppError.js";
import { logger } from "../logger/logger.js";

// The first problem, as a message the apps can show as-is. Custom messages ("Your BVN is
// 11 digits") pass through; zod's generic type errors get the field name instead.
function zodMessage(err: ZodError) {
  const issue = err.issues[0];
  if (!issue) return "Validation failed";
  const field = issue.path.join(".");
  if (!field || !/^(Invalid|Required|Expected|Too small|Too big)/.test(issue.message)) return issue.message;
  if (/received undefined/.test(issue.message)) return `${field} is required`;
  if (issue.code === "too_small") return `${field} is too short`;
  if (issue.code === "too_big") return `${field} is too long`;
  return `${field} is invalid`;
}

// Database errors carry the query parameters (password/PIN hashes, emails, phones):
// log what went wrong, never the values.
function loggable(err: any) {
  const cause = err?.cause;
  if (err?.name === "DrizzleQueryError" || (err?.query && err?.params)) {
    return { name: err.name, code: cause?.code, message: cause?.message ?? "query failed", stack: err.stack?.split("\n").slice(1, 6).join("\n") };
  }
  return err;
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    return res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: zodMessage(err),
        details: err.flatten(),
      },
    });
  }

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
      },
    });
  }

  // Malformed or oversized JSON bodies are the client's mistake, not a server error.
  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "The request body isn't valid JSON." } });
  }
  if (err?.type === "entity.too.large") {
    return res.status(413).json({ success: false, error: { code: "PAYLOAD_TOO_LARGE", message: "The request is too large." } });
  }

  logger.error({ err: loggable(err) }, "unhandled_error");

  return res.status(500).json({
    success: false,
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "Internal server error",
    },
  });
};
