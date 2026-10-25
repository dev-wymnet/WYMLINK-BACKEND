import { AppError } from './AppError.js';

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized', details?: unknown) {
    super(message, { statusCode: 401, code: 'UNAUTHORIZED', details });
    this.name = 'UnauthorizedError';
  }
}
