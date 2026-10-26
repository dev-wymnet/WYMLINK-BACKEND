import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

import { env } from "../config/env.js";

// Reversible encryption for a value Wymlink must hold briefly in plain form (a customer's
// BVN between submission and opening their Moneta account). AES-256-GCM with a key
// derived from KYC_HASH_SECRET for this purpose only. Output: base64(iv | tag | data).
const key = () => Buffer.from(hkdfSync("sha256", env.KYC_HASH_SECRET, "wymlink", "seal:v1", 32));

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
}

export function unseal(sealed: string): string {
  const raw = Buffer.from(sealed, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}
