import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// RFC 6238 time-based one-time codes, the kind Google Authenticator, Microsoft
// Authenticator, Authy and 1Password generate: HMAC-SHA1, 6 digits, 30-second steps.

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of input.replace(/=+$/, "").toUpperCase()) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error("invalid_base32");
    value = ((value << 5) | i) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// 160 random bits, as RFC 4226 recommends.
export const newTotpSecret = () => base32Encode(randomBytes(20));

export const totpStep = (now = Date.now()) => Math.floor(now / 1000 / STEP_SECONDS);

export function totpCode(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const o = h[h.length - 1]! & 0x0f;
  const n = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(n % 1_000_000).padStart(6, "0");
}

// The step a code belongs to (this one, or one either side for clock drift), or null.
// Steps at or before `usedStep` are refused, so each code works once.
export function matchTotp(secret: string, code: string, usedStep: number | null, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = totpStep(now);
  let match: number | null = null;
  for (const step of [current - 1, current, current + 1]) {
    if (usedStep !== null && step <= usedStep) continue;
    if (timingSafeEqual(Buffer.from(totpCode(secret, step)), Buffer.from(code)) && match === null) match = step;
  }
  return match;
}

// What an authenticator app scans to add the account.
export const otpauthUrl = (secret: string, account: string) =>
  `otpauth://totp/${encodeURIComponent(`Wymlink:${account}`)}?secret=${secret}&issuer=Wymlink&algorithm=SHA1&digits=6&period=30`;
