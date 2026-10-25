import nodemailer from "nodemailer";
import { config } from "../../core/config/index.js";

export type SendEmailInput = {
  to: string;
  subject: string;
  html?: string;
  text?: string;
};

let transporter: nodemailer.Transporter | null = null;

function getTransporter() {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    auth: {
      user: config.SMTP_USER,
      pass: config.SMTP_PASS,
    },
  });
  return transporter;
}

export async function sendEmail(input: SendEmailInput) {
  const tr = getTransporter();
  await tr.sendMail({
    from: config.SMTP_FROM,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
  });
}
