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

Run the complete validation suite after namespace-wide changes.

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
