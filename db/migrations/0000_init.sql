CREATE TABLE "auth_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "auth_sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "auth_users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "auth_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "auth_verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"problem_id" uuid NOT NULL,
	"order_index" integer NOT NULL,
	"chunk_type" text NOT NULL,
	"content" text NOT NULL,
	"semantic_definition" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chunks_order_chk" CHECK ("chunks"."order_index" >= 0)
);
--> statement-breakpoint
CREATE TABLE "learning_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"attempt_id" uuid,
	"analytics_subject_id" uuid NOT NULL,
	"problem_id" uuid NOT NULL,
	"chunk_id" uuid,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"misconception_code" text,
	"rollback_depth" integer,
	"engine_version" text NOT NULL,
	"content_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analytics_subject_id" uuid NOT NULL,
	"problem_id" uuid NOT NULL,
	"engine_version" text NOT NULL,
	"content_version" integer NOT NULL,
	"status" text NOT NULL,
	"state_version" integer DEFAULT 0 NOT NULL,
	"current_chunk_index" integer DEFAULT 0 NOT NULL,
	"workspace_state" jsonb NOT NULL,
	"accepted_commitments" jsonb NOT NULL,
	"required_next_action" jsonb NOT NULL,
	"public_state" jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "learning_sessions_status_chk" CHECK ("learning_sessions"."status" in ('ACTIVE','COMPLETED','ABANDONED')),
	CONSTRAINT "learning_sessions_state_version_chk" CHECK ("learning_sessions"."state_version" >= 0),
	CONSTRAINT "learning_sessions_chunk_chk" CHECK ("learning_sessions"."current_chunk_index" >= 0),
	CONSTRAINT "learning_sessions_completed_chk" CHECK (("learning_sessions"."status" <> 'COMPLETED') or ("learning_sessions"."completed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "misconception_classes" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "problems" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid NOT NULL,
	"problem_key" text NOT NULL,
	"version" integer NOT NULL,
	"domain" text NOT NULL,
	"title" text NOT NULL,
	"difficulty_level" integer NOT NULL,
	"full_text" text NOT NULL,
	"definition" jsonb NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "problems_version_chk" CHECK ("problems"."version" > 0),
	CONSTRAINT "problems_domain_chk" CHECK ("problems"."domain" in ('PERCENT','RATIO','FRACTION')),
	CONSTRAINT "problems_status_chk" CHECK ("problems"."status" in ('DRAFT','ACTIVE','RETIRED'))
);
--> statement-breakpoint
CREATE TABLE "programs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "programs_version_chk" CHECK ("programs"."version" > 0),
	CONSTRAINT "programs_status_chk" CHECK ("programs"."status" in ('DRAFT','ACTIVE','RETIRED'))
);
--> statement-breakpoint
CREATE TABLE "rollback_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"attempt_id" uuid NOT NULL,
	"misconception_code" text NOT NULL,
	"from_chunk_index" integer NOT NULL,
	"to_chunk_index" integer NOT NULL,
	"rollback_depth" integer NOT NULL,
	"repeat_count" integer NOT NULL,
	"guidance_code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rollback_logs_from_chk" CHECK ("rollback_logs"."from_chunk_index" >= 0),
	CONSTRAINT "rollback_logs_to_chk" CHECK ("rollback_logs"."to_chunk_index" >= 0),
	CONSTRAINT "rollback_logs_depth_chk" CHECK ("rollback_logs"."rollback_depth" >= 0),
	CONSTRAINT "rollback_logs_repeat_chk" CHECK ("rollback_logs"."repeat_count" >= 1)
);
--> statement-breakpoint
CREATE TABLE "rollback_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"problem_id" uuid NOT NULL,
	"misconception_code" text NOT NULL,
	"repeat_from" integer NOT NULL,
	"rollback_depth" integer NOT NULL,
	"guidance_code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rollback_rules_repeat_chk" CHECK ("rollback_rules"."repeat_from" >= 1),
	CONSTRAINT "rollback_rules_depth_chk" CHECK ("rollback_rules"."rollback_depth" >= 0)
);
--> statement-breakpoint
CREATE TABLE "stage_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"client_action_id" uuid NOT NULL,
	"sequence_no" integer NOT NULL,
	"expected_state_version" integer NOT NULL,
	"state_version_after" integer,
	"action_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"outcome" text NOT NULL,
	"misconception_code" text,
	"public_result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "stage_attempts_sequence_chk" CHECK ("stage_attempts"."sequence_no" > 0),
	CONSTRAINT "stage_attempts_expected_chk" CHECK ("stage_attempts"."expected_state_version" >= 0),
	CONSTRAINT "stage_attempts_outcome_chk" CHECK ("stage_attempts"."outcome" in ('RECEIVED','ACCEPTED','REJECTED','CONFLICT','ERROR'))
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"auth_user_id" text PRIMARY KEY NOT NULL,
	"analytics_subject_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "user_profiles_analytics_subject_id_unique" UNIQUE("analytics_subject_id"),
	CONSTRAINT "user_profiles_status_chk" CHECK ("user_profiles"."status" in ('ACTIVE','DELETED'))
);
--> statement-breakpoint
ALTER TABLE "auth_accounts" ADD CONSTRAINT "auth_accounts_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_events" ADD CONSTRAINT "learning_events_session_id_learning_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."learning_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_events" ADD CONSTRAINT "learning_events_attempt_id_stage_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."stage_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_events" ADD CONSTRAINT "learning_events_analytics_subject_id_user_profiles_analytics_subject_id_fk" FOREIGN KEY ("analytics_subject_id") REFERENCES "public"."user_profiles"("analytics_subject_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_events" ADD CONSTRAINT "learning_events_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_events" ADD CONSTRAINT "learning_events_chunk_id_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."chunks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_events" ADD CONSTRAINT "learning_events_misconception_code_misconception_classes_code_fk" FOREIGN KEY ("misconception_code") REFERENCES "public"."misconception_classes"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_sessions" ADD CONSTRAINT "learning_sessions_analytics_subject_id_user_profiles_analytics_subject_id_fk" FOREIGN KEY ("analytics_subject_id") REFERENCES "public"."user_profiles"("analytics_subject_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_sessions" ADD CONSTRAINT "learning_sessions_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problems" ADD CONSTRAINT "problems_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rollback_logs" ADD CONSTRAINT "rollback_logs_session_id_learning_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."learning_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rollback_logs" ADD CONSTRAINT "rollback_logs_attempt_id_stage_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."stage_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rollback_logs" ADD CONSTRAINT "rollback_logs_misconception_code_misconception_classes_code_fk" FOREIGN KEY ("misconception_code") REFERENCES "public"."misconception_classes"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rollback_rules" ADD CONSTRAINT "rollback_rules_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rollback_rules" ADD CONSTRAINT "rollback_rules_misconception_code_misconception_classes_code_fk" FOREIGN KEY ("misconception_code") REFERENCES "public"."misconception_classes"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_attempts" ADD CONSTRAINT "stage_attempts_session_id_learning_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."learning_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_attempts" ADD CONSTRAINT "stage_attempts_misconception_code_misconception_classes_code_fk" FOREIGN KEY ("misconception_code") REFERENCES "public"."misconception_classes"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_auth_user_id_auth_users_id_fk" FOREIGN KEY ("auth_user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_accounts_userId_idx" ON "auth_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_sessions_userId_idx" ON "auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_verifications_identifier_idx" ON "auth_verifications" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "chunks_problem_order_uq" ON "chunks" USING btree ("problem_id","order_index");--> statement-breakpoint
CREATE INDEX "learning_events_session_created_idx" ON "learning_events" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "learning_events_subject_created_idx" ON "learning_events" USING btree ("analytics_subject_id","created_at");--> statement-breakpoint
CREATE INDEX "learning_events_type_created_idx" ON "learning_events" USING btree ("event_type","created_at");--> statement-breakpoint
CREATE INDEX "learning_events_misconception_created_idx" ON "learning_events" USING btree ("misconception_code","created_at");--> statement-breakpoint
CREATE INDEX "learning_sessions_subject_status_updated_idx" ON "learning_sessions" USING btree ("analytics_subject_id","status","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "learning_sessions_problem_status_idx" ON "learning_sessions" USING btree ("problem_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "problems_program_key_version_uq" ON "problems" USING btree ("program_id","problem_key","version");--> statement-breakpoint
CREATE INDEX "problems_program_status_difficulty_idx" ON "problems" USING btree ("program_id","status","difficulty_level");--> statement-breakpoint
CREATE INDEX "problems_domain_status_idx" ON "problems" USING btree ("domain","status");--> statement-breakpoint
CREATE UNIQUE INDEX "programs_slug_version_uq" ON "programs" USING btree ("slug","version");--> statement-breakpoint
CREATE INDEX "programs_status_slug_idx" ON "programs" USING btree ("status","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "rollback_logs_attempt_uq" ON "rollback_logs" USING btree ("attempt_id");--> statement-breakpoint
CREATE INDEX "rollback_logs_session_created_idx" ON "rollback_logs" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "rollback_logs_misconception_created_idx" ON "rollback_logs" USING btree ("misconception_code","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rollback_rules_problem_code_from_uq" ON "rollback_rules" USING btree ("problem_id","misconception_code","repeat_from");--> statement-breakpoint
CREATE INDEX "rollback_rules_problem_code_idx" ON "rollback_rules" USING btree ("problem_id","misconception_code");--> statement-breakpoint
CREATE UNIQUE INDEX "stage_attempts_session_client_uq" ON "stage_attempts" USING btree ("session_id","client_action_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stage_attempts_session_sequence_uq" ON "stage_attempts" USING btree ("session_id","sequence_no");--> statement-breakpoint
CREATE INDEX "stage_attempts_session_created_idx" ON "stage_attempts" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "stage_attempts_misconception_created_idx" ON "stage_attempts" USING btree ("misconception_code","created_at");