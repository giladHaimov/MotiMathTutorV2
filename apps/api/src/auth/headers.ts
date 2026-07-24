import type { FastifyRequest } from 'fastify';
import { isAddressInTrustedProxies, normalizeIp } from '../config/index.js';

/** Convert Fastify incoming headers to a web `Headers` object for Better Auth. */
export function toWebHeaders(request: FastifyRequest): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    headers.append(key, Array.isArray(value) ? value.join(',') : String(value));
  }
  return headers;
}

/**
 * Headers for Better Auth with explicit-proxy enforcement.
 *
 * X-Forwarded-For is honored only when the TCP peer is in `trustedProxies`.
 * An untrusted peer cannot spoof rate-limit identity via XFF — the header is
 * replaced with the real peer address so spoofed values share that peer's bucket.
 */
export function toAuthHeaders(request: FastifyRequest, trustedProxies: string[]): Headers {
  const headers = toWebHeaders(request);
  const peer = normalizeIp(request.socket.remoteAddress ?? request.raw.socket.remoteAddress);

  if (trustedProxies.length === 0 || !peer || !isAddressInTrustedProxies(peer, trustedProxies)) {
    headers.delete('x-forwarded-for');
    if (peer) {
      headers.set('x-forwarded-for', peer);
    }
  }

  return headers;
}
