#!/usr/bin/env node

import console from 'node:console';
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { createApi, getActiveSession, normalizeApiBase, signIn } from './assert-session.mjs';

function fail(message) {
  console.error(`prepare-final-answer: ${message}`);
  process.exit(1);
}

const apiBase = normalizeApiBase(process.env.HOST_API_BASE ?? process.env.API_BASE);
const email = process.env.TEST_EMAIL;
const password = process.env.TEST_PASSWORD;
if (!email || !password) fail('TEST_EMAIL and TEST_PASSWORD are required');

const api = createApi(apiBase);

async function registerOrLogin() {
  const registration = await api.request(
    '/api/auth/sign-up/email',
    {
      method: 'POST',
      body: JSON.stringify({
        email,
        password,
        name: process.env.TEST_NAME ?? 'Maestro lifecycle',
      }),
    },
    [200, 400, 422],
  );
  if (registration.status !== 200) await signIn(api, email, password);
  else await api.request('/api/me');
}

async function submit(session, actionType, payload) {
  return (
    await api.request(`/api/sessions/${session.session_id}/actions`, {
      method: 'POST',
      body: JSON.stringify({
        client_action_id: randomUUID(),
        expected_state_version: session.state_version,
        action_type: actionType,
        payload,
      }),
    })
  ).body;
}

await registerOrLogin();
const dashboard = (await api.request('/api/dashboard')).body;
let session = dashboard?.active_session?.session_id
  ? await getActiveSession(api)
  : (await api.request('/api/sessions', { method: 'POST', body: '{}' }, [201])).body;

const assignments = new Map(
  session.workspace.slots.filter((slot) => slot.token_id).map((slot) => [slot.slot, slot.token_id]),
);

if (!assignments.has('WHOLE')) {
  session = await submit(session, 'ASSIGN_SLOT', { slot: 'WHOLE', token_id: 'ex01-c0-whole' });
}
if (session.visible_chunks.length < 2) {
  session = await submit(session, 'SUBMIT_COMMITMENT', {});
}
if (!session.workspace.slots.some((slot) => slot.slot === 'PART_IN_PERCENTAGE' && slot.token_id)) {
  session = await submit(session, 'ASSIGN_SLOT', {
    slot: 'PART_IN_PERCENTAGE',
    token_id: 'ex01-c1-percent',
  });
}
if (session.visible_chunks.length < 3) {
  session = await submit(session, 'SUBMIT_COMMITMENT', {});
}
if (!session.workspace.slots.some((slot) => slot.slot === 'UNKNOWN' && slot.token_id)) {
  session = await submit(session, 'ASSIGN_SLOT', {
    slot: 'UNKNOWN',
    token_id: 'ex01-c2-unknown',
  });
}

if (session.status !== 'ACTIVE') fail(`session is ${session.status}, expected ACTIVE`);
if (!session.allowed_actions.includes('SUBMIT_FINAL_ANSWER')) {
  fail('real API did not advance the session to SUBMIT_FINAL_ANSWER');
}
console.log(
  `prepare-final-answer: prepared ${session.session_id} at state_version=${session.state_version}`,
);
