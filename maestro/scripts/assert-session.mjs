#!/usr/bin/env node

import console from 'node:console';
import process from 'node:process';
import { URL } from 'node:url';

function fail(message) {
  console.error(`assert-session: ${message}`);
  process.exit(1);
}

function readArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key?.startsWith('--')) fail(`unexpected argument: ${key}`);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) fail(`missing value for ${key}`);
    result[key.slice(2)] = value;
    i += 1;
  }
  return result;
}

export function normalizeApiBase(raw) {
  if (!raw) fail('API_BASE (or --api-base) is required');
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol)) fail('API base must use HTTP(S)');
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    fail('API base must be an origin without credentials, path, query, or fragment');
  }
  return url.origin;
}

function setCookies(cookieJar, response) {
  const headers =
    typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie')].filter(Boolean);
  for (const header of headers) {
    const pair = header.split(';', 1)[0];
    const separator = pair.indexOf('=');
    if (separator > 0) cookieJar.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
}

function cookieHeader(cookieJar) {
  return [...cookieJar].map(([name, value]) => `${name}=${value}`).join('; ');
}

export function createApi(apiBase) {
  const cookieJar = new Map();

  async function request(path, init = {}, expected = [200]) {
    const headers = { 'content-type': 'application/json', ...init.headers };
    const cookies = cookieHeader(cookieJar);
    if (cookies) headers.cookie = cookies;
    let response;
    try {
      response = await globalThis.fetch(`${apiBase}${path}`, {
        ...init,
        headers,
        redirect: 'manual',
      });
    } catch (error) {
      fail(`network error calling ${path}: ${error instanceof Error ? error.message : error}`);
    }
    setCookies(cookieJar, response);
    const text = await response.text();
    let body = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        fail(`${path} returned non-JSON (${response.status})`);
      }
    }
    if (!expected.includes(response.status)) {
      fail(`${path} returned ${response.status}: ${text.slice(0, 300)}`);
    }
    return { status: response.status, body };
  }

  return { request, cookieJar };
}

export async function signIn(api, email, password) {
  if (!email || !password) fail('test email and password are required');
  await api.request(
    '/api/auth/sign-in/email',
    { method: 'POST', body: JSON.stringify({ email, password }) },
    [200],
  );
  if (api.cookieJar.size === 0) fail('Better Auth sign-in returned no session cookie');
  await api.request('/api/me', {}, [200]);
}

export async function getActiveSession(api) {
  const dashboard = (await api.request('/api/dashboard')).body;
  const sessionId = dashboard?.active_session?.session_id;
  if (!sessionId) fail('dashboard has no active session');
  const session = (await api.request(`/api/sessions/${sessionId}`)).body;
  return session;
}

function parseExpectedCompletedSteps(raw) {
  if (!raw) return [];
  return raw.split(',').map((entry) => {
    const separator = entry.indexOf('=');
    if (separator < 1) fail(`invalid completed-step expectation: ${entry}`);
    return [entry.slice(0, separator), entry.slice(separator + 1)];
  });
}

async function main() {
  const args = readArgs(process.argv.slice(2));
  const apiBase = normalizeApiBase(
    args['api-base'] ?? process.env.HOST_API_BASE ?? process.env.API_BASE,
  );
  const api = createApi(apiBase);

  if (args.mode === 'probe') {
    await api.request('/health', {}, [200]);
    await api.request('/api/me', {}, [401]);
    console.log(
      `assert-session: backend reachable at ${apiBase}; anonymous auth probe returned 401`,
    );
    return;
  }

  await signIn(
    api,
    args.email ?? process.env.TEST_EMAIL,
    args.password ?? process.env.TEST_PASSWORD,
  );
  const session = await getActiveSession(api);

  if (
    args['state-version'] !== undefined &&
    session.state_version !== Number(args['state-version'])
  ) {
    fail(`state_version ${session.state_version}, expected ${args['state-version']}`);
  }
  if (
    args['visible-count'] !== undefined &&
    session.visible_chunks?.length !== Number(args['visible-count'])
  ) {
    fail(
      `visible chunk count ${session.visible_chunks?.length}, expected ${args['visible-count']}`,
    );
  }
  for (const [slot, expectedLabel] of parseExpectedCompletedSteps(args.workspace)) {
    const actual = session.completed_steps?.find(
      (candidate) => candidate.correct_slot === slot,
    )?.label;
    if (actual !== expectedLabel)
      fail(`completed step ${slot}=${String(actual)}, expected ${expectedLabel}`);
  }
  if (
    args['required-action'] !== undefined &&
    session.required_next_action?.action_type !== args['required-action']
  ) {
    fail(
      `required action ${String(session.required_next_action?.action_type)}, expected ${args['required-action']}`,
    );
  }

  console.log(
    `assert-session: valid server session ${session.session_id}; state_version=${session.state_version}; visible_chunks=${session.visible_chunks.length}`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
