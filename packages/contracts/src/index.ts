import { z } from 'zod';

/**
 * Shared, isomorphic contracts used by the API and the web client.
 * Only zod is imported here so the browser bundle stays framework/DB free.
 */

// ---------------------------------------------------------------------------
// Action types (ARCHITECTURE §7)
// ---------------------------------------------------------------------------
export const ACTION_TYPES = [
  'ASSIGN_SLOT',
  'DELETE_ASSIGNMENT',
  'SUBMIT_COMMITMENT',
  'ACKNOWLEDGE_INSUFFICIENT_INFORMATION',
  'SUBMIT_FINAL_ANSWER',
] as const;
export const actionTypeSchema = z.enum(ACTION_TYPES);
export type ActionType = z.infer<typeof actionTypeSchema>;

// Typed workspace slots (PRODUCT §5). The concrete slots permitted for a given
// problem are constrained by that problem's definition; this is the full vocabulary.
export const SLOTS = [
  'WHOLE',
  'PART_IN_PERCENTAGE',
  'PART_IN_NUMBER',
  'FRACTION',
  'RATIO',
  'RELATIONAL_OPERATOR',
  'UNKNOWN',
] as const;
export const slotSchema = z.enum(SLOTS);
export type Slot = z.infer<typeof slotSchema>;

// ---------------------------------------------------------------------------
// Action request (ARCHITECTURE §6). `session_id` travels in the URL, the other
// four mandatory fields (PB-015) travel in the body.
// ---------------------------------------------------------------------------
export const actionPayloadSchema = z
  .object({
    slot: slotSchema.optional(),
    token_id: z.string().min(1).max(200).optional(),
    value: z.string().max(200).optional(),
  })
  .strict();
export type ActionPayload = z.infer<typeof actionPayloadSchema>;

export const actionRequestSchema = z
  .object({
    client_action_id: z.string().uuid(),
    expected_state_version: z.number().int().min(0),
    action_type: actionTypeSchema,
    payload: actionPayloadSchema,
  })
  .strict();
export type ActionRequest = z.infer<typeof actionRequestSchema>;

// ---------------------------------------------------------------------------
// Public session response (ARCHITECTURE §6). This is an explicit allowlist:
// raw problem text and hidden chunks can never appear here (PB-004 / AC-012).
// ---------------------------------------------------------------------------
export const SESSION_STATUSES = ['ACTIVE', 'COMPLETED', 'ABANDONED'] as const;
export const sessionStatusSchema = z.enum(SESSION_STATUSES);
export type SessionStatus = z.infer<typeof sessionStatusSchema>;

export const visibleChunkSchema = z
  .object({
    order_index: z.number().int().min(0),
    chunk_type: z.string(),
    content: z.string(),
    tokens: z.array(z.object({ token_id: z.string(), text: z.string() })).default([]),
  })
  .strict();
export type VisibleChunk = z.infer<typeof visibleChunkSchema>;

// Ordered, already-answered steps (change-28-jul.txt goal #5: "show all prior
// answered steps plus the current step"). Never reveals options or misconceptions.
export const completedStepSchema = z
  .object({
    step_pos: z.number().int().min(1),
    token_id: z.string(),
    label: z.string(),
    correct_slot: slotSchema,
  })
  .strict();
export type CompletedStep = z.infer<typeof completedStepSchema>;

// The one active step's answer set. Never reveals which option is correct.
export const stepOptionPublicSchema = z.object({ slot: slotSchema, label: z.string() }).strict();
export type StepOptionPublic = z.infer<typeof stepOptionPublicSchema>;

export const activeStepSchema = z
  .object({
    step_pos: z.number().int().min(1),
    token_id: z.string(),
    label: z.string(),
    options: z.array(stepOptionPublicSchema),
  })
  .strict();
export type ActiveStep = z.infer<typeof activeStepSchema>;

export const publicSessionSchema = z
  .object({
    session_id: z.string().uuid(),
    state_version: z.number().int().min(0),
    status: sessionStatusSchema,
    visible_chunks: z.array(visibleChunkSchema),
    completed_steps: z.array(completedStepSchema),
    current_step: activeStepSchema.nullable(),
    accepted_commitments: z.array(z.string()),
    required_next_action: z.object({ action_type: actionTypeSchema.nullable() }),
    allowed_actions: z.array(actionTypeSchema),
    message: z.string().nullable(),
    /** Fixture guidance code when a rollback rule fires; otherwise null. */
    guidance_code: z.string().nullable(),
    engine_version: z.string(),
    content_version: z.number().int(),
  })
  .strict();
export type PublicSession = z.infer<typeof publicSessionSchema>;

// ---------------------------------------------------------------------------
// Error envelope (ARCHITECTURE §6)
// ---------------------------------------------------------------------------
export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'STATE_VERSION_CONFLICT',
  'SESSION_COMPLETED',
  'ACTION_NOT_ALLOWED',
  'NO_CONTENT_AVAILABLE',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
] as const;
export const errorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const errorEnvelopeSchema = z
  .object({
    error: z
      .object({
        code: errorCodeSchema,
        message: z.string(),
        request_id: z.string(),
      })
      .strict(),
  })
  .strict();
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

// Dashboard summary (J-01 step 4 / J-02 availability).
export const dashboardSchema = z
  .object({
    active_session: z
      .object({ session_id: z.string().uuid(), status: sessionStatusSchema })
      .nullable(),
    next_problem_available: z.boolean(),
  })
  .strict();
export type Dashboard = z.infer<typeof dashboardSchema>;

// Profile summary (GET /api/me). Pseudonymous — never the email (PB-032).
export const meSchema = z
  .object({
    analytics_subject_id: z.string().uuid(),
    status: z.enum(['ACTIVE', 'DELETED']),
  })
  .strict();
export type Me = z.infer<typeof meSchema>;
