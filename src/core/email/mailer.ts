import nodemailer, { type Transporter } from "nodemailer";

import { config } from "../../core/config/index.js";
import { logger } from "../logger/logger.js";

export type SendEmailInput = {
  to: string;
  subject: string;
  html?: string;
  text?: string;
};

// Two ways out. With MAIL_RELAY_URL set, emails go over HTTPS to the Wymlink Mail service
// (its own Vercel project), because Render blocks outgoing SMTP ports. Otherwise they go
// straight to the SMTP server: TLS-on-connect follows SMTP_SECURE when it is set, otherwise
// the port (465 = TLS, 587 = STARTTLS): "secure" on port 587 fails with most servers.
const relayUrl = process.env.MAIL_RELAY_URL?.trim() ?? "";
const relaySecret = process.env.MAIL_RELAY_SECRET?.trim() ?? "";
const viaRelay = Boolean(relayUrl && relaySecret);
const configured = viaRelay || Boolean(config.SMTP_HOST && config.SMTP_FROM);
const secure = process.env.SMTP_SECURE ? config.SMTP_SECURE : config.SMTP_PORT === 465;

async function sendViaRelay(input: SendEmailInput) {
  const res = await fetch(relayUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${relaySecret}` },
    body: JSON.stringify({ to: input.to, subject: input.subject, text: input.text, html: input.html }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
    throw new Error(`Mail relay refused the email (${res.status}${body?.code ? ` ${body.code}` : ""}${body?.error ? `: ${body.error}` : ""})`);
  }
}

let transporter: Transporter | null = null;

function getTransporter() {
  transporter ??= nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure,
    auth: config.SMTP_USER && config.SMTP_PASS ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
  });
  return transporter;
}

// Throws when the mail can't be sent, so callers decide what that means.
export async function sendEmail(input: SendEmailInput) {
  if (!configured) {
    logger.warn({ subject: input.subject }, "email_send_skipped_missing_smtp_config");
    throw new Error("Email is not configured");
  }
  if (viaRelay) await sendViaRelay(input);
  else await getTransporter().sendMail({ from: config.SMTP_FROM, to: input.to, subject: input.subject, text: input.text, html: input.html });
  logger.info({ subject: input.subject, via: viaRelay ? "relay" : "smtp" }, "email_sent");
}

// Escapes text placed inside an HTML email (names and other user input).
export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
