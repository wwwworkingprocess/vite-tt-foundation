# Codex review — Phase 3C typed dedicated Worker adapter

> **Document status:** Historical phase task/review prompt. Use only to
> reproduce or review the named phase. Current work follows `AGENTS.md`,
> [`../current-state.md`](../current-state.md), and the user's active request.

Read `AGENTS.md`, all foundation-linked documentation, and the Phase 3C
architecture/task documents.

Review actual implementation and tests, not only the report.

## Verify

1. simulation has no protocol/Worker/browser dependency;
2. Worker runtime creates and delegates to the accepted host;
3. direct and Worker clients implement one contract;
4. one real shared suite runs against both;
5. Worker wrappers do not leak into simulation/domain contracts;
6. all Worker values are runtime-validated;
7. cloned public values are deeply frozen before application delivery;
8. command results settle promises only;
9. reliable and render ordering are preserved;
10. request IDs are local, monotonic, and not command IDs;
11. unknown/duplicate response IDs cannot settle unrelated promises;
12. malformed messages cannot leave promises pending;
13. startup/crash/messageerror/close reject pending work exactly once;
14. close is idempotent, removes listeners, and terminates once;
15. no delivery occurs after close;
16. listener/diagnostic failures remain isolated;
17. Cypress uses an actual bundled Worker;
18. coverage does not hide Worker production logic;
19. no scheduler, persistence, Zustand, Socket.IO, or game mechanics.

Pay special attention to races:

- response during close;
- failure during initialization;
- publication before command result;
- reentrant submission from a listener;
- duplicate Worker delivery;
- late message after close.

Add regression tests before corrections. Keep fixes narrow. Run full
validation and report exact Node, Yarn, Cypress, and browser versions.

Finish with:

```text
Verdict
Verified strengths
Findings and corrections
Worker/browser validation
Deferred work
```
