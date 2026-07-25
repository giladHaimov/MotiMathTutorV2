import type { ActionType, Slot } from '@app/contracts';

export type UserRef = 'primary' | 'secondary';
export type SessionRef = 'current' | 'ex01' | 'ex02' | 'ex04' | 'ex03' | 'other';

export type ScenarioStep =
  | { type: 'register'; user?: UserRef }
  | { type: 'login'; user?: UserRef; wrongPassword?: boolean }
  | { type: 'logout'; user?: UserRef }
  | {
      type: 'startSession';
      user?: UserRef;
      session: SessionRef;
      expectedProblem: CanonicalProblem;
      expectSameAs?: SessionRef;
    }
  | {
      type: 'submitAction';
      user?: UserRef;
      session: SessionRef;
      actionType: ActionType;
      payload: Record<string, unknown>;
      clientActionKey?: string;
      duplicate?: boolean;
      staleBy?: number;
      injectFailure?: boolean;
    }
  | {
      type: 'expectState';
      session: SessionRef;
      status?: 'ACTIVE' | 'COMPLETED';
      visibleCount?: number;
      stateVersion?: number;
      stateVersionAtLeast?: number;
      slot?: { name: Slot; tokenId: string | null };
      requiredAction?: ActionType | null;
      guidanceCode?: string | null;
    }
  | {
      type: 'expectRejected';
      session: SessionRef;
      misconception?: string;
      statusCode?: number;
      stateUnchanged?: boolean;
    }
  | { type: 'expectResponseHasNoFutureChunk' }
  | { type: 'restartBackend'; session: SessionRef; user?: UserRef }
  | { type: 'activateContentVersion'; session: SessionRef }
  | {
      type: 'assertDbRows';
      session: SessionRef;
      attemptsAtLeast?: number;
      attemptsExactlyForLastAction?: number;
      eventsAtLeast?: number;
      rollbackLogs?: number;
      pseudonymousVersions?: boolean;
      noSensitiveData?: boolean;
    }
  | {
      type: 'concurrent';
      user?: UserRef;
      session: SessionRef;
      actions: [
        { actionType: ActionType; payload: Record<string, unknown> },
        { actionType: ActionType; payload: Record<string, unknown> },
      ];
    };

export interface Scenario {
  id: `JS-${string}`;
  title: string;
  group: 'auth' | 'mastery' | 'recovery' | 'integrity' | 'privacy';
  refs: readonly string[];
  mobile: boolean;
  expectedInvariants: readonly string[];
  steps: readonly ScenarioStep[];
}

export type CanonicalProblem = 'EX-01' | 'EX-02' | 'EX-04' | 'EX-03';

const problem = {
  'EX-01': {
    session: 'ex01',
    answer: '12',
    assignments: [
      ['WHOLE', 'ex01-c0-whole'],
      ['PART_IN_PERCENTAGE', 'ex01-c1-percent'],
      ['UNKNOWN', 'ex01-c2-unknown'],
    ],
  },
  'EX-02': {
    session: 'ex02',
    answer: '10',
    assignments: [
      ['RATIO', 'ex02-c0-ratio'],
      ['PART_IN_NUMBER', 'ex02-c1-blue'],
      ['UNKNOWN', 'ex02-c2-unknown'],
    ],
  },
  'EX-04': {
    session: 'ex04',
    answer: '12',
    assignments: [
      ['WHOLE', 'ex04-c0-whole'],
      ['PART_IN_PERCENTAGE', 'ex04-c1-percent'],
      ['UNKNOWN', 'ex04-c2-unknown'],
    ],
  },
  'EX-03': {
    session: 'ex03',
    answer: '20',
    assignments: [
      ['FRACTION', 'ex03-c0-fraction'],
      ['WHOLE', 'ex03-c1-whole'],
      ['UNKNOWN', 'ex03-c2-unknown'],
    ],
  },
} as const;

const register = (user: UserRef = 'primary'): ScenarioStep => ({ type: 'register', user });
const login = (user: UserRef = 'primary', wrongPassword = false): ScenarioStep => ({
  type: 'login',
  user,
  wrongPassword,
});
const logout = (user: UserRef = 'primary'): ScenarioStep => ({ type: 'logout', user });
const start = (
  key: CanonicalProblem,
  user: UserRef = 'primary',
  expectSameAs?: SessionRef,
): ScenarioStep => ({
  type: 'startSession',
  user,
  session: problem[key].session,
  expectedProblem: key,
  ...(expectSameAs ? { expectSameAs } : {}),
});
const act = (
  session: SessionRef,
  actionType: ActionType,
  payload: Record<string, unknown>,
  extra: Partial<Extract<ScenarioStep, { type: 'submitAction' }>> = {},
): ScenarioStep => ({ type: 'submitAction', session, actionType, payload, ...extra });
const state = (
  session: SessionRef,
  expected: Omit<Extract<ScenarioStep, { type: 'expectState' }>, 'type' | 'session'>,
): ScenarioStep => ({ type: 'expectState', session, ...expected });

function solve(
  key: CanonicalProblem,
  options: { user?: UserRef; duplicate?: boolean; start?: boolean } = {},
): ScenarioStep[] {
  const data = problem[key];
  const session = data.session;
  const steps: ScenarioStep[] = options.start === false ? [] : [start(key, options.user)];
  data.assignments.forEach(([slot, token], index) => {
    steps.push(
      act(
        session,
        'ASSIGN_SLOT',
        { slot, token_id: token },
        {
          user: options.user,
          duplicate: options.duplicate,
          clientActionKey: options.duplicate ? `${key}-${index}-assign` : undefined,
        },
      ),
    );
    if (index < 2) {
      steps.push(
        act(
          session,
          'SUBMIT_COMMITMENT',
          {},
          {
            user: options.user,
            duplicate: options.duplicate,
            clientActionKey: options.duplicate ? `${key}-${index}-commit` : undefined,
          },
        ),
      );
    }
  });
  steps.push(
    act(
      session,
      'SUBMIT_FINAL_ANSWER',
      { value: data.answer },
      {
        user: options.user,
        duplicate: options.duplicate,
        clientActionKey: options.duplicate ? `${key}-answer` : undefined,
      },
    ),
    state(session, { status: 'COMPLETED', visibleCount: 3 }),
  );
  return steps;
}

const through = (last: CanonicalProblem): ScenarioStep[] => {
  const order: CanonicalProblem[] = ['EX-01', 'EX-02', 'EX-04', 'EX-03'];
  return order.slice(0, order.indexOf(last) + 1).flatMap((key) => solve(key));
};

const invariant = [
  'Real Better Auth cookie and PostgreSQL state',
  'Every public response contains only currently revealed chunks',
  'Server state remains authoritative after every step',
] as const;

export const scenarioCatalog: readonly Scenario[] = [
  {
    id: 'JS-01',
    title: 'Logout twice across a partial EX-01 and resume exact state before finishing',
    group: 'auth',
    refs: ['AC-001', 'AC-003', 'AC-049', 'SCN-01', 'SCN-11'],
    mobile: true,
    expectedInvariants: invariant,
    steps: [
      register(),
      logout(),
      login(),
      start('EX-01'),
      act('ex01', 'ASSIGN_SLOT', { slot: 'WHOLE', token_id: 'ex01-c0-whole' }),
      state('ex01', {
        stateVersion: 1,
        visibleCount: 1,
        slot: { name: 'WHOLE', tokenId: 'ex01-c0-whole' },
      }),
      logout(),
      login(),
      { type: 'restartBackend', session: 'ex01' },
      ...solve('EX-01', { start: false }).slice(1),
    ],
  },
  {
    id: 'JS-02',
    title: 'Protected routes reject a logged-out mid-session student, then resume and finish',
    group: 'auth',
    refs: ['AC-002', 'AC-003', 'AC-049', 'SCN-01'],
    mobile: false,
    expectedInvariants: invariant,
    steps: [
      register(),
      start('EX-01'),
      act('ex01', 'ASSIGN_SLOT', { slot: 'WHOLE', token_id: 'ex01-c0-whole' }),
      logout(),
      { type: 'expectRejected', session: 'ex01', statusCode: 401 },
      login(),
      ...solve('EX-01', { start: false }).slice(1),
    ],
  },
  {
    id: 'JS-03',
    title: 'Two students complete EX-01 with isolation throughout the journey',
    group: 'auth',
    refs: ['AC-005', 'AC-006', 'AC-010', 'SCN-10'],
    mobile: false,
    expectedInvariants: [...invariant, 'Cross-owner reads and writes are rejected'],
    steps: [
      register('primary'),
      register('secondary'),
      ...solve('EX-01', { user: 'primary' }),
      ...solve('EX-01', { user: 'secondary' }),
    ],
  },
  {
    id: 'JS-04',
    title: 'Wrong-password attempts preserve rate limiting before correct login and full solve',
    group: 'auth',
    refs: ['AC-001', 'AC-007', 'SCN-01'],
    mobile: false,
    expectedInvariants: invariant,
    steps: [
      register(),
      logout(),
      login('primary', true),
      login('primary', true),
      login(),
      ...solve('EX-01'),
    ],
  },
  {
    id: 'JS-05',
    title: 'Complete all canonical problems in deterministic EX-01→EX-02→EX-04→EX-03 order',
    group: 'mastery',
    refs: ['AC-010', 'AC-014', 'AC-034', 'SCN-03', 'SCN-05', 'SCN-06', 'SCN-07'],
    mobile: true,
    expectedInvariants: [...invariant, 'Completed problems are excluded deterministically'],
    steps: [register(), ...through('EX-03')],
  },
  {
    id: 'JS-06',
    title: 'Mixed outcomes across the real four-problem deterministic study order',
    group: 'mastery',
    refs: ['AC-028', 'AC-029', 'AC-031', 'AC-039', 'SCN-05', 'SCN-07'],
    mobile: true,
    expectedInvariants: invariant,
    steps: [
      register(),
      ...solve('EX-01'),
      start('EX-02'),
      act('ex02', 'SUBMIT_FINAL_ANSWER', { value: '10' }),
      { type: 'expectRejected', session: 'ex02', misconception: 'PREMATURE_QUANTIFICATION' },
      act('ex02', 'ACKNOWLEDGE_INSUFFICIENT_INFORMATION', {}),
      ...solve('EX-02', { start: false }),
      start('EX-04'),
      act('ex04', 'ASSIGN_SLOT', { slot: 'WHOLE', token_id: 'ex04-c0-whole' }),
      act('ex04', 'SUBMIT_COMMITMENT', {}),
      act('ex04', 'ASSIGN_SLOT', { slot: 'WHOLE', token_id: 'ex04-c1-percent' }),
      act('ex04', 'DELETE_ASSIGNMENT', { slot: 'WHOLE' }),
      act('ex04', 'ASSIGN_SLOT', { slot: 'WHOLE', token_id: 'ex04-c1-percent' }),
      state('ex04', { visibleCount: 1, guidanceCode: 'GUIDE_DELETE_CONFLICT' }),
      ...solve('EX-04', { start: false }),
      ...solve('EX-03'),
    ],
  },
  {
    id: 'JS-07',
    title: 'Starting EX-03 while EX-02 is active returns EX-02, then sequential study continues',
    group: 'mastery',
    refs: ['AC-014', 'AC-019', 'SCN-11'],
    mobile: false,
    expectedInvariants: [...invariant, 'At most one ACTIVE session exists per subject'],
    steps: [
      register(),
      ...solve('EX-01'),
      start('EX-02'),
      act('ex02', 'ASSIGN_SLOT', { slot: 'RATIO', token_id: 'ex02-c0-ratio' }),
      start('EX-02', 'primary', 'ex02'),
      ...solve('EX-02', { start: false }).slice(1),
      ...solve('EX-04'),
      ...solve('EX-03'),
    ],
  },
  {
    id: 'JS-08',
    title:
      'Multiple EX-01 structural errors remain rejected before explicit conflict deletion and recovery',
    group: 'recovery',
    refs: ['AC-016', 'AC-025', 'AC-026', 'AC-044', 'SCN-04'],
    mobile: true,
    expectedInvariants: invariant,
    steps: [
      register(),
      start('EX-01'),
      act('ex01', 'ASSIGN_SLOT', { slot: 'PART_IN_NUMBER', token_id: 'ex01-c0-whole' }),
      {
        type: 'expectRejected',
        session: 'ex01',
        stateUnchanged: true,
      },
      act('ex01', 'ASSIGN_SLOT', { slot: 'WHOLE', token_id: 'ex01-c0-whole' }),
      act('ex01', 'SUBMIT_COMMITMENT', {}),
      act('ex01', 'ASSIGN_SLOT', { slot: 'WHOLE', token_id: 'ex01-c1-percent' }),
      {
        type: 'expectRejected',
        session: 'ex01',
        misconception: 'WHOLE_PART_CONFUSION',
        stateUnchanged: true,
      },
      act('ex01', 'DELETE_ASSIGNMENT', { slot: 'WHOLE' }),
      ...solve('EX-01', { start: false }),
      { type: 'assertDbRows', session: 'ex01', attemptsAtLeast: 9, eventsAtLeast: 10 },
    ],
  },
  {
    id: 'JS-09',
    title: 'Repeated EX-04 conflict rolls back once and duplicate retry cannot double-trigger',
    group: 'recovery',
    refs: ['AC-030', 'AC-031', 'AC-032', 'AC-039', 'SCN-07'],
    mobile: false,
    expectedInvariants: invariant,
    steps: [
      register(),
      ...solve('EX-01'),
      ...solve('EX-02'),
      start('EX-04'),
      act('ex04', 'ASSIGN_SLOT', { slot: 'WHOLE', token_id: 'ex04-c0-whole' }),
      act('ex04', 'SUBMIT_COMMITMENT', {}),
      act('ex04', 'ASSIGN_SLOT', { slot: 'WHOLE', token_id: 'ex04-c1-percent' }),
      act('ex04', 'DELETE_ASSIGNMENT', { slot: 'WHOLE' }),
      act(
        'ex04',
        'ASSIGN_SLOT',
        { slot: 'WHOLE', token_id: 'ex04-c1-percent' },
        { clientActionKey: 'rollback', duplicate: true },
      ),
      state('ex04', { visibleCount: 1, guidanceCode: 'GUIDE_DELETE_CONFLICT' }),
      { type: 'assertDbRows', session: 'ex04', rollbackLogs: 1, attemptsExactlyForLastAction: 1 },
    ],
  },
  {
    id: 'JS-10',
    title: 'Premature-answer recovery across EX-02 and EX-03 before canonical completion',
    group: 'recovery',
    refs: ['AC-028', 'AC-029', 'AC-037', 'AC-038', 'SCN-05', 'SCN-06'],
    mobile: true,
    expectedInvariants: invariant,
    steps: [
      register(),
      ...solve('EX-01'),
      start('EX-02'),
      act('ex02', 'SUBMIT_FINAL_ANSWER', { value: '10' }),
      act('ex02', 'ACKNOWLEDGE_INSUFFICIENT_INFORMATION', {}),
      ...solve('EX-02', { start: false }),
      ...solve('EX-04'),
      start('EX-03'),
      act('ex03', 'SUBMIT_FINAL_ANSWER', { value: '20' }),
      act('ex03', 'ACKNOWLEDGE_INSUFFICIENT_INFORMATION', {}),
      ...solve('EX-03', { start: false }),
    ],
  },
  {
    id: 'JS-11',
    title: 'Early and incorrect final answers never complete, while canonical answers do',
    group: 'recovery',
    refs: ['AC-033', 'AC-034', 'AC-035'],
    mobile: false,
    expectedInvariants: invariant,
    steps: [
      register(),
      start('EX-01'),
      act('ex01', 'SUBMIT_FINAL_ANSWER', { value: '12' }),
      { type: 'expectRejected', session: 'ex01', stateUnchanged: true },
      ...solve('EX-01', { start: false }).slice(0, -2),
      act('ex01', 'SUBMIT_FINAL_ANSWER', { value: '11' }),
      state('ex01', { status: 'ACTIVE' }),
      act('ex01', 'SUBMIT_FINAL_ANSWER', { value: '12' }),
      state('ex01', { status: 'COMPLETED' }),
    ],
  },
  {
    id: 'JS-12',
    title: 'One duplicated network action advances once before the journey finishes',
    group: 'integrity',
    refs: ['AC-017', 'AC-048', 'SCN-08'],
    mobile: false,
    expectedInvariants: invariant,
    steps: [
      register(),
      start('EX-01'),
      act(
        'ex01',
        'ASSIGN_SLOT',
        { slot: 'WHOLE', token_id: 'ex01-c0-whole' },
        { duplicate: true, clientActionKey: 'retry' },
      ),
      state('ex01', { stateVersion: 1 }),
      ...solve('EX-01', { start: false }).slice(1),
      { type: 'assertDbRows', session: 'ex01', attemptsExactlyForLastAction: 1 },
    ],
  },
  {
    id: 'JS-13',
    title: 'Concurrent same-version actions produce one winner and authoritative conflict',
    group: 'integrity',
    refs: ['AC-018', 'AC-019', 'SCN-09'],
    mobile: false,
    expectedInvariants: invariant,
    steps: [
      register(),
      start('EX-01'),
      {
        type: 'concurrent',
        session: 'ex01',
        actions: [
          { actionType: 'ASSIGN_SLOT', payload: { slot: 'WHOLE', token_id: 'ex01-c0-whole' } },
          {
            actionType: 'ASSIGN_SLOT',
            payload: { slot: 'WHOLE', token_id: 'ex01-c0-whole' },
          },
        ],
      },
      state('ex01', { stateVersion: 1 }),
      ...solve('EX-01', { start: false }).slice(1),
    ],
  },
  {
    id: 'JS-14',
    title: 'Forced accepted-transition failure leaves no partial rows and recovery finishes',
    group: 'integrity',
    refs: ['AC-020', 'AC-021', 'SCN-12'],
    mobile: false,
    expectedInvariants: invariant,
    steps: [
      register(),
      start('EX-01'),
      act(
        'ex01',
        'ASSIGN_SLOT',
        { slot: 'WHOLE', token_id: 'ex01-c0-whole' },
        { injectFailure: true, clientActionKey: 'fault' },
      ),
      { type: 'expectRejected', session: 'ex01', statusCode: 500, stateUnchanged: true },
      { type: 'assertDbRows', session: 'ex01', attemptsExactlyForLastAction: 0 },
      act(
        'ex01',
        'ASSIGN_SLOT',
        { slot: 'WHOLE', token_id: 'ex01-c0-whole' },
        { clientActionKey: 'fault' },
      ),
      ...solve('EX-01', { start: false }).slice(1),
    ],
  },
  {
    id: 'JS-15',
    title: 'Fastify and pool restart resumes exact authoritative state and finishes',
    group: 'integrity',
    refs: ['AC-022', 'SCN-11'],
    mobile: true,
    expectedInvariants: invariant,
    steps: [
      register(),
      start('EX-01'),
      act('ex01', 'ASSIGN_SLOT', { slot: 'WHOLE', token_id: 'ex01-c0-whole' }),
      { type: 'restartBackend', session: 'ex01' },
      state('ex01', { stateVersion: 1, slot: { name: 'WHOLE', tokenId: 'ex01-c0-whole' } }),
      ...solve('EX-01', { start: false }).slice(1),
    ],
  },
  {
    id: 'JS-16',
    title: 'Active session remains pinned while a newly activated version is independently visible',
    group: 'integrity',
    refs: ['AC-009', 'AC-010', 'AC-013', 'SCN-13'],
    mobile: false,
    expectedInvariants: [...invariant, 'Existing session content and engine versions never change'],
    steps: [
      register(),
      start('EX-01'),
      act('ex01', 'ASSIGN_SLOT', { slot: 'WHOLE', token_id: 'ex01-c0-whole' }),
      { type: 'activateContentVersion', session: 'ex01' },
      register('secondary'),
      start('EX-01', 'secondary'),
      { type: 'restartBackend', session: 'ex01' },
      state('ex01', { stateVersion: 1, slot: { name: 'WHOLE', tokenId: 'ex01-c0-whole' } }),
      ...solve('EX-01', { start: false }).slice(1),
    ],
  },
  {
    id: 'JS-17',
    title: 'Every action in EX-01 is replayed with one id and yields single-submit state',
    group: 'integrity',
    refs: ['AC-017', 'AC-032', 'SCN-08'],
    mobile: false,
    expectedInvariants: invariant,
    steps: [
      register(),
      ...solve('EX-01', { duplicate: true }),
      { type: 'assertDbRows', session: 'ex01', attemptsAtLeast: 6, eventsAtLeast: 7 },
    ],
  },
  {
    id: 'JS-18',
    title: 'Mixed full session preserves privacy separation and pseudonymous versioned events',
    group: 'privacy',
    refs: ['AC-041', 'AC-042', 'AC-043'],
    mobile: false,
    expectedInvariants: invariant,
    steps: [
      register(),
      ...solve('EX-01'),
      ...solve('EX-02'),
      { type: 'assertDbRows', session: 'ex02', pseudonymousVersions: true, noSensitiveData: true },
    ],
  },
  {
    id: 'JS-19',
    title: 'Every accumulated response across all canonical problems excludes future content',
    group: 'privacy',
    refs: ['AC-011', 'AC-012', 'SCN-02'],
    mobile: false,
    expectedInvariants: invariant,
    steps: [register(), ...through('EX-03'), { type: 'expectResponseHasNoFutureChunk' }],
  },
  {
    id: 'JS-20',
    title: 'Logout after completion cannot mutate the completed session after re-login',
    group: 'auth',
    refs: ['AC-003', 'AC-023', 'AC-034'],
    mobile: false,
    expectedInvariants: invariant,
    steps: [
      register(),
      ...solve('EX-01'),
      logout(),
      login(),
      act('ex01', 'SUBMIT_FINAL_ANSWER', { value: '12' }),
      { type: 'expectRejected', session: 'ex01', statusCode: 409, stateUnchanged: true },
    ],
  },
  {
    id: 'JS-21',
    title: 'Stale action after partial progress returns authoritative state and journey recovers',
    group: 'integrity',
    refs: ['AC-018', 'AC-049', 'SCN-09'],
    mobile: false,
    expectedInvariants: invariant,
    steps: [
      register(),
      start('EX-01'),
      act('ex01', 'ASSIGN_SLOT', { slot: 'WHOLE', token_id: 'ex01-c0-whole' }),
      act('ex01', 'SUBMIT_COMMITMENT', {}, { staleBy: 1 }),
      { type: 'expectRejected', session: 'ex01', statusCode: 409, stateUnchanged: true },
      ...solve('EX-01', { start: false }).slice(1),
    ],
  },
  {
    id: 'JS-22',
    title: 'EX-03 complement confusion is recorded and exact recovery completes twenty',
    group: 'recovery',
    refs: ['AC-030', 'AC-038', 'AC-044', 'SCN-06'],
    mobile: false,
    expectedInvariants: invariant,
    steps: [
      register(),
      ...through('EX-04'),
      start('EX-03'),
      act('ex03', 'ASSIGN_SLOT', { slot: 'FRACTION', token_id: 'ex03-c0-fraction' }),
      act('ex03', 'SUBMIT_COMMITMENT', {}),
      act('ex03', 'ASSIGN_SLOT', { slot: 'WHOLE', token_id: 'ex03-c1-whole' }),
      act('ex03', 'SUBMIT_COMMITMENT', {}),
      act('ex03', 'ASSIGN_SLOT', { slot: 'UNKNOWN', token_id: 'ex03-c0-fraction' }),
      { type: 'expectRejected', session: 'ex03', misconception: 'COMPLEMENT_CONFUSION' },
      act('ex03', 'ASSIGN_SLOT', { slot: 'UNKNOWN', token_id: 'ex03-c2-unknown' }),
      act('ex03', 'SUBMIT_FINAL_ANSWER', { value: '20' }),
      state('ex03', { status: 'COMPLETED' }),
    ],
  },
  {
    id: 'JS-23',
    title: 'Repeated start calls converge on one active EX-01 session before completion',
    group: 'integrity',
    refs: ['AC-014', 'AC-019'],
    mobile: false,
    expectedInvariants: [...invariant, 'Database partial unique index permits one ACTIVE session'],
    steps: [
      register(),
      start('EX-01'),
      start('EX-01', 'primary', 'ex01'),
      start('EX-01', 'primary', 'ex01'),
      ...solve('EX-01', { start: false }),
    ],
  },
  {
    id: 'JS-24',
    title: 'Long dashboard-independent resume checkpoints preserve each EX-01 reveal boundary',
    group: 'mastery',
    refs: ['AC-022', 'AC-024', 'AC-049', 'SCN-11'],
    mobile: false,
    expectedInvariants: invariant,
    steps: [
      register(),
      start('EX-01'),
      act('ex01', 'ASSIGN_SLOT', { slot: 'WHOLE', token_id: 'ex01-c0-whole' }),
      { type: 'restartBackend', session: 'ex01' },
      act('ex01', 'SUBMIT_COMMITMENT', {}),
      state('ex01', { visibleCount: 2 }),
      { type: 'restartBackend', session: 'ex01' },
      act('ex01', 'ASSIGN_SLOT', {
        slot: 'PART_IN_PERCENTAGE',
        token_id: 'ex01-c1-percent',
      }),
      act('ex01', 'SUBMIT_COMMITMENT', {}),
      state('ex01', { visibleCount: 3 }),
      { type: 'restartBackend', session: 'ex01' },
      act('ex01', 'ASSIGN_SLOT', { slot: 'UNKNOWN', token_id: 'ex01-c2-unknown' }),
      act('ex01', 'SUBMIT_FINAL_ANSWER', { value: '12' }),
      state('ex01', { status: 'COMPLETED' }),
    ],
  },
] as const;
