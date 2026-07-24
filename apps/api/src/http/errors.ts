import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ErrorCode } from '@app/contracts';

/** Map each error code to its HTTP status. */
const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  STATE_VERSION_CONFLICT: 409,
  SESSION_COMPLETED: 409,
  ACTION_NOT_ALLOWED: 409,
  NO_CONTENT_AVAILABLE: 404,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

/** Send the standard error envelope (ARCHITECTURE §6). */
export function sendError(
  request: FastifyRequest,
  reply: FastifyReply,
  code: ErrorCode,
  message: string,
): void {
  reply.code(STATUS_BY_CODE[code]).send({
    error: { code, message, request_id: request.id },
  });
}

/** A thrown error carrying an error code, resolved by the global error handler. */
export class ApiError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
