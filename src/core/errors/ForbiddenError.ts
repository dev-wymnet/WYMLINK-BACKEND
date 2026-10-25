import { AppError } from "./AppError.js";

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden") {
    super(message, { statusCode: 403, code: "FORBIDDEN" });
    this.name = "ForbiddenError";
  }
}
