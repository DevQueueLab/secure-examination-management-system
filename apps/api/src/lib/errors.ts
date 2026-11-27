import { ERROR_CODES } from '@athena/shared';

/** Base class for expected, user-facing failures. Anything else is a 500. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Some fields need attention', fields?: Record<string, string>) {
    super(422, ERROR_CODES.VALIDATION, message, fields);
  }
}
export class UnauthenticatedError extends AppError {
  constructor(message = 'Please sign in to continue') {
    super(401, ERROR_CODES.UNAUTHENTICATED, message);
  }
}
export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to do that') {
    super(403, ERROR_CODES.FORBIDDEN, message);
  }
}
export class NotFoundError extends AppError {
  constructor(what = 'Resource') {
    super(404, ERROR_CODES.NOT_FOUND, `${what} not found`);
  }
}
export class ConflictError extends AppError {
  constructor(message: string, code: string = ERROR_CODES.CONFLICT) {
    super(409, code, message);
  }
}
