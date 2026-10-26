import type { RequestHandler } from "express";

import { ValidationError } from "../../../core/errors/ValidationError.js";
import { sendEmail } from "../../../core/email/email.service.js";
import { escapeHtml } from "../../../core/email/mailer.js";
import {
  createTrainingRegistration,
  findTrainingRegistrationByEmailOrPhone,
  listTrainingRegistrations,
} from "../repository/training.repository.js";

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
// Nigerian phone: +234XXXXXXXXXX or 0XXXXXXXXXX (11 digits)
const nigerianPhoneRegex = /^(?:\+234|0)\d{10}$/;

export const registerTrainingHandler: RequestHandler = async (
  req,
  res,
  next,
) => {
  try {
    const { fullName, email, phone } = (req.body as any) ?? {};

    if (
      !fullName ||
      typeof fullName !== "string" ||
      fullName.trim().length < 3 ||
      fullName.trim().length > 100
    ) {
      throw new ValidationError(
        "Enter your full name (3 to 100 characters)",
      );
    }

    if (!email || typeof email !== "string" || !emailRegex.test(email)) {
      throw new ValidationError("A valid email address is required");
    }

    if (
      !phone ||
      typeof phone !== "string" ||
      !nigerianPhoneRegex.test(phone)
    ) {
      throw new ValidationError("A valid Nigerian phone number is required");
    }

    const normalizedEmail = email.toLowerCase();

    const existing = await findTrainingRegistrationByEmailOrPhone({
      email: normalizedEmail,
      phone,
    });
    if (existing) {
      throw new ValidationError(
        "A registration with this email or phone already exists",
      );
    }

    const registration = await createTrainingRegistration({
      fullName: fullName.trim(),
      email: normalizedEmail,
      phone,
    });

    // Fire-and-forget confirmation email
    void sendEmail({
      to: normalizedEmail,
      subject: "AI Workflow Automation Training - Registration Confirmed",
      text:
        `Hi ${fullName.trim()},\n\n` +
        `Your registration for the AI Workflow Automation training has been received.\n` +
        `Date: 5 – 12 September\n` +
        `Location: Novare Mall, Wuse, Abuja (Hybrid - Physical + Online)\n` +
        `Fee: ₦50,000 (Moniepoint, Account: 5156085485, Wymnet Data Solutions).\n\n` +
        `Next step: Please take a screenshot of your registration confirmation page together with your payment receipt and send both to the Wymnet support team for payment confirmation.\n\n` +
        `Thank you,\nWymnet Team`,
      html:
        `<p>Hi ${escapeHtml(fullName.trim())},</p>` +
        `<p>Your registration for the <strong>AI Workflow Automation</strong> training has been received.</p>` +
        `<p><strong>Date:</strong> 5 – 12 September<br/>` +
        `<strong>Location:</strong> Novare Mall, Wuse, Abuja (Hybrid - Physical + Online)<br/>` +
        `<strong>Fee:</strong> ₦50,000 (Moniepoint, Account: 5156085485, Wymnet Data Solutions)</p>` +
        `<p><strong>Next step:</strong> Please take a screenshot of your registration confirmation page together with your payment receipt and send both to the Wymnet support team for payment confirmation.</p>` +
        `<p>Thank you,<br/>Wymnet Team</p>`,
    });

    res.status(201).json({ registration });
  } catch (err) {
    next(err);
  }
};

export const listTrainingRegistrationsHandler: RequestHandler = async (
  _req,
  res,
  next,
) => {
  try {
    const registrations = await listTrainingRegistrations();
    res.status(200).json({ registrations });
  } catch (err) {
    next(err);
  }
};
