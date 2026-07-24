import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Auth } from './auth.js';
import { toAuthHeaders } from './headers.js';
import { shouldIssueBearerToken } from './native-client.js';
import { getOrCreateProfile, type Profile } from '../modules/profile/service.js';
import { db } from '../db/index.js';
import { sendError } from '../http/errors.js';
import type { AppConfig } from '../config/index.js';

declare module 'fastify' {
  interface FastifyInstance {
    auth: Auth;
    appConfig: AppConfig;
  }
  interface FastifyRequest {
    authUser?: { id: string };
    profile?: Profile;
  }
}

/**
 * Mount Better Auth's handler at /api/auth/* (ARCHITECTURE §6). Better Auth owns
 * registration, login, logout, and session cookies (AC-001/003).
 *
 * Bearer `set-auth-token` is issued only to native Capacitor clients that send
 * `X-Client-Platform: capacitor`. Browser clients receive cookies only.
 */
export function registerAuthRoutes(app: FastifyInstance): void {
  app.route({
    method: ['GET', 'POST'],
    url: '/api/auth/*',
    async handler(request: FastifyRequest, reply: FastifyReply) {
      const auth = request.server.auth;
      const url = new URL(request.url, `${request.protocol}://${request.hostname}`);
      const headers = toAuthHeaders(request, request.server.appConfig.TRUSTED_PROXIES);
      const method = request.method.toUpperCase();
      const hasBody = method !== 'GET' && method !== 'HEAD';
      const webRequest = new Request(url, {
        method,
        headers,
        body: hasBody && request.body != null ? JSON.stringify(request.body) : undefined,
      });

      const response = await auth.handler(webRequest);
      const issueBearer = shouldIssueBearerToken(request.headers);
      reply.status(response.status);
      response.headers.forEach((value, key) => {
        const lower = key.toLowerCase();
        if (lower === 'set-auth-token') {
          if (!issueBearer) return;
          reply.header('set-auth-token', value);
          reply.header('access-control-expose-headers', 'set-auth-token');
          return;
        }
        if (lower === 'access-control-expose-headers') {
          // Drop Better Auth's expose list for browser clients; native path sets it above.
          if (!issueBearer) return;
          return;
        }
        if (lower === 'set-cookie') {
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
  const session = await request.server.auth.api.getSession({
    headers: toAuthHeaders(request, request.server.appConfig.TRUSTED_PROXIES),
  });
  if (!session?.user) {
    sendError(request, reply, 'UNAUTHORIZED', 'Authentication is required.');
    return reply;
  }
  request.authUser = { id: session.user.id };
  request.profile = await getOrCreateProfile(db, session.user.id);
}
