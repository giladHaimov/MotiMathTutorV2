# Slice 02 — Percentage Flow: Progressive Reveal and Typed Workspace

## Purpose

Implement the complete EX-01 percentage journey and establish the general typed-workspace/gating pattern.

## Product scope

PB-001–PB-008, PB-034–PB-037, PB-045–PB-049.

## Acceptance scope

AC-008–AC-014, AC-024–AC-027, AC-033–AC-036.

## User journey

```text
login
→ start EX-01
→ assign 40 students to Whole
→ reveal percentage chunk
→ assign 30% and subset
→ reveal question
→ identify Part-in-number as Unknown
→ submit 12
→ complete
```

## Failure journey

```text
assign 30% to Whole
→ server rejects
→ progression remains blocked
→ explicit deletion/recovery
```

## In scope

- Generic typed workspace representation.
- Slot-assignment and deletion actions.
- Commitment gates.
- Reveal calculation.
- Final-answer availability.
- EX-01 full fixture.
- Client ProblemScreen for the complete EX-01 journey.
- Unit, integration, and Playwright coverage.

## Explicit non-goals

- Ratio-specific sufficiency.
- Fraction complement.
- Repeated-error rollback.
- Native packaging.

## Primary tables

- `problems`, `chunks`;
- `learning_sessions`;
- `stage_attempts`;
- `learning_events`.

## Required tests

- EX-01 happy path result 12.
- Wrong typed slot rejected.
- State does not advance on invalid action.
- Full problem never appears prematurely.
- Conflict requires server-confirmed deletion.
- Final answer unavailable before structural gates.
- Refresh during each stage resumes correctly.

## Definition of done

- EX-01 passes as real browser journey.
- Generic implementation is data-driven by fixture definitions, not hardcoded route logic.
- `npm run verify` passes.
