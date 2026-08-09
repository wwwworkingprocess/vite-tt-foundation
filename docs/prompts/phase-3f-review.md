# Codex review — Phase 3F foundation template release

> **Document status:** Historical phase task/review prompt. Use only to
> reproduce or review the named phase. Current work follows `AGENTS.md`,
> [`../current-state.md`](../current-state.md), and the user's active request.

Read `AGENTS.md`, all project-foundation-linked documentation, all ADRs,
and the complete Phase 3F/template documentation.

Review actual source, tests, scripts, CI, production build, PWA behavior,
and release evidence. Do not rely only on the completion report.

## Reproducibility and CI

Verify:

1. exact Node `24.18.0` and Yarn `4.17.1` in CI;
2. runtime pins agree across repository files and manifest;
3. immutable clean install is tested;
4. Linux full validation and Windows portability subset are real;
5. CI does not depend on committed build/cache output;
6. evidence distinguishes local and CI results truthfully.

## Architecture

Verify:

7. simulation has no protocol/browser/Worker/Dexie/Zustand/React import;
8. no clocks, timers, or unseeded randomness enter simulation;
9. protocol remains JSON-safe and environment-neutral;
10. Worker APIs stay in Worker-specific paths;
11. public projections remain read-only;
12. no authoritative module-global singleton exists;
13. audits cannot trivially pass while boundaries are violated;
14. foundation production code contains no transport-domain model.

## Lifecycle

Verify:

15. full new/pacing/save/close/restore/pacing/close journey uses real Worker;
16. restore uses new timeline and resets host coordinates/history;
17. saved authoritative state survives;
18. pacing runtime state resets;
19. cleanup is terminal and leak-free;
20. direct/Worker critical parity remains tested.

## PWA/offline

Verify:

21. production build and actual service worker are used;
22. first load online and second load offline;
23. shell and dedicated Worker chunk are cached;
24. IndexedDB save is listable/restorable offline;
25. no background catch-up was introduced;
26. update behavior is documented;
27. tests are not passing against the dev server.

## Build and warnings

Verify:

28. budgets inspect actual hashed production artifacts;
29. Worker is emitted separately;
30. budgets are deliberate rather than just above current sizes;
31. project-owned warnings are resolved;
32. third-party warnings are attributable and documented;
33. no lockfile/generated-output churn is hidden.

## Template handoff

Verify:

34. `foundation-template.json` is schema-validated;
35. versions, paths, and commands match the repository;
36. clone guide separates rename surfaces from protected schema IDs;
37. domain extension guide preserves ownership;
38. archive exclusions are complete;
39. Phase 3 status is consistent;
40. no Phase 4 domain code entered.

Pay attention to service-worker updates, stale cached Worker chunks,
IndexedDB cleanup, Windows path normalization, hashed chunk matching, and
CI cache masking.

Add regression tests before narrow corrections. Do not begin Phase 4.
Run all available validation and verify CI separately.

Finish with:

```text
Verdict
Verified strengths
Findings and corrections
Pinned-runtime/CI validation
Architecture/template validation
Lifecycle/PWA offline validation
Build/warning validation
Deferred work
```
