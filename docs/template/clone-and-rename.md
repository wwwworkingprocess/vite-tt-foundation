# Clone and Rename Guide

## Purpose

Use this guide after copying the accepted Phase 3 repository state to
start a compatible browser game.

## Rename checklist

1. repository folder and Git remote;
2. root package name;
3. workspace package namespace currently using `@torrevieja-tycoon/*`;
4. package imports and exports;
5. visible title and copy;
6. PWA name, short name, description, icons, theme, and screenshots;
7. shell-only default game/timeline/client IDs;
8. README identity;
9. CI artifact names;
10. clone metadata while preserving upstream template version.

Bootstrap an extracted template with `corepack yarn install --immutable`, then
run the single authoritative post-install command: `corepack yarn
validate:portable`. It works without `.git` and covers the pinned runtime,
architecture and manifest audits, formatting, lint, types, unit tests,
coverage, build budgets, the browser smoke test, and root plus repository-
subpath offline PWA tests. Run `corepack yarn validate:repository` only in the
release repository; it checks tracked output and requires Git history.

For repository-subpath hosting, set `VITE_BASE_PATH` to a leading- and
trailing-slash path such as `/my-game/`. The manifest, icons, Worker, lazy
chunks, service worker, and precache are derived from that Vite base.

## Protected compatibility surfaces

Do not blindly search-and-replace:

```text
foundation-command
foundation-command-result
foundation-simulation-snapshot
foundation-save-record
foundation-synchronization-response
```

These are infrastructure/schema identities and may remain unchanged.

`protocolContractVersion` and `foundationWorkerAdapterContractVersion` are
source/API compatibility markers. They are not serialized wire-schema fields
and do not claim runtime negotiation. Snapshot and save-record schema versions
remain serialized, validated schema guarantees.

## First clone commit

The first clone commit should contain only identity/branding changes and
keep all tests green. Add domain work in the next commit so template reuse
issues remain distinguishable from game defects.

## Archive hygiene

Never copy:

```text
.git
node_modules
dist
coverage
.vite
Cypress artifacts
temporary IndexedDB files
local environment files
editor caches
```

## Provenance

Record template version, source commit/tag, clone date, chosen namespace,
and deliberate deviations from the compatibility contract.
