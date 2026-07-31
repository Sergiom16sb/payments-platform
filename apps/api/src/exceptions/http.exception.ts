/**
 * Base HTTP exception. Subclass and provide a default status + name.
 *
 * Use these instead of throwing plain Error from services/repositories —
 * the error handler (see plugins/error-handler.ts) maps anything in this
 * hierarchy to the right HTTP response shape and lets everything else
 * fall through to 500.
 *
 * Example:
 *   throw new NotFoundException(`User ${id} not found`);
 *   throw new ConflictException('Email already registered', 'EMAIL_TAKEN');
 */
export class HttpException extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(
    message: string,
    statusCode: number,
    code: string,
    details?: unknown
  ) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;

    // Restore prototype chain when transpiling to ES5 / older targets.
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toJSON(): {
    success: false;
    error: { message: string; code: string; details?: unknown };
  } {
    return {
      success: false,
      error: {
        message: this.message,
        code: this.code,
        ...(this.details !== undefined ? { details: this.details } : {}),
      },
    };
  }
}
