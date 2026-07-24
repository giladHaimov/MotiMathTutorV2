import type { FastifyBaseLogger } from 'fastify';

/**
 * Structured operational logging helpers (ARCHITECTURE §14, AC-040/042).
 *
 * Important state-changing actions emit action_started / action_succeeded /
 * action_failed with safe context. Secrets, tokens, password hashes, email in
 * learning-flow logs, and hidden chunk content are never logged.
 */

/** Pino redaction paths applied at the logger level as defence in depth. */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'headers.authorization',
  'headers.cookie',
  '*.password',
  '*.password_hash',
  '*.token',
  '*.access_token',
  '*.refresh_token',
  'password',
  'token',
];

export interface ActionLogContext {
  request_id?: string;
  action_name: string;
  session_id?: string;
  attempt_id?: string;
  action_type?: string;
  error_code?: string;
  [key: string]: unknown;
}

export function actionStarted(log: FastifyBaseLogger, ctx: ActionLogContext): void {
  log.info({ event: 'action_started', ...ctx }, `${ctx.action_name} started`);
}

export function actionSucceeded(
  log: FastifyBaseLogger,
  ctx: ActionLogContext & { duration_ms: number },
): void {
  log.info({ event: 'action_succeeded', ...ctx }, `${ctx.action_name} succeeded`);
}

export function actionFailed(
  log: FastifyBaseLogger,
  ctx: ActionLogContext & { duration_ms?: number },
): void {
  log.warn({ event: 'action_failed', ...ctx }, `${ctx.action_name} failed`);
}
