import type { RequestHandler } from "express";

import { requirePermission } from "../../../../core/middleware/requirePermission.js";
import { Permissions } from "../../../../core/authz/permissions.js";
import { monnifyValidateDisbursementOtp, monnifyResendDisbursementOtp } from "../../../monnify/client/monnify.client.js";
import { insertAuditLog } from "../../../audit/repository/audit.repository.js";
import { ValidationError } from "../../../../core/errors/ValidationError.js";

export const validatePayoutOtpHandler: RequestHandler = async (req, res, next) => {
  try {
    const reference = String(req.body?.reference || "");
    const authorizationCode = String(req.body?.otp || req.body?.authorizationCode || "");
    if (!reference || !authorizationCode) throw new ValidationError("reference and otp are required");

    const resp = await monnifyValidateDisbursementOtp({ reference, authorizationCode });

    await insertAuditLog({
      actorAdminId: req.user?.id ?? null,
      actorRole: (req as any).admin?.role ?? null,
      action: "ADMIN_PAYOUT_OTP_VALIDATE",
      targetType: "payout",
      targetId: reference,
      ip: req.ip,
      userAgent: req.headers["user-agent"] as string | undefined,
      success: true,
      requestId: (req as any).id,
    });

    res.status(200).json({ success: true, provider: { status: (resp as any)?.responseBody?.status ?? null } });
  } catch (err) {
    next(err);
  }
};

export const resendPayoutOtpHandler: RequestHandler = async (req, res, next) => {
  try {
    const reference = String(req.body?.reference || "");
    if (!reference) throw new ValidationError("reference is required");

    const resp = await monnifyResendDisbursementOtp({ reference });

    await insertAuditLog({
      actorAdminId: req.user?.id ?? null,
      actorRole: (req as any).admin?.role ?? null,
      action: "ADMIN_PAYOUT_OTP_RESEND",
      targetType: "payout",
      targetId: reference,
      ip: req.ip,
      userAgent: req.headers["user-agent"] as string | undefined,
      success: true,
      requestId: (req as any).id,
    });

    res.status(200).json({ success: true, provider: { status: (resp as any)?.responseBody?.status ?? null } });
  } catch (err) {
    next(err);
  }
};
