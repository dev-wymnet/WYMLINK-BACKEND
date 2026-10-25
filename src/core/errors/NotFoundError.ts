import { AppError } from './AppError.js';

export class NotFoundError extends AppError {
  constructor(message = 'Not found', details?: unknown) {
    super(message, { statusCode: 404, code: 'NOT_FOUND', details });
    this.name = 'NotFoundError';
  }
}
