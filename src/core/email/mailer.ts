import nodemailer, { type Transporter } from "nodemailer";

import { config } from "../../core/config/index.js";
import { logger } from "../logger/logger.js";

export type SendEmailInput = {
  to: string;
  subject: string;
  html?: string;
  text?: string;
};

// The one SMTP sender. TLS-on-connect follows SMTP_SECURE when it is set, otherwise
// the port (465 = TLS, 587 = STARTTLS): "secure" on port 587 fails with most servers.
const configured = Boolean(config.SMTP_HOST && config.SMTP_FROM);
const secure = process.env.SMTP_SECURE ? config.SMTP_SECURE : config.SMTP_PORT === 465;

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
  await getTransporter().sendMail({ from: config.SMTP_FROM, to: input.to, subject: input.subject, text: input.text, html: input.html });
  logger.info({ subject: input.subject }, "email_sent");
}

// Escapes text placed inside an HTML email (names and other user input).
export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
