-- Replace ACTIVE EX-01..EX-04 with EX-ARITH-01 / EX-ARITH-02
-- Safe: RETIRE old rows (sessions/events keep FKs). Paste into Neon SQL editor.
-- Program: core-reasoning v1
BEGIN;

-- 1) Retire currently ACTIVE canonical EX-01..EX-04
UPDATE problems
SET status = 'RETIRED'
WHERE program_id = '34c8b0fa-15c9-4533-ac78-7682b50793c1'
  AND problem_key IN ('EX-01','EX-02','EX-03','EX-04')
  AND status = 'ACTIVE';

-- 2) Upsert EX-ARITH-01 v1
-- Remove a prior draft of the same key/version if re-running (no sessions expected).
DELETE FROM chunks WHERE problem_id IN (
  SELECT id FROM problems WHERE program_id = '34c8b0fa-15c9-4533-ac78-7682b50793c1' AND problem_key = 'EX-ARITH-01' AND version = 1
    AND NOT EXISTS (SELECT 1 FROM learning_sessions ls WHERE ls.problem_id = problems.id)
    AND NOT EXISTS (SELECT 1 FROM learning_events le WHERE le.problem_id = problems.id)
);
DELETE FROM problems WHERE program_id = '34c8b0fa-15c9-4533-ac78-7682b50793c1' AND problem_key = 'EX-ARITH-01' AND version = 1
  AND NOT EXISTS (SELECT 1 FROM learning_sessions ls WHERE ls.problem_id = problems.id)
  AND NOT EXISTS (SELECT 1 FROM learning_events le WHERE le.problem_id = problems.id);

WITH inserted AS (
  INSERT INTO problems (
    id, program_id, problem_key, version, domain, title, difficulty_level, full_text, definition, status
  )
  SELECT gen_random_uuid(), '34c8b0fa-15c9-4533-ac78-7682b50793c1', 'EX-ARITH-01', 1, 'PERCENT',
         'Simple arithmetic set A', 1, 'Five simple arithmetic questions. After all five, submit final answer 100.',
         '{"workspace_slots":["WHOLE","PART_IN_PERCENTAGE","PART_IN_NUMBER","FRACTION","RATIO","RELATIONAL_OPERATOR","UNKNOWN"],"steps":[{"step_pos":1,"token_id":"arith01-q1","correct_slot":"WHOLE","requires_revealed_chunk_index":0,"label":"3² + 10 = ?","options":[{"slot":"WHOLE","label":"19"},{"slot":"PART_IN_PERCENTAGE","label":"16","misconception_code":"WHOLE_PART_CONFUSION"},{"slot":"PART_IN_NUMBER","label":"13","misconception_code":"WHOLE_PART_CONFUSION"},{"slot":"UNKNOWN","label":"22","misconception_code":"WHOLE_PART_CONFUSION"}]},{"step_pos":2,"token_id":"arith01-q2","correct_slot":"PART_IN_PERCENTAGE","requires_revealed_chunk_index":0,"label":"8 × 3 − 4 = ?","options":[{"slot":"WHOLE","label":"24","misconception_code":"WHOLE_PART_CONFUSION"},{"slot":"PART_IN_PERCENTAGE","label":"20"},{"slot":"PART_IN_NUMBER","label":"12","misconception_code":"WHOLE_PART_CONFUSION"},{"slot":"UNKNOWN","label":"28","misconception_code":"WHOLE_PART_CONFUSION"}]},{"step_pos":3,"token_id":"arith01-q3","correct_slot":"PART_IN_NUMBER","requires_revealed_chunk_index":0,"label":"15 ÷ 3 + 2 = ?","options":[{"slot":"WHOLE","label":"5","misconception_code":"WHOLE_PART_CONFUSION"},{"slot":"PART_IN_PERCENTAGE","label":"10","misconception_code":"WHOLE_PART_CONFUSION"},{"slot":"PART_IN_NUMBER","label":"7"},{"slot":"UNKNOWN","label":"17","misconception_code":"WHOLE_PART_CONFUSION"}]},{"step_pos":4,"token_id":"arith01-q4","correct_slot":"FRACTION","requires_revealed_chunk_index":0,"label":"2³ − 1 = ?","options":[{"slot":"WHOLE","label":"8","misconception_code":"WHOLE_PART_CONFUSION"},{"slot":"PART_IN_PERCENTAGE","label":"5","misconception_code":"WHOLE_PART_CONFUSION"},{"slot":"FRACTION","label":"7"},{"slot":"UNKNOWN","label":"6","misconception_code":"WHOLE_PART_CONFUSION"}]},{"step_pos":5,"token_id":"arith01-q5","correct_slot":"RATIO","requires_revealed_chunk_index":0,"label":"(6 + 4) × 2 = ?","options":[{"slot":"WHOLE","label":"12","misconception_code":"WHOLE_PART_CONFUSION"},{"slot":"PART_IN_PERCENTAGE","label":"16","misconception_code":"WHOLE_PART_CONFUSION"},{"slot":"RATIO","label":"20"},{"slot":"UNKNOWN","label":"24","misconception_code":"WHOLE_PART_CONFUSION"}]}],"fact_establishments":[],"sufficiency_dependencies":[],"gates":[],"completion_rule":{"requires_slots_filled":["WHOLE","PART_IN_PERCENTAGE","PART_IN_NUMBER","FRACTION","RATIO"]},"expected_final_result":{"value":"100","unit":"done"}}'::jsonb, 'ACTIVE'
  WHERE NOT EXISTS (
    SELECT 1 FROM problems WHERE program_id = '34c8b0fa-15c9-4533-ac78-7682b50793c1' AND problem_key = 'EX-ARITH-01' AND version = 1
  )
  RETURNING id
)
INSERT INTO chunks (problem_id, order_index, chunk_type, content, semantic_definition)
SELECT id, 0, 'CONTEXT', 'Answer each arithmetic question in order. When all five are done, submit final answer 100.', '{"kind":"arithmetic_set","tokens":[{"token_id":"arith01-q1","text":"3² + 10 = ?","role":"QUESTION"},{"token_id":"arith01-q2","text":"8 × 3 − 4 = ?","role":"QUESTION"},{"token_id":"arith01-q3","text":"15 ÷ 3 + 2 = ?","role":"QUESTION"},{"token_id":"arith01-q4","text":"2³ − 1 = ?","role":"QUESTION"},{"token_id":"arith01-q5","text":"(6 + 4) × 2 = ?","role":"QUESTION"}]}'::jsonb FROM inserted;

-- 2) Upsert EX-ARITH-02 v1
-- Remove a prior draft of the same key/version if re-running (no sessions expected).
DELETE FROM chunks WHERE problem_id IN (
  SELECT id FROM problems WHERE program_id = '34c8b0fa-15c9-4533-ac78-7682b50793c1' AND problem_key = 'EX-ARITH-02' AND version = 1
    AND NOT EXISTS (SELECT 1 FROM learning_sessions ls WHERE ls.problem_id = problems.id)
    AND NOT EXISTS (SELECT 1 FROM learning_events le WHERE le.problem_id = problems.id)
);
DELETE FROM problems WHERE program_id = '34c8b0fa-15c9-4533-ac78-7682b50793c1' AND problem_key = 'EX-ARITH-02' AND version = 1
  AND NOT EXISTS (SELECT 1 FROM learning_sessions ls WHERE ls.problem_id = problems.id)
  AND NOT EXISTS (SELECT 1 FROM learning_events le WHERE le.problem_id = problems.id);

WITH inserted AS (
  INSERT INTO problems (
    id, program_id, problem_key, version, domain, title, difficulty_level, full_text, definition, status
  )
  SELECT gen_random_uuid(), '34c8b0fa-15c9-4533-ac78-7682b50793c1', 'EX-ARITH-02', 1, 'RATIO',
         'Simple arithmetic set B', 2, 'Five simple arithmetic questions. After all five, submit final answer 100.',
         '{"workspace_slots":["WHOLE","PART_IN_PERCENTAGE","PART_IN_NUMBER","FRACTION","RATIO","RELATIONAL_OPERATOR","UNKNOWN"],"steps":[{"step_pos":1,"token_id":"arith02-q1","correct_slot":"WHOLE","requires_revealed_chunk_index":0,"label":"5² − 6 = ?","options":[{"slot":"WHOLE","label":"19"},{"slot":"PART_IN_PERCENTAGE","label":"11","misconception_code":"WHOLE_PART_CONFUSION"},{"slot":"PART_IN_NUMBER","label":"31","misconception_code":"WHOLE_PART_CONFUSION"},{"slot":"UNKNOWN","label":"25","misconception_code":"WHOLE_PART_CONFUSION"}]},{"step_pos":2,"token_id":"arith02-q2","correct_slot":"PART_IN_PERCENTAGE","requires_revealed_chunk_index":0,"label":"9 + 3 × 2 = ?","options":[{"slot":"WHOLE","label":"24","misconception_code":"WHOLE_PART_CONFUSION"},{"slot":"PART_IN_PERCENTAGE","label":"15"},{"slot":"PART_IN_NUMBER","label":"12","misconception_code":"WHOLE_PART_CONFUSION"},{"slot":"UNKNOWN","label":"18","misconception_code":"WHOLE_PART_CONFUSION"}]},{"step_pos":3,"token_id":"arith02-q3","correct_slot":"PART_IN_NUMBER","requires_revealed_chunk_index":0,"label":"4² ÷ 2 = ?","options":[{"slot":"WHOLE","label":"16","misconception_code":"WHOLE_PART_CONFUSION"},{"slot":"PART_IN_PERCENTAGE","label":"4","misconception_code":"WHOLE_PART_CONFUSION"},{"slot":"PART_IN_NUMBER","label":"8"},{"slot":"UNKNOWN","label":"2","misconception_code":"WHOLE_PART_CONFUSION"}]},{"step_pos":4,"token_id":"arith02-q4","correct_slot":"FRACTION","requires_revealed_chunk_index":0,"label":"10 − 3² = ?","options":[{"slot":"WHOLE","label":"7","misconception_code":"WHOLE_PART_CONFUSION"},{"slot":"PART_IN_PERCENTAGE","label":"49","misconception_code":"WHOLE_PART_CONFUSION"},{"slot":"FRACTION","label":"1"},{"slot":"UNKNOWN","label":"13","misconception_code":"WHOLE_PART_CONFUSION"}]},{"step_pos":5,"token_id":"arith02-q5","correct_slot":"RATIO","requires_revealed_chunk_index":0,"label":"7 × 2 + 4 = ?","options":[{"slot":"WHOLE","label":"14","misconception_code":"WHOLE_PART_CONFUSION"},{"slot":"PART_IN_PERCENTAGE","label":"22","misconception_code":"WHOLE_PART_CONFUSION"},{"slot":"RATIO","label":"18"},{"slot":"UNKNOWN","label":"11","misconception_code":"WHOLE_PART_CONFUSION"}]}],"fact_establishments":[],"sufficiency_dependencies":[],"gates":[],"completion_rule":{"requires_slots_filled":["WHOLE","PART_IN_PERCENTAGE","PART_IN_NUMBER","FRACTION","RATIO"]},"expected_final_result":{"value":"100","unit":"done"}}'::jsonb, 'ACTIVE'
  WHERE NOT EXISTS (
    SELECT 1 FROM problems WHERE program_id = '34c8b0fa-15c9-4533-ac78-7682b50793c1' AND problem_key = 'EX-ARITH-02' AND version = 1
  )
  RETURNING id
)
INSERT INTO chunks (problem_id, order_index, chunk_type, content, semantic_definition)
SELECT id, 0, 'CONTEXT', 'Answer each arithmetic question in order. When all five are done, submit final answer 100.', '{"kind":"arithmetic_set","tokens":[{"token_id":"arith02-q1","text":"5² − 6 = ?","role":"QUESTION"},{"token_id":"arith02-q2","text":"9 + 3 × 2 = ?","role":"QUESTION"},{"token_id":"arith02-q3","text":"4² ÷ 2 = ?","role":"QUESTION"},{"token_id":"arith02-q4","text":"10 − 3² = ?","role":"QUESTION"},{"token_id":"arith02-q5","text":"7 × 2 + 4 = ?","role":"QUESTION"}]}'::jsonb FROM inserted;

-- 3) Ensure only the two arithmetic problems are ACTIVE among learner content
UPDATE problems
SET status = 'RETIRED'
WHERE program_id = '34c8b0fa-15c9-4533-ac78-7682b50793c1'
  AND problem_key IN ('EX-01','EX-02','EX-03','EX-04')
  AND status = 'ACTIVE';

-- Sanity check
SELECT problem_key, version, status, title, difficulty_level
FROM problems
WHERE program_id = '34c8b0fa-15c9-4533-ac78-7682b50793c1' AND status = 'ACTIVE'
ORDER BY difficulty_level, problem_key;

COMMIT;