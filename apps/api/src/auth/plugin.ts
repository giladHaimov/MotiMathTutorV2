import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Auth } from './auth.js';
import { toAuthHeaders } from './headers.js';
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
 * Cookie sessions only — headers are forwarded as returned by Better Auth.
 */
export function registerAuthRoutes(app: FastifyInstance): void {
  app.route({
    method: ['GET', 'POST'],
    url: '/api/auth/*',
    async handler(request: FastifyRequest, reply: FastifyReply) {
      const auth = request.server.auth;
      const incomingUrl = new URL(request.url, 'http://internal.invalid');
      const url = new URL(request.server.appConfig.BETTER_AUTH_URL);
      url.pathname = incomingUrl.pathname;
      url.search = incomingUrl.search;
      url.hash = '';
      const headers = toAuthHeaders(request, request.server.appConfig.TRUSTED_PROXIES);
      const method = request.method.toUpperCase();
      const hasBody = method !== 'GET' && method !== 'HEAD';
      const webRequest = new Request(url, {
        method,
        headers,
        body: hasBody && request.body != null ? JSON.stringify(request.body) : undefined,
      });

      const response = await auth.handler(webRequest);
      reply.status(response.status);
      const cookies = response.headers.getSetCookie();
      if (cookies.length > 0) {
        reply.header('set-cookie', cookies);
      }
      response.headers.forEach((value, key) => {
        const lower = key.toLowerCase();
        if (lower === 'set-cookie') return;
        reply.header(key, value);
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
  const profile = await getOrCreateProfile(db, session.user.id);
  if (profile.status !== 'ACTIVE') {
    sendError(request, reply, 'FORBIDDEN', 'This profile is not active.');
    return reply;
  }
  request.profile = profile;
}
