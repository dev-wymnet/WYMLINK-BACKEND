import type { Request } from "express";
import rateLimit from "express-rate-limit";

// Every limiter answers in the API's normal error shape, so apps can show it.
const tooMany = {
  success: false,
  error: { code: "RATE_LIMITED", message: "Too many attempts. Please wait a moment and try again." },
};

const identity = (req: Request) => String(req.body?.email || req.body?.phone || "").trim().toLowerCase();

export function limiter(input: {
  windowMs: number;
  max: number;
  // ip (default) | user (signed-in user, else ip) | ip+identity (ip and the email/phone tried)
  by?: "ip" | "user" | "ip+identity";
}) {
  const by = input.by ?? "ip";
  return rateLimit({
    windowMs: input.windowMs,
    max: input.max,
    standardHeaders: true,
    legacyHeaders: false,
    message: tooMany,
    keyGenerator: (req) => {
      const ip = req.ip ?? "anon";
      if (by === "user") return (req as any).user?.id ?? ip;
      if (by === "ip+identity") return `${ip}:${identity(req)}`;
      return ip;
    },
  });
}
