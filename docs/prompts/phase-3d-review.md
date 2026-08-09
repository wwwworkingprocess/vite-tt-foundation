# Codex review — Phase 3D persistence and application bridge

> **Document status:** Historical phase task/review prompt. Use only to
> reproduce or review the named phase. Current work follows `AGENTS.md`,
> [`../current-state.md`](../current-state.md), and the user's active request.

Read `AGENTS.md`, all project-foundation-linked documents, and all Phase
3D architecture/task documents.

Review actual implementation, schemas, database behavior, state
ownership, and tests rather than relying only on the report.

## Verify

### Simulation snapshot

1. simulation imports no Dexie, Zustand, Worker, DOM, or application code;
2. snapshot version/schema is explicit;
3. parse/create/restore are pure and deeply immutable;
4. malformed, unsafe, unknown-version, and overflow data is rejected.

### Export and restore

5. snapshot export is serialized through the host command queue;
6. before/after command ordering is tested;
7. direct and Worker adapters share export/restore contract behavior;
8. Worker values are validated and refrozen after cloning;
9. restore uses saved simulation state but a different timeline;
10. revision/offset/render sequence and retained history reset to zero;
11. old command IDs cannot resolve from pre-restore retained results.

### Repository

12. one contract suite runs against in-memory and Dexie repositories;
13. database names are injected and tests are isolated;
14. no module-global Dexie singleton exists;
15. writes and reads are runtime-validated;
16. returned values and nested snapshots are deeply immutable;
17. list ordering is deterministic;
18. corrupted raw IndexedDB records fail explicitly;
19. close/delete behavior leaves no leaked database handles;
20. coverage does not exclude persistence production code.

### Zustand bridge/controller

21. vanilla store holds projection only;
22. no store action mutates authoritative simulation coordinates;
23. subscriptions are installed before connect;
24. reliable offsets apply contiguously, duplicates are ignored, and gaps
    require synchronization;
25. render snapshots use latest-compatible semantics independently;
26. save uses authoritative queued snapshot export;
27. restore closes/replaces the old client and performs full sync;
28. controller operations are FIFO serialized;
29. close is idempotent and terminal;
30. failed operations cannot leave false ready/saving/restoring state;
31. state and save summaries exposed to consumers are deeply immutable.

### Scope

32. no timers, scheduler, autosave, React UI, persist middleware,
    Socket.IO, route data, or game mechanics were introduced;
33. real Worker Cypress smoke remains valid.

Pay special attention to races:

- command queued around snapshot export;
- close during save;
- restore during save;
- repository write succeeds but summary refresh fails;
- old-client late publication after restore;
- Worker response after controller swaps clients;
- failed restore after old client closure;
- corrupted save loaded for restore;
- same-timeline restore attempt.

## Review behavior

- Add regression tests before correcting verified issues.
- Make only narrow evidence-based corrections.
- Do not expand into Phase 3E.
- Run full validation, coverage, independent builds, repository tests, and
  real Worker Cypress smoke.
- Report exact runtime and dependency versions.

Finish with:

```text
Verdict
Verified strengths
Findings and corrections
Snapshot/restore validation
Repository/IndexedDB validation
Store/controller validation
Browser validation
Deferred work
```
