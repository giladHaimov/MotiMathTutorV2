import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { auth_users } from './auth-schema.js';

/**
 * Hand-written product/application tables (ARCHITECTURE §9.5–9.14).
 * Auth tables are owned by the Better Auth generator (auth-schema.ts); these
 * reference `auth_users` for the identity mapping only.
 */

const ts = (name: string) => timestamp(name, { withTimezone: true });

// 9.5 user_profiles — pseudonymous student identity mapping.
export const userProfiles = pgTable(
  'user_profiles',
  {
    authUserId: text('auth_user_id')
      .primaryKey()
      .references(() => auth_users.id, { onDelete: 'cascade' }),
    analyticsSubjectId: uuid('analytics_subject_id').notNull().unique().defaultRandom(),
    status: text('status').notNull().default('ACTIVE'),
    createdAt: ts('created_at').notNull().defaultNow(),
    deletedAt: ts('deleted_at'),
  },
  (t) => [check('user_profiles_status_chk', sql`${t.status} in ('ACTIVE','DELETED')`)],
);

// 9.6 programs — immutable after activation; new version = new row.
export const programs = pgTable(
  'programs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    version: integer('version').notNull(),
    status: text('status').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('programs_slug_version_uq').on(t.slug, t.version),
    index('programs_status_slug_idx').on(t.status, t.slug),
    check('programs_version_chk', sql`${t.version} > 0`),
    check('programs_status_chk', sql`${t.status} in ('DRAFT','ACTIVE','RETIRED')`),
  ],
);

// 9.7 problems — server-only full_text + schema-validated definition jsonb.
export const problems = pgTable(
  'problems',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    programId: uuid('program_id')
      .notNull()
      .references(() => programs.id, { onDelete: 'restrict' }),
    problemKey: text('problem_key').notNull(),
    version: integer('version').notNull(),
    domain: text('domain').notNull(),
    title: text('title').notNull(),
    difficultyLevel: integer('difficulty_level').notNull(),
    fullText: text('full_text').notNull(),
    definition: jsonb('definition').notNull(),
    status: text('status').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('problems_program_key_version_uq').on(t.programId, t.problemKey, t.version),
    index('problems_program_status_difficulty_idx').on(t.programId, t.status, t.difficultyLevel),
    index('problems_domain_status_idx').on(t.domain, t.status),
    check('problems_version_chk', sql`${t.version} > 0`),
    check('problems_domain_chk', sql`${t.domain} in ('PERCENT','RATIO','FRACTION')`),
    check('problems_status_chk', sql`${t.status} in ('DRAFT','ACTIVE','RETIRED')`),
  ],
);

// 9.8 chunks — progressive reveal; never bulk-returned publicly.
export const chunks = pgTable(
  'chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    problemId: uuid('problem_id')
      .notNull()
      .references(() => problems.id, { onDelete: 'cascade' }),
    orderIndex: integer('order_index').notNull(),
    chunkType: text('chunk_type').notNull(),
    content: text('content').notNull(),
    semanticDefinition: jsonb('semantic_definition').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('chunks_problem_order_uq').on(t.problemId, t.orderIndex),
    check('chunks_order_chk', sql`${t.orderIndex} >= 0`),
  ],
);

// 9.9 misconception_classes
export const misconceptionClasses = pgTable('misconception_classes', {
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: ts('created_at').notNull().defaultNow(),
});

// 9.10 rollback_rules
export const rollbackRules = pgTable(
  'rollback_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    problemId: uuid('problem_id')
      .notNull()
      .references(() => problems.id, { onDelete: 'cascade' }),
    misconceptionCode: text('misconception_code')
      .notNull()
      .references(() => misconceptionClasses.code, { onDelete: 'restrict' }),
    repeatFrom: integer('repeat_from').notNull(),
    rollbackDepth: integer('rollback_depth').notNull(),
    guidanceCode: text('guidance_code').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('rollback_rules_problem_code_from_uq').on(
      t.problemId,
      t.misconceptionCode,
      t.repeatFrom,
    ),
    index('rollback_rules_problem_code_idx').on(t.problemId, t.misconceptionCode),
    check('rollback_rules_repeat_chk', sql`${t.repeatFrom} >= 1`),
    check('rollback_rules_depth_chk', sql`${t.rollbackDepth} >= 0`),
  ],
);

// 9.11 learning_sessions — durable server-authoritative reasoning state.
export const learningSessions = pgTable(
  'learning_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    analyticsSubjectId: uuid('analytics_subject_id')
      .notNull()
      .references(() => userProfiles.analyticsSubjectId, { onDelete: 'restrict' }),
    problemId: uuid('problem_id')
      .notNull()
      .references(() => problems.id, { onDelete: 'restrict' }),
    engineVersion: text('engine_version').notNull(),
    contentVersion: integer('content_version').notNull(),
    status: text('status').notNull(),
    stateVersion: integer('state_version').notNull().default(0),
    currentChunkIndex: integer('current_chunk_index').notNull().default(0),
    workspaceState: jsonb('workspace_state').notNull(),
    acceptedCommitments: jsonb('accepted_commitments').notNull(),
    requiredNextAction: jsonb('required_next_action').notNull(),
    publicState: jsonb('public_state').notNull(),
    startedAt: ts('started_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    completedAt: ts('completed_at'),
  },
  (t) => [
    index('learning_sessions_subject_status_updated_idx').on(
      t.analyticsSubjectId,
      t.status,
      t.updatedAt.desc(),
    ),
    index('learning_sessions_problem_status_idx').on(t.problemId, t.status),
    // At most one ACTIVE session per subject, enforced at the database level so
    // concurrent requests/tabs/devices/instances cannot create duplicates
    // (ARCHITECTURE §8; startSession relies on this via ON CONFLICT DO NOTHING).
    uniqueIndex('learning_sessions_one_active_per_subject_uq')
      .on(t.analyticsSubjectId)
      .where(sql`${t.status} = 'ACTIVE'`),
    check('learning_sessions_status_chk', sql`${t.status} in ('ACTIVE','COMPLETED','ABANDONED')`),
    check('learning_sessions_state_version_chk', sql`${t.stateVersion} >= 0`),
    check('learning_sessions_chunk_chk', sql`${t.currentChunkIndex} >= 0`),
    check(
      'learning_sessions_completed_chk',
      sql`(${t.status} <> 'COMPLETED') or (${t.completedAt} is not null)`,
    ),
  ],
);

// 9.12 stage_attempts — primary idempotency record.
export const stageAttempts = pgTable(
  'stage_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => learningSessions.id, { onDelete: 'cascade' }),
    clientActionId: uuid('client_action_id').notNull(),
    sequenceNo: integer('sequence_no').notNull(),
    expectedStateVersion: integer('expected_state_version').notNull(),
    stateVersionAfter: integer('state_version_after'),
    actionType: text('action_type').notNull(),
    payload: jsonb('payload').notNull(),
    outcome: text('outcome').notNull(),
    misconceptionCode: text('misconception_code').references(() => misconceptionClasses.code, {
      onDelete: 'restrict',
    }),
    publicResult: jsonb('public_result'),
    createdAt: ts('created_at').notNull().defaultNow(),
    completedAt: ts('completed_at'),
  },
  (t) => [
    uniqueIndex('stage_attempts_session_client_uq').on(t.sessionId, t.clientActionId),
    uniqueIndex('stage_attempts_session_sequence_uq').on(t.sessionId, t.sequenceNo),
    index('stage_attempts_session_created_idx').on(t.sessionId, t.createdAt),
    index('stage_attempts_misconception_created_idx').on(t.misconceptionCode, t.createdAt),
    check('stage_attempts_sequence_chk', sql`${t.sequenceNo} > 0`),
    check('stage_attempts_expected_chk', sql`${t.expectedStateVersion} >= 0`),
    check(
      'stage_attempts_outcome_chk',
      sql`${t.outcome} in ('RECEIVED','ACCEPTED','REJECTED','CONFLICT','ERROR')`,
    ),
  ],
);

// 9.13 learning_events — append-only pseudonymous behavioral records.
export const learningEvents = pgTable(
  'learning_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => learningSessions.id, { onDelete: 'cascade' }),
    attemptId: uuid('attempt_id').references(() => stageAttempts.id, { onDelete: 'cascade' }),
    analyticsSubjectId: uuid('analytics_subject_id')
      .notNull()
      .references(() => userProfiles.analyticsSubjectId, { onDelete: 'restrict' }),
    problemId: uuid('problem_id')
      .notNull()
      .references(() => problems.id, { onDelete: 'restrict' }),
    chunkId: uuid('chunk_id').references(() => chunks.id, { onDelete: 'restrict' }),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull(),
    misconceptionCode: text('misconception_code').references(() => misconceptionClasses.code, {
      onDelete: 'restrict',
    }),
    rollbackDepth: integer('rollback_depth'),
    engineVersion: text('engine_version').notNull(),
    contentVersion: integer('content_version').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('learning_events_session_created_idx').on(t.sessionId, t.createdAt),
    index('learning_events_subject_created_idx').on(t.analyticsSubjectId, t.createdAt),
    index('learning_events_type_created_idx').on(t.eventType, t.createdAt),
    index('learning_events_misconception_created_idx').on(t.misconceptionCode, t.createdAt),
  ],
);

// 9.14 rollback_logs — append-only; one per attempt.
export const rollbackLogs = pgTable(
  'rollback_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => learningSessions.id, { onDelete: 'cascade' }),
    attemptId: uuid('attempt_id')
      .notNull()
      .references(() => stageAttempts.id, { onDelete: 'cascade' }),
    misconceptionCode: text('misconception_code')
      .notNull()
      .references(() => misconceptionClasses.code, { onDelete: 'restrict' }),
    fromChunkIndex: integer('from_chunk_index').notNull(),
    toChunkIndex: integer('to_chunk_index').notNull(),
    rollbackDepth: integer('rollback_depth').notNull(),
    repeatCount: integer('repeat_count').notNull(),
    guidanceCode: text('guidance_code').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('rollback_logs_attempt_uq').on(t.attemptId),
    index('rollback_logs_session_created_idx').on(t.sessionId, t.createdAt),
    index('rollback_logs_misconception_created_idx').on(t.misconceptionCode, t.createdAt),
    check('rollback_logs_from_chk', sql`${t.fromChunkIndex} >= 0`),
    check('rollback_logs_to_chk', sql`${t.toChunkIndex} >= 0`),
    check('rollback_logs_depth_chk', sql`${t.rollbackDepth} >= 0`),
    check('rollback_logs_repeat_chk', sql`${t.repeatCount} >= 1`),
  ],
);
