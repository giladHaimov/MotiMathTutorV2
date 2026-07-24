import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { auth } from './auth.js';
import { toWebHeaders } from './headers.js';
import { getOrCreateProfile, type Profile } from '../modules/profile/service.js';
import { db } from '../db/index.js';
import { sendError } from '../http/errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    authUser?: { id: string };
    profile?: Profile;
  }
}

/**
 * Mount Better Auth's handler at /api/auth/* (ARCHITECTURE §6). Better Auth owns
 * registration, login, logout, and session cookies (AC-001/003).
 */
export function registerAuthRoutes(app: FastifyInstance): void {
  app.route({
    method: ['GET', 'POST'],
    url: '/api/auth/*',
    // Better Auth needs the raw request; disable Fastify's rate limit here is not
    // needed — auth rate limiting is applied globally where configured.
    async handler(request: FastifyRequest, reply: FastifyReply) {
      const url = new URL(request.url, `${request.protocol}://${request.hostname}`);
      const headers = toWebHeaders(request);
      const method = request.method.toUpperCase();
      const hasBody = method !== 'GET' && method !== 'HEAD';
      const webRequest = new Request(url, {
        method,
        headers,
        body: hasBody && request.body != null ? JSON.stringify(request.body) : undefined,
      });

      const response = await auth.handler(webRequest);
      reply.status(response.status);
      response.headers.forEach((value, key) => {
        // Preserve multiple Set-Cookie headers.
        if (key.toLowerCase() === 'set-cookie') {
          reply.header('set-cookie', value);
        } else {
          reply.header(key, value);
        }
      });
      const body = await response.text();
      reply.send(body.length > 0 ? body : null);
    },
  });
}

/**
 * preHandler enforcing real, server-validated authentication (PB-022/025).
 * Rejects anonymous access to protected routes (AC-002) and resolves the
 * pseudonymous profile used for ownership checks.
 */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const session = await auth.api.getSession({ headers: toWebHeaders(request) });
  if (!session?.user) {
    sendError(request, reply, 'UNAUTHORIZED', 'Authentication is required.');
    return reply;
  }
  request.authUser = { id: session.user.id };
  request.profile = await getOrCreateProfile(db, session.user.id);
}
