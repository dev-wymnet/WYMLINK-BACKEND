import nodemailer from "nodemailer";

import { logger } from "../logger/logger.js";

export interface SendEmailInput {
  to: string;
  subject: string;
  text?: string;
  html?: string;
}

const smtpHost = process.env.SMTP_HOST;
const smtpPort = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587;
const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASS;
const smtpFrom = process.env.SMTP_FROM;

const canSendEmail = Boolean(smtpHost && smtpFrom);

const transporter = canSendEmail
  ? nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth:
        smtpUser && smtpPass
          ? {
              user: smtpUser,
              pass: smtpPass,
            }
          : undefined,
    })
  : null;

export async function sendEmail(input: SendEmailInput): Promise<void> {
  if (!canSendEmail || !transporter) {
    logger.warn(
      {
        to: input.to,
        subject: input.subject,
      },
      "email_send_skipped_missing_smtp_config",
    );
    return;
  }

  try {
    await transporter.sendMail({
      from: smtpFrom,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    });

    logger.info({ to: input.to, subject: input.subject }, "email_sent");
  } catch (err) {
    logger.error(
      { err, to: input.to, subject: input.subject },
      "email_send_failed",
    );
  }
}
