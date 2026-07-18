# Foundation Template v1.0.0 — Release Evidence

## Status

Local release gates pass under Node 24.13.0. Foundation Template v1.0.0 remains
a release candidate until the exact Node 24.18.0 Linux and Windows workflows
pass for the final commit.

## Source identity

```text
Base Git commit: fb11eb8fb8a96498850f06ece2ecac7e45fefde8
Git tag: unavailable; no release tag was created
Working tree clean: no; Phase 3F release-candidate changes are uncommitted
```

## Toolchain

```text
Node: 24.13.0 locally (pinned 24.18.0; exact-runtime claim unavailable)
Yarn: 4.17.1
TypeScript: 6.0.3
Vite: 8.1.5
Vitest: 4.1.10
Cypress: 15.18.1
Browser: Electron 138 headless
React: 19.2.7
React Three Fiber: 9.6.1
Three.js: 0.185.1
Zustand: 5.0.14
Dexie: 4.4.4
Service-worker tooling: vite-plugin-pwa 1.3.0 / Workbox 7.4.1 generated service worker
```

## Local evidence

```text
Immutable install: passed with Yarn's existing optional peer-dependency warning
Format: passed
Lint: passed
Typecheck: passed
Tests: passed
Coverage: passed at or above 95/95/95/90
Build: passed, warning-clean under reviewed budgets
Independent simulation: passed
Independent protocol: passed
Real Worker E2E: passed
Production PWA offline E2E: passed
Architecture audit: passed
Template-manifest audit: passed
Bundle-budget audit: passed
git diff --check: passed
```

## CI evidence

```text
Linux pinned-runtime workflow: configured; not executed from this workspace
Windows portability workflow: configured; not executed from this workspace
Commit/workflow run: unavailable
```

## PWA/offline evidence

The Vite production build was served at `http://127.0.0.1:4174`. Cypress warmed
cleared the origin's service workers, caches, and IndexedDB, verified zero saves,
warmed the generated service worker online, advanced and paused the real Worker,
recorded the exact tick, and saved it to IndexedDB. It then enabled browser
offline emulation, reloaded the precached shell, fetched both PWA icons offline,
started the precached dedicated Worker, and restored the record under a new
timeline. The exact tick was restored with CommandRevision and StreamOffset zero;
pacing was paused with zero credit and bonus before advancing again and closing.
`autoUpdate` registers the generated revisioned
precache and activates an available update; no background simulation catch-up
or data synchronization is performed.

## Bundle budgets

Application entry: 385,083 / 400,000 bytes — passed.
Lazy representation/R3F chunk: 880,881 / 1,200,000 bytes — passed.
Dedicated Worker: 78,776 / 100,000 bytes — passed.
Total emitted JavaScript: 1,344,740 / 1,500,000 bytes — passed.
Hashed artifacts are classified by stable chunk prefixes. The representation and
Worker are separate emitted chunks and production source maps are absent.

## Warning disposition

The previous Vite 500 kB advisory is replaced by explicit reviewed budgets and
the production build is warning-clean. A `THREE.Clock` deprecation warning is
emitted by React Three Fiber/Three.js during the browser smoke path, not by a
project-owned `Clock` use. It does not affect authoritative time or pacing and
will be removed when the compatible R3F dependency stops using the deprecated
API. jsdom-only custom-element casing diagnostics likewise originate from the
test representation boundary and do not occur in the production browser.
The immutable install reports Yarn YN0086 for optional peer surfaces; inspection
identifies the only unmet peer as transitive `tunnel-rat`/Zustand React metadata.
React is supplied by the web workspace, builds and browser tests pass, and the
warning can be removed when the upstream R3F dependency metadata is corrected.

## Template audit

```text
Manifest schema valid: passed through strict Zod validation against the documented shape
Foundation paths exist: passed
Runtime pins consistent: passed
Validation commands exist: passed
Archive exclusions complete: passed
Domain-free audit: passed in Git-free archive mode with regression fixtures
Git tracked-output audit: passed separately
Rename guide reviewed: passed
Extension guide reviewed: passed
```

## Limitations

- Exact Node 24.18.0 local validation was unavailable; local evidence uses 24.13.0.
- GitHub Actions Linux and Windows jobs have not run for these uncommitted changes.
- No tag or final release commit exists yet.
