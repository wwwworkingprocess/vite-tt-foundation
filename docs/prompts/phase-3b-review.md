# Codex review — Phase 3B in-memory foundation host

> **Document status:** Historical phase task/review prompt. Use only to
> reproduce or review the named phase. Current work follows `AGENTS.md`,
> [`../current-state.md`](../current-state.md), and the user's active request.

Read `AGENTS.md`, all documentation linked from
`docs/project-foundation.md`, and the Phase 3B architecture and task
documents.

Review the actual implementation and tests. Do not rely only on the
completion report.

## Review focus

Verify:

1. `packages/simulation` remains independent of `packages/protocol`;
2. the foundation command is simulation-owned, pure, and deterministic;
3. host code is browser-neutral and contains no Worker, timer, Dexie,
   Zustand, React, R3F, or Socket.IO usage;
4. accepted commands increment `CommandRevision`, `StreamOffset`, and
   `RenderSnapshotSequence` exactly once;
5. rejected, duplicate, and conflicting commands mutate nothing;
6. same-ID equivalent retries ignore diagnostic/session metadata;
7. command-ID conflicts compare stable normalized intent;
8. command results are returned directly and are not duplicated through
   general subscriptions;
9. reliable updates and render snapshots use separate subscriptions and
   semantics;
10. synchronization uses `TimelineId` and `StreamOffset`, never render
    sequence continuity;
11. full and delta responses are internally coordinate-consistent;
12. subscription cleanup is idempotent and listener failures are isolated;
13. every public wire value is runtime-validated and JSON-safe;
14. tests assert behavior and invariants rather than implementation
    details;
15. coverage configuration has not hidden production code;
16. no Phase 3C+ work was introduced.

Pay special attention to conservation and monotonicity invariants and to
off-by-one behavior at initial position zero.

## Review behavior

- State verified findings with file references.
- Make only narrow corrections supported by evidence.
- Do not broaden scope.
- Run the full validation and coverage suite after corrections.
- Report exact Node and Yarn versions.

Finish with:

```text
Verdict
Verified strengths
Findings and corrections
Validation
Deferred work
```
