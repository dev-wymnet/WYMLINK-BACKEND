import { logger } from "../logger/logger.js";
import { sendEmail as send, type SendEmailInput } from "./mailer.js";

export type { SendEmailInput };

// Best-effort email (e.g. confirmations): failures are logged, never thrown.
export async function sendEmail(input: SendEmailInput): Promise<void> {
  try {
    await send(input);
  } catch (err) {
    logger.error({ err: (err as Error).message, subject: input.subject }, "email_send_failed");
  }
}
