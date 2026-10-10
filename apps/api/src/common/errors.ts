import { HttpException, HttpStatus } from '@nestjs/common';

/** Domain error with a stable machine-readable code clients can switch on. */
export class DomainError extends HttpException {
  constructor(
    public readonly code: string,
    message: string,
    status: HttpStatus = HttpStatus.UNPROCESSABLE_ENTITY,
    details?: unknown,
  ) {
    super({ code, message, details }, status);
  }
}

export const Conflict = (code: string, message: string) => new DomainError(code, message, HttpStatus.CONFLICT);
export const NotFound = (what: string) => new DomainError('NOT_FOUND', `${what} not found`, HttpStatus.NOT_FOUND);
export const Forbidden = (code: string, message: string) => new DomainError(code, message, HttpStatus.FORBIDDEN);
