export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(
    message: string,
    options: { statusCode: number; code: string; details?: unknown },
  ) {
    super(message);
    this.name = "AppError";
    this.statusCode = options.statusCode;
    this.code = options.code;
    this.details = options.details;
  }
}

export class BvnVerificationRequiredError extends AppError {
  constructor(message = "BVN verification is required") {
    super(message, { statusCode: 403, code: "BVN_VERIFICATION_REQUIRED" });
    this.name = "BvnVerificationRequiredError";
  }
}

export class NinVerificationRequiredError extends AppError {
  constructor(message = "NIN verification is required") {
    super(message, { statusCode: 403, code: "NIN_VERIFICATION_REQUIRED" });
    this.name = "NinVerificationRequiredError";
  }
}

export class InvalidTransactionPinError extends AppError {
  constructor(message = "Incorrect transaction PIN") {
    // 403 (not 401) so API clients don't treat this as an expired-token
    // response and retry — a retry would double-count failed PIN attempts.
    super(message, { statusCode: 403, code: "INVALID_TRANSACTION_PIN" });
    this.name = "InvalidTransactionPinError";
  }
}

export class TooManyTransactionsError extends AppError {
  constructor(
    message = "Too many transactions. Please wait before trying again.",
  ) {
    super(message, { statusCode: 429, code: "TOO_MANY_TRANSACTIONS" });
    this.name = "TooManyTransactionsError";
  }
}

export class TransactionPinNotSetError extends AppError {
  constructor(message = "Set your transaction PIN before making payments") {
    super(message, { statusCode: 403, code: "TRANSACTION_PIN_NOT_SET" });
    this.name = "TransactionPinNotSetError";
  }
}

export class TransactionPinAlreadySetError extends AppError {
  constructor(message = "You already have a transaction PIN. Change or reset it instead.") {
    super(message, { statusCode: 409, code: "TRANSACTION_PIN_ALREADY_SET" });
    this.name = "TransactionPinAlreadySetError";
  }
}

export class TransactionPinLockedError extends AppError {
  constructor(lockedUntil: Date, message = "Too many wrong PIN attempts. Try again later or reset your PIN.") {
    // 429 (not 401): a locked PIN is not an expired session.
    super(message, { statusCode: 429, code: "TRANSACTION_PIN_LOCKED", details: { lockedUntil: lockedUntil.toISOString() } });
    this.name = "TransactionPinLockedError";
  }
}

// The mobile app tells these apart from an expired session (plain UNAUTHORIZED),
// which must sign the user out; a wrong passcode must not.
export class InvalidPasscodeError extends AppError {
  constructor(message = "Invalid credentials") {
    super(message, { statusCode: 401, code: "INVALID_PASSCODE" });
    this.name = "InvalidPasscodeError";
  }
}

export class PasscodeLockedError extends AppError {
  constructor(lockedUntil: Date, message = "Too many wrong passcode attempts. Try again later.") {
    super(message, { statusCode: 429, code: "PASSCODE_LOCKED", details: { lockedUntil: lockedUntil.toISOString() } });
    this.name = "PasscodeLockedError";
  }
}

export class InvalidCodeError extends AppError {
  constructor(message = "That code is invalid or has expired") {
    super(message, { statusCode: 400, code: "INVALID_CODE" });
    this.name = "InvalidCodeError";
  }
}

export class AccountInactiveError extends AppError {
  constructor(message = "This account has been suspended. Contact support for help.") {
    super(message, { statusCode: 403, code: "ACCOUNT_INACTIVE" });
    this.name = "AccountInactiveError";
  }
}

export class InsufficientBalanceError extends AppError {
  constructor(message = "Insufficient balance") {
    super(message, { statusCode: 400, code: "INSUFFICIENT_BALANCE" });
    this.name = "InsufficientBalanceError";
  }
}

export class LimitExceededError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, { statusCode: 403, code: "LIMIT_EXCEEDED", details });
    this.name = "LimitExceededError";
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = "This service is not available yet. Please try again later.") {
    super(message, { statusCode: 503, code: "SERVICE_UNAVAILABLE" });
    this.name = "ServiceUnavailableError";
  }
}
