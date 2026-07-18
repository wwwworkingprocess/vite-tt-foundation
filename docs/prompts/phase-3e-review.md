# Codex review — Phase 3E browser pacing and speed bonus

Read `AGENTS.md`, all project-foundation-linked documents, and the Phase
3E architecture/task documents.

Review actual implementation, deterministic arithmetic, tests, browser
driver, UI wiring, and Worker behavior rather than relying only on the
completion report.

## Verify

### Pure planner

1. simulation/protocol packages contain no pacing clock or browser APIs;
2. all authoritative advancement is whole ticks;
3. pacing inputs and credit are validated safe integers;
4. conservation invariants hold;
5. credit remains within documented bounds;
6. 20×/50×/60× examples are exact;
7. quiet-window and wrapping-range boundaries are correct;
8. bonus expiry inside one interval produces 5 ticks in the documented
   20×/2-bonus-tick example;
9. pulse partitioning produces equivalent plans;
10. day rollover does not change outcomes.

### Pacing controller

11. operations are FIFO serialized;
12. no command is sent when zero ticks are due;
13. one non-zero plan creates one batched command;
14. plan state commits only after an applied matching result;
15. rejection/error/mismatch consumes no bonus and enters failed/paused;
16. bonus grants add safely and overflow is rejected;
17. pause does not consume bonus;
18. timeline/session replacement resets runtime pacing and command IDs;
19. stale in-flight result cannot commit to a new timeline;
20. close is idempotent, terminal, and shared by concurrent callers;
21. public pacing projection has no writable Zustand API;
22. command IDs are deterministic and do not collide within one host.

### Browser driver

23. at most one pulse is in flight;
24. `requestAnimationFrame` loops cannot duplicate after restart;
25. hidden state cancels/reset baseline and causes no catch-up;
26. visibility resume starts with a fresh anchor;
27. elapsed intervals are integer microseconds and safety-capped;
28. stop/close cancels frames and removes listeners;
29. late frame or pulse completion after close is ignored.

### Integration and scope

30. app controller remains authoritative and read-only projection rules
    remain intact;
31. real Cypress uses the actual Worker and pacing driver;
32. controls are accessible and remain foundation instrumentation;
33. no pacing/bonus data was silently added to simulation saves;
34. coverage does not exclude planner/controller/driver production logic;
35. no ad SDK, autosave, Socket.IO, routes, vehicles, passengers, or
    economy mechanics were added.

Pay special attention to races:

- pause while a command is in flight;
- bonus grant while a command is in flight;
- restore while a pulse is awaiting a Worker result;
- close while the browser callback is awaiting;
- hidden transition during a pulse;
- command applied but projection update delivered before result;
- failure after credit planning but before authoritative application.

## Review behavior

- Add regression tests before evidence-based corrections.
- Keep fixes narrow and inside Phase 3E.
- Run full validation, coverage, independent builds, and real Worker
  Cypress.
- Report exact runtime and dependency versions.

Finish with:

```text
Verdict
Verified strengths
Findings and corrections
Planner/bonus validation
Controller/driver validation
Worker/browser validation
Deferred work
```
