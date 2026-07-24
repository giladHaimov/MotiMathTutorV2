import type { FastifyRequest } from 'fastify';

/** Convert Fastify incoming headers to a web `Headers` object for Better Auth. */
export function toWebHeaders(request: FastifyRequest): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    headers.append(key, Array.isArray(value) ? value.join(',') : String(value));
  }
  return headers;
}
