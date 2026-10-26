import { ValidationError } from "../errors/ValidationError.js";

// Phones are stored in E.164 (+2348031234567). Nigerian local forms are
// accepted: 08031234567, 8031234567, 2348031234567, +234 803 123 4567.
export function normalizePhone(input: string): string {
  const raw = input.replace(/[\s\-().]/g, "");
  let digits: string;
  if (/^\+[1-9]\d{7,14}$/.test(raw)) digits = raw;
  else if (/^234\d{10}$/.test(raw)) digits = `+${raw}`;
  else if (/^0[789][01]\d{8}$/.test(raw)) digits = `+234${raw.slice(1)}`;
  else if (/^[789][01]\d{8}$/.test(raw)) digits = `+234${raw}`;
  else throw new ValidationError("Enter a valid phone number");
  return digits;
}

export const normalizeEmail = (input: string) => input.trim().toLowerCase();

// inet columns: keep only well-formed addresses (IPv4-mapped IPv6 unwrapped).
export const safeIp = (ip?: string | null) =>
  ip && /^[0-9a-fA-F:.]{3,45}$/.test(ip) ? ip.replace(/^::ffff:/, "") : null;
