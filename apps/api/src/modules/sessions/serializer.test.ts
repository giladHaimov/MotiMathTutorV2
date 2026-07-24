import { describe, expect, it } from 'vitest';
import { buildPublicSession, type SerializeInput } from './serializer.js';

const baseInput: SerializeInput = {
  sessionId: '11111111-1111-1111-1111-111111111111',
  stateVersion: 0,
  status: 'ACTIVE',
  engineVersion: '1.0.0',
  contentVersion: 1,
  currentChunkIndex: 0,
  workspaceSlots: ['WHOLE', 'PART_IN_PERCENTAGE'],
  workspace: { slots: [{ slot: 'WHOLE', token_id: null, label: null }] },
  acceptedCommitments: [],
  chunks: [
    {
      orderIndex: 0,
      chunkType: 'CONTEXT',
      content: 'A class has 40 students.',
      tokens: [{ token_id: 'ex01-c0-whole', text: '40 students' }],
    },
    {
      orderIndex: 1,
      chunkType: 'FACT',
      content: 'Thirty percent wear glasses.',
      tokens: [{ token_id: 'ex01-c1-percent', text: '30%' }],
    },
    {
      orderIndex: 2,
      chunkType: 'QUESTION',
      content: 'How many students wear glasses?',
      tokens: [],
    },
  ],
  message: null,
};

describe('buildPublicSession (allowlist serializer)', () => {
  it('exposes only revealed chunks — never future hidden chunks (AC-012)', () => {
    const publicSession = buildPublicSession(baseInput);
    expect(publicSession.visible_chunks.map((c) => c.order_index)).toEqual([0]);
    const serialized = JSON.stringify(publicSession);
    expect(serialized).not.toContain('Thirty percent');
    expect(serialized).not.toContain('How many students');
  });

  it('reveals up to the current chunk index', () => {
    const publicSession = buildPublicSession({ ...baseInput, currentChunkIndex: 1 });
    expect(publicSession.visible_chunks.map((c) => c.order_index)).toEqual([0, 1]);
    expect(JSON.stringify(publicSession)).not.toContain('How many students');
  });

  it('projects every workspace slot defined by the problem version', () => {
    const publicSession = buildPublicSession(baseInput);
    expect(publicSession.workspace.slots.map((s) => s.slot)).toEqual([
      'WHOLE',
      'PART_IN_PERCENTAGE',
    ]);
  });

  it('offers no actions once the session is not active', () => {
    const publicSession = buildPublicSession({ ...baseInput, status: 'COMPLETED' });
    expect(publicSession.allowed_actions).toEqual([]);
  });
});
