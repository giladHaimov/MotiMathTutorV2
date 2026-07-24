import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { getConfig, sanitizedConfig, trustProxyOption, type AppConfig } from './config/index.js';
import { REDACT_PATHS } from './logging/index.js';
import { createAuth } from './auth/auth.js';
import { registerAuthRoutes } from './auth/plugin.js';
import { errorHandler, registerRoutes } from './routes/index.js';

export interface BuildAppOptions {
  config?: AppConfig;
}

/**
 * Assemble the Fastify modular monolith: structured logging, CORS, rate
 * limiting, Better Auth routes, application routes, static SPA serving, and the
 * standard error envelope.
 */
export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config = options.config ?? getConfig();

  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    },
    // Reuse an incoming X-Request-Id or generate one; used in every error envelope.
    genReqId: (req) => (req.headers['x-request-id'] as string) ?? crypto.randomUUID(),
    // Safe default: false. Only the explicit TRUSTED_PROXIES list is trusted —
    // never blank-trust-all (spoofable X-Forwarded-For).
    trustProxy: trustProxyOption(config),
    bodyLimit: 256 * 1024,
  });

  app.decorate('auth', createAuth(config));

  // CORS with credentials so the Better Auth cookie session works cross-origin in dev.
  await app.register(cors, {
    origin: config.TRUSTED_ORIGINS.length > 0 ? config.TRUSTED_ORIGINS : false,
    credentials: true,
  });

  // Rate limiting on the whole surface; auth + action submission are the sensitive ones.
  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
  });

  app.setErrorHandler(errorHandler);

  registerAuthRoutes(app);
  registerRoutes(app);

  await registerStatic(app, config);

  app.log.info({ config: sanitizedConfig(config) }, 'configuration loaded');
  return app;
}

/** Serve the built SPA in production; API routes always take precedence. */
async function registerStatic(app: FastifyInstance, config: AppConfig): Promise<void> {
  const webRoot =
    process.env.WEB_ROOT ??
    join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'dist');

  if (!existsSync(join(webRoot, 'index.html'))) {
    if (config.NODE_ENV === 'production') {
      app.log.warn({ webRoot }, 'web build not found; SPA will not be served');
    }
    return;
  }

  await app.register(fastifyStatic, { root: webRoot, wildcard: false });

  // SPA fallback for non-API GET routes.
  app.setNotFoundHandler((request, reply) => {
    if (request.method === 'GET' && !request.url.startsWith('/api') && request.url !== '/health') {
      return reply.sendFile('index.html');
    }
    return reply.code(404).send({
      error: { code: 'NOT_FOUND', message: 'Not found.', request_id: request.id },
    });
  });
}
