import crypto from "node:crypto";

export function sha256Base64Url(input: string): string {
  return crypto.createHash("sha256").update(input).digest("base64url");
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function sha512Hex(input: string): string {
  return crypto.createHash("sha512").update(input).digest("hex");
}

export function hmacSha512Hex(key: string, data: Buffer | string): string {
  return crypto.createHmac("sha512", key).update(data).digest("hex");
}
