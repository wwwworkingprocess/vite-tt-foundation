# Codex task — Phase 3F foundation hardening and template release

Read `AGENTS.md` and every document linked from
`docs/project-foundation.md`.

Also read:

- all architecture ADRs through ADR 0006;
- `docs/architecture/foundation-template-contract.md`;
- `docs/development/testing-strategy.md`;
- `docs/development/phase-3f-foundation-template-release.md`;
- `docs/development/definition-of-done.md`;
- `docs/template/clone-and-rename.md`;
- `docs/template/domain-extension-guide.md`.

Before editing:

1. inspect repository and Git state;
2. confirm final Phase 3E corrections are present;
3. run or inspect the current baseline;
4. inspect CI, PWA configuration, build output, warnings, package
   boundaries, public APIs, and committed/generated files;
5. state the milestone-based audit/TDD plan.

Implement Phase 3F exactly as defined in
`docs/development/phase-3f-foundation-template-release.md`.

## Mandatory constraints

- Treat this as release hardening, not a feature phase.
- Add failing audits/tests before corrections.
- Validate under exact Node `24.18.0` in CI.
- Preserve Yarn `4.17.1` and immutable lockfile behavior.
- Keep CI useful but not needlessly combinatorial.
- Prefer existing ESLint/TypeScript/test infrastructure.
- Add only small deterministic audit scripts when current tooling cannot
  express a rule.
- Keep simulation and protocol environment-neutral.
- Prove foundation production code is transport-domain-free.
- Do not rename the package namespace in this phase.
- Do not change persisted/protocol discriminators for branding.
- Run a real built-PWA offline test including Worker startup and saved
  record restoration.
- Do not implement offline simulation catch-up.
- Make build budgets explicit; do not silence arbitrary warnings.
- Validate the machine-readable template manifest.
- Produce factual release evidence with exact versions and unavailable
  evidence clearly marked.
- Do not add any Phase 4 entity, command, data, or mechanic.
- Maintain coverage thresholds.

## CI expectations

At minimum:

- Linux: full install, format, lint, typecheck, test, coverage, build, E2E;
- Windows: immutable install plus portability validation subset;
- exact pinned Node/Yarn;
- cache use must not make correctness depend on stale outputs.

## Validation

Run the complete validation command plus focused audits. At minimum, where
locally available:

```text
corepack yarn install --immutable
corepack yarn format:check
corepack yarn lint
corepack yarn typecheck
corepack yarn test
corepack yarn test:coverage
corepack yarn build
corepack yarn test:e2e
corepack yarn workspace @torrevieja-tycoon/simulation test
corepack yarn workspace @torrevieja-tycoon/protocol test
corepack yarn workspace @torrevieja-tycoon/simulation build
corepack yarn workspace @torrevieja-tycoon/protocol build
git diff --check
```

Also run:

- architecture/domain audit;
- template-manifest validation;
- build-budget audit;
- production PWA offline E2E;
- cross-layer lifecycle acceptance suite.

Do not claim CI completion until the workflow actually passes.

Finish with the exact report format from the phase document.
