# Slice 04 — Conflict Deletion, Repetition, and Deterministic Rollback

## Purpose

Complete EX-04 and the deterministic rollback controller.

## Product scope

PB-006–PB-014, PB-018, PB-028.

## Acceptance scope

AC-025–AC-032, AC-039, AC-044.

## User journey

```text
EX-01
→ place 40 in Part-in-number
→ rejected/classified
→ attempt 30% in Whole
→ rejected/conflict remains
→ explicitly delete assignment
→ repeat equivalent error
→ deterministic rollback/guidance
→ recover and continue
```

## In scope

- Complete conflict-state semantics.
- Explicit deletion action.
- Misconception repetition counting.
- `rollback_rules` lookup.
- Rollback state transition.
- Atomic `rollback_logs`.
- Guidance-code response.
- EX-04 browser flow.

## Explicit non-goals

- ML adaptation.
- Cross-session personalization.
- Teacher analytics.

## Primary tables

- `misconception_classes`;
- `rollback_rules`;
- `learning_sessions`;
- `stage_attempts`;
- `learning_events`;
- `rollback_logs`.

## Required tests

- Conflict blocks progression.
- Local UI removal without server deletion does not unblock.
- Repeated equivalent error triggers exact rule.
- Duplicate action creates one rollback.
- Forced failure creates neither partial rollback nor partial state.
- Rollback target is valid and resumable.
- EX-04 passes end to end.

## Definition of done

- Rollback is deterministic and fixture-defined.
- EX-04 passes.
- `npm run verify` passes.
