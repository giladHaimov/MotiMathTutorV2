import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { actionRequestSchema } from '@app/contracts';
import { z } from 'zod';
import { db } from '../db/index.js';
import { learningSessions } from '../db/schema/product.js';
import { getConfig } from '../config/index.js';
import { requireAuth } from '../auth/plugin.js';
import { ApiError, sendError } from '../http/errors.js';
import { actionFailed, actionStarted, actionSucceeded } from '../logging/index.js';
import { getSession, startSession, submitAction } from '../modules/sessions/service.js';
import { pickNextProblem } from '../modules/sessions/repo.js';

const sessionParamsSchema = z.object({ sessionId: z.string().uuid() });

export function registerRoutes(app: FastifyInstance): void {
  // Public liveness/readiness (ARCHITECTURE §6). Unhealthy until DB is reachable (AC-055).
  app.get('/health', async (_request, reply) => {
    try {
      await db.execute('select 1');
      return reply.code(200).send({ status: 'ok' });
    } catch {
      return reply.code(503).send({ status: 'unavailable' });
    }
  });

  app.register(async (protectedRoutes) => {
    protectedRoutes.addHook('preHandler', requireAuth);

    // Pseudonymous profile summary — never the email (PB-032).
    protectedRoutes.get('/api/me', async (request, reply) => {
      const p = request.profile!;
      return reply.send({ analytics_subject_id: p.analyticsSubjectId, status: p.status });
    });

    protectedRoutes.get('/api/dashboard', async (request, reply) => {
      const subjectId = request.profile!.analyticsSubjectId;
      const active = await db
        .select({ id: learningSessions.id, status: learningSessions.status })
        .from(learningSessions)
        .where(
          and(
            eq(learningSessions.analyticsSubjectId, subjectId),
            eq(learningSessions.status, 'ACTIVE'),
          ),
        )
        .orderBy(desc(learningSessions.updatedAt))
        .limit(1);
      const next = await pickNextProblem(db, subjectId);
      return reply.send({
        active_session: active[0] ? { session_id: active[0].id, status: active[0].status } : null,
        next_problem_available: next !== null,
      });
    });

    // Start (or resume) the next deterministic problem (J-02).
    protectedRoutes.post('/api/sessions', async (request, reply) => {
      const session = await startSession(db, request.profile!, getConfig().ENGINE_VERSION);
      return reply.code(201).send(session);
    });

    // Resume an authorized session (J-03).
    protectedRoutes.get('/api/sessions/:sessionId', async (request, reply) => {
      const params = sessionParamsSchema.safeParse(request.params);
      if (!params.success) {
        return sendError(request, reply, 'VALIDATION_ERROR', 'Invalid session id.');
      }
      const session = await getSession(db, request.profile!, params.data.sessionId);
      return reply.send(session);
    });

    // Submit one structured action (J-04) with lifecycle logging.
    protectedRoutes.post('/api/sessions/:sessionId/actions', async (request, reply) => {
      const params = sessionParamsSchema.safeParse(request.params);
      if (!params.success) {
        return sendError(request, reply, 'VALIDATION_ERROR', 'Invalid session id.');
      }
      const body = actionRequestSchema.safeParse(request.body);
      if (!body.success) {
        // Malformed action payload — rejected with no state change (AC-016).
        return sendError(request, reply, 'VALIDATION_ERROR', 'Invalid action payload.');
      }

      const sessionId = params.data.sessionId;
      const started = Date.now();
      const logCtx = {
        request_id: request.id,
        action_name: 'submit_action',
        session_id: sessionId,
        action_type: body.data.action_type,
      };
      actionStarted(request.log, logCtx);

      try {
        const outcome = await submitAction(db, request.profile!, sessionId, body.data);
        actionSucceeded(request.log, { ...logCtx, duration_ms: Date.now() - started });
        if (outcome.kind === 'CONFLICT') {
          return reply.code(409).send({
            error: {
              code: 'STATE_VERSION_CONFLICT',
              message: outcome.current.message ?? 'The session changed.',
              request_id: request.id,
            },
            current_state: outcome.current,
          });
        }
        return reply.code(200).send(outcome.session);
      } catch (err) {
        const code = err instanceof ApiError ? err.code : 'INTERNAL_ERROR';
        actionFailed(request.log, {
          ...logCtx,
          duration_ms: Date.now() - started,
          error_code: code,
        });
        throw err;
      }
    });
  });
}

/** Global error handler mapping ApiError / validation into the standard envelope. */
export function errorHandler(err: unknown, request: FastifyRequest, reply: FastifyReply): void {
  if (err instanceof ApiError) {
    sendError(request, reply, err.code, err.message);
    return;
  }
  const anyErr = err as { statusCode?: number; message?: string };
  if (anyErr.statusCode === 429) {
    sendError(request, reply, 'RATE_LIMITED', 'Too many requests.');
    return;
  }
  request.log.error({ err }, 'unhandled error');
  sendError(request, reply, 'INTERNAL_ERROR', 'An unexpected error occurred.');
}
