# Long-running user journeys

`catalog.ts` is the single typed catalog for long, stateful journeys. Each entry
contains a stable ID, title, ordered steps, invariants, AC/SCN references, and
whether the journey also has a mobile representation.

The backend runner builds the real Fastify application with `buildApp()`, sends
requests through `app.inject`, authenticates with Better Auth cookies, and uses
the integration suite's real PostgreSQL migration and canonical seed setup. It
does not mock the application API or database. After every HTTP step it checks
that only a contiguous prefix of visible chunks was returned and that no raw
definition or complete problem text leaked.

Run the catalog separately:

```bash
npm run test:scenarios
```

It is part of `npm run verify`, after the existing integration suite, but not
`npm run check` because all 24 scenarios intentionally perform long,
multi-problem real-database journeys.

## Adding a scenario

1. Add one `Scenario` entry to `scenarioCatalog`.
2. Compose it from the typed public operations (`register`, `login`, `logout`,
   `startSession`, `submitAction`, state/rejection checks, restart, concurrency,
   activation, and DB assertions).
3. Cite every applicable AC/SCN ID and list the invariants the journey proves.
4. Mark `mobile: true` only when native UI/lifecycle behavior adds evidence.
5. For a mobile journey, add the corresponding YAML under
   `maestro/flows/scenarios/`; do not mirror pure concurrency or transaction
   mechanics on-device.

Failures include the scenario ID, one-based step index, step type, and exact
expected/actual mismatch. There are no sleeps, soft assertions, warning passes,
or direct reasoning decisions in the client.
