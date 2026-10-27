import { Router } from "express";

import { db } from "../../core/db/client.js";
import { updateSubscribers } from "../../core/db/schema.js";
import { ValidationError } from "../../core/errors/ValidationError.js";
import { limiter } from "../../core/middleware/rateLimits.js";

// The website's "Stay updated" form. Public, so it only stores the address: no email is
// sent (it can't be used to mail anyone), and the answer is the same whether or not the
// address was already on the list (it can't be used to check who signed up).
export const updatesRoutes = Router();

const subscribeLimiter = limiter({ windowMs: 60 * 60 * 1000, max: 10 });
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

updatesRoutes.post("/subscribe", subscribeLimiter, async (req, res, next) => {
  try {
    const raw = (req.body as { email?: unknown } | undefined)?.email;
    const email = typeof raw === "string" ? raw.trim().toLowerCase() : "";
    if (!email || email.length > 254 || !EMAIL.test(email)) throw new ValidationError("Enter a valid email address");
    await db.insert(updateSubscribers).values({ email }).onConflictDoNothing();
    res.status(201).json({ subscribed: true });
  } catch (err) {
    next(err);
  }
});
