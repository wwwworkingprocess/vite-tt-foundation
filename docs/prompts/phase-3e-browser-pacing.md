# Codex task — Phase 3E browser pacing and speed bonus

Read `AGENTS.md` and every document linked from
`docs/project-foundation.md`.

Also read:

- `docs/architecture/time-model.md`;
- `docs/architecture/foundation-host-model.md`;
- `docs/architecture/worker-adapter-model.md`;
- `docs/architecture/persistence-and-app-bridge.md`;
- `docs/architecture/browser-pacing-model.md`;
- `docs/architecture/decisions/0005-browser-pacing-and-speed-bonus.md`;
- `docs/development/testing-strategy.md`;
- `docs/development/phase-3e-browser-pacing.md`;
- `docs/development/definition-of-done.md`.

Before editing:

1. inspect repository and Git state;
2. confirm Phase 3D and final controller corrections are present;
3. confirm the current suite is green;
4. state the milestone-based TDD plan.

Implement Phase 3E exactly as defined in
`docs/development/phase-3e-browser-pacing.md`.

## Mandatory constraints

- Start every milestone with failing behavioral tests.
- Keep simulation/protocol free of browser scheduling APIs.
- Advance only whole simulation ticks.
- Use integer pacing microseconds and integer game-microsecond credit.
- Process quiet-window and bonus expiry at exact tick boundaries.
- Preserve:
  bonusTicksAdvanced + regularTicksAdvanced === advancedTicks.
- Commit credit and bonus consumption only after an applied authoritative
  result with the expected resulting tick.
- Serialize mode changes, bonus grants, pulses, pause, and close.
- Permit at most one browser pulse in flight.
- Reset the browser baseline when hidden; do not catch up hidden time.
- Reset runtime pacing state on timeline/session replacement.
- Use generation checks so stale pulse results cannot affect a new
  session.
- Use deterministic local pacing command identifiers, never random IDs.
- Keep writable Zustand stores private.
- Do not persist playback/bonus state in Phase 3E.
- Do not add ad SDKs, timers in simulation, autosave, Socket.IO, routes,
  vehicles, passengers, or game mechanics.
- Do not add a generic scheduler framework.
- Maintain coverage thresholds.

## Browser requirement

Extend the existing real Worker Cypress flow to verify:

- session ready;
- selecting speed advances ticks;
- pause prevents further advancement over a bounded observation;
- demo 2× bonus changes the effective rate and its remaining tick count
  decreases;
- no fatal page/Worker errors;
- cleanup stops pacing and terminates resources.

Avoid brittle exact-duration assertions in Cypress. Exact arithmetic
belongs in deterministic unit tests.

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
git diff --check
```

Also run focused planner, pacing-controller, browser-driver, application,
and Worker/browser suites.

Report exact Node, Yarn, Cypress, browser, React, Zustand, and Vite
versions. Do not claim validation under pinned Node when a different
runtime was used.

Finish with:

```text
Summary
Changed
TDD and coverage
Pacing arithmetic and bonus semantics
Browser driver and visibility behavior
Worker/browser integration
Validation commands and outcomes
Acceptance criteria status
Intentionally deferred work
```
