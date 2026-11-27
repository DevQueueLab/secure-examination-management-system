import { ERROR_CODES } from '@athena/shared';
import { AppError } from '../../lib/errors';

/** The exam cannot be started right now (before the window, after it, late entry over, archived). */
export class ExamNotAvailableError extends AppError {
  constructor(message: string) {
    super(403, ERROR_CODES.EXAM_NOT_AVAILABLE, message);
  }
}

/** The attempt no longer accepts this action (already submitted, or the server deadline passed). */
export class AttemptClosedError extends AppError {
  constructor(message = 'This attempt has already been submitted') {
    super(409, ERROR_CODES.ATTEMPT_CLOSED, message);
  }
}

/** Another device or tab owns the attempt (single active device). The client may offer to take it over. */
export class SessionTakenOverError extends AppError {
  constructor() {
    super(
      409,
      ERROR_CODES.SESSION_TAKEN_OVER,
      'This attempt is open on another device or tab. Continue here to take it over.',
    );
  }
}
