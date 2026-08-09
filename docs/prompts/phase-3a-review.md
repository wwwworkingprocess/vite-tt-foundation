# Codex Review Task — Phase 3A

> **Document status:** Historical phase task/review prompt. Use only to
> reproduce or review the named phase. Current work follows `AGENTS.md`,
> [`../current-state.md`](../current-state.md), and the user's active request.

Read `AGENTS.md`, all documentation linked from `docs/project-foundation.md`, and `docs/prompts/phase-3a-time-foundation.md`.

Review the completed Phase 3A implementation independently before making edits.

Check specifically:

- the simulation uses only whole five-second ticks;
- integer validation rejects negative, fractional, non-finite, and unsafe values;
- genesis conversion is exact and timezone-independent;
- playback and speed-bonus logic is outside authoritative simulation state;
- 720 ticks at 20x equals 180 seconds;
- 720 ticks at 40x equals 90 seconds;
- 1,440 ticks at 40x equals 180 seconds;
- pause does not consume bonus ticks;
- bonus-expiry crossings are handled exactly;
- tick advancement does not change command revision;
- simulation, protocol, and application dependency boundaries remain intact;
- tests assert meaningful behaviour and invariants;
- coverage thresholds are not met through broad exclusions or trivial execution-only tests;
- no Worker, persistence, networking, or transport-game mechanics were added.

Run all standard validation and coverage commands. Fix only verified Phase 3A defects and documentation inconsistencies. Do not expand scope.

Finish with:

```text
Review verdict
Findings
Corrections made
Validation
Remaining risks and deferred work
```
