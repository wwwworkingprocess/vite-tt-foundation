# Codex task — Phase 3B in-memory foundation host

Read `AGENTS.md` and every document linked from
`docs/project-foundation.md`.

Also read:

- `docs/architecture/time-model.md`;
- `docs/architecture/transport-contract.md`;
- `docs/architecture/foundation-host-model.md`;
- `docs/development/testing-strategy.md`;
- `docs/development/phase-3b-in-memory-host.md`;
- `docs/development/definition-of-done.md`.

Before editing:

1. inspect the repository and Git state;
2. confirm the final Phase 3A correction is present:
   `consumeSpeedBonusForAdvancedTicks` has no pause parameter and
   conserves all already-advanced ticks;
3. run or inspect the existing tests sufficiently to establish the
   starting state;
4. briefly state the narrow TDD implementation plan.

Implement Phase 3B exactly as defined in
`docs/development/phase-3b-in-memory-host.md`.

## Mandatory constraints

- Begin with failing public-behavior tests and report the red state.
- Keep `packages/simulation` independent of `packages/protocol`.
- Keep the host browser-neutral.
- The host may call pure simulation APIs but may not duplicate simulation
  rules.
- Use injected identities; do not generate random IDs.
- Keep command results out of general update subscriptions.
- Keep reliable updates separate from replaceable render snapshots.
- Do not use a render sequence for synchronization.
- Do not install new infrastructure or networking dependencies.
- Do not add Worker, persistence, Zustand, timers, React, or game
  mechanics.
- Avoid speculative generic abstractions beyond the one foundation
  command and its concrete contracts.
- Maintain the existing coverage thresholds.
- Update documentation only where implementation decisions require
  precise status or terminology changes.

## Validation

Run at least:

```text
yarn install --immutable
yarn format:check
yarn lint
yarn typecheck
yarn test
yarn test:coverage
yarn build
yarn test:e2e
yarn workspace @torrevieja-tycoon/simulation test
yarn workspace @torrevieja-tycoon/protocol test
yarn workspace @torrevieja-tycoon/simulation build
yarn workspace @torrevieja-tycoon/protocol build
```

Also run focused host tests and independent coverage commands where
available.

Report the exact Node and Yarn versions used. Do not claim validation
under the pinned Node runtime when a different runtime was used.

Finish with:

```text
Summary
Changed
TDD and coverage
Validation commands and outcomes
Acceptance criteria status
Intentionally deferred work
```
