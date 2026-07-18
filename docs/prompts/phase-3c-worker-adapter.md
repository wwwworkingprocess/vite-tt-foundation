# Codex task — Phase 3C typed dedicated Worker adapter

Read `AGENTS.md` and all documentation linked from
`docs/project-foundation.md`.

Also read:

- `docs/architecture/time-model.md`;
- `docs/architecture/transport-contract.md`;
- `docs/architecture/foundation-host-model.md`;
- `docs/architecture/worker-adapter-model.md`;
- `docs/development/testing-strategy.md`;
- `docs/development/phase-3c-worker-adapter.md`;
- `docs/development/definition-of-done.md`.

Before editing:

1. inspect repository and Git state;
2. confirm Phase 3B and all corrections are present;
3. confirm the current suite is green;
4. state the narrow TDD plan.

Implement Phase 3C exactly as defined in
`docs/development/phase-3c-worker-adapter.md`.

## Mandatory constraints

- Start with failing shared-contract and Worker-failure tests.
- Keep simulation independent of protocol and Worker APIs.
- Host the accepted in-memory host inside the Worker.
- Do not duplicate host/simulation rules.
- Use one shared client contract for direct and Worker adapters.
- Validate both sides of the Worker boundary.
- Revalidate and deeply freeze received values after structured clone.
- Use monotonic adapter-local request IDs, not random IDs.
- Keep command results out of general subscriptions.
- Preserve reliable versus replaceable output semantics.
- Reject all pending work on terminal failure or close.
- Install Worker listeners once and remove them on close.
- Do not add restart, retry, scheduling, persistence, Zustand, Socket.IO,
  game mechanics, or gameplay UI.
- Do not build a generic RPC framework.
- Keep documentation changes narrow.
- Maintain coverage thresholds.

## Browser requirement

Use a real Vite dedicated Worker and extend Cypress to prove readiness,
one command advancement, result/update delivery, no fatal error, and
cleanup.

A minimal foundation status surface is allowed.

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

Also run focused direct-client, Worker-client/runtime, and browser smoke
tests.

Report exact Node, Yarn, Cypress, and browser versions. Do not claim the
pinned Node runtime when another version was used.

Finish with:

```text
Summary
Changed
TDD and coverage
Worker contract and browser smoke
Validation commands and outcomes
Acceptance criteria status
Intentionally deferred work
```
