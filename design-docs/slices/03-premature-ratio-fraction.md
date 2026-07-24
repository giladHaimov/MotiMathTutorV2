# Slice 03 — Semantic Sufficiency: Ratio and Fraction

## Purpose

Implement premature-commitment detection, insufficient-information acknowledgment, and EX-02/EX-03.

## Product scope

PB-009–PB-013, PB-034–PB-038.

## Acceptance scope

AC-028–AC-031, AC-037–AC-038.

## Journeys

### EX-02

```text
reveal ratio
→ attempt numeric answer before scale
→ block as PREMATURE_QUANTIFICATION
→ acknowledge insufficient information
→ reveal scale
→ identify Unknown
→ answer 10
```

### EX-03

```text
reveal 3/5 without Whole
→ block page calculation
→ reveal 50-page Whole
→ identify unread complement
→ reject 3/5 as remaining fraction
→ answer 20
```

## In scope

- Data-driven semantic dependency checks.
- `ACKNOWLEDGE_INSUFFICIENT_INFORMATION`.
- Deterministic misconception classification for premature and complement errors.
- EX-02 and EX-03 fixtures/UI flows.
- Appropriate learning events.

## Explicit non-goals

- Repeated-error rollback depth.
- Native packaging.
- Analytics dashboard.

## Primary tables

- `problems`, `chunks`, `misconception_classes`;
- `learning_sessions`, `stage_attempts`, `learning_events`.

## Required tests

- Same state/action always yields same classification.
- Premature actions do not advance state.
- Acknowledgment requirement cannot be bypassed.
- EX-02 completes with 10.
- EX-03 completes with 20.
- Invalid complement remains blocked.
- Restart/resume during blocked state.

## Definition of done

- EX-02 and EX-03 pass through real API/DB/browser.
- No problem-specific if/else exists outside data-driven engine rules unless explicitly justified.
- `npm run verify` passes.
