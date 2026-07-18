# Foundation Template v1.0.0 — Release Evidence

## Status

Foundation Template v1.0.0 remains a release candidate. Pinned Linux and
Windows validation and GitHub Pages deployment are green. Final release still
requires manual real-device HTTPS validation and explicit approval to create
the tag.

## Source identity

```text
Candidate implementation and deployment commit: 7ad5320d162c1eb772d369bb7fd8250d1aa4fcd3
Git tag: unavailable; no release tag was created
Evidence update: this document's follow-up commit
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
Authoritative portable command: blocked only by the local Node 24.13.0 runtime audit; all subsequent stages passed independently
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
Architecture audit: passed, including TypeScript-AST authority/store provenance, alias, namespace, writable-exposure, and Node built-in fixtures
Template-manifest audit: passed
Bundle-budget audit: passed
git diff --check: passed
```

## CI evidence

```text
Validation commit: 7ad5320d162c1eb772d369bb7fd8250d1aa4fcd3
Validation run 29664844694: success
linux-full job 88133423858: success
windows-portability job 88133423837: success
linux-archive-portability job 88133525195: success
Pages run 29664947169, deploy job 88133693594: success
Deployed URL: https://wwwworkingprocess.github.io/vite-tt-foundation/
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

The same offline lifecycle spec also passed against the deployed HTTPS origin
with Cypress 15.18.1 and Electron 138. Direct HTTPS checks returned 200 for the
application shell, manifest, both icons, registration script, service worker,
Workbox file, application entry, lazy representation chunk, and dedicated
Worker chunk. A live browser session reached Worker `ready`, advanced and
paused pacing, saved tick 39, and restored tick 39 under a new timeline with
CommandRevision, StreamOffset, pacing credit, and bonus reset to zero.

## Bundle budgets

Application entry: 385,083 / 400,000 bytes — passed.
Lazy representation/R3F chunk: 880,881 / 1,200,000 bytes — passed.
Dedicated Worker: 78,776 / 100,000 bytes — passed.
Total emitted JavaScript, including registerSW, service worker, and Workbox: 1,361,349 / 1,550,000 bytes — passed.
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
GitHub annotates the otherwise successful workflows because the supported
`actions/upload-artifact@v4`, `actions/download-artifact@v4`,
`actions/configure-pages@v5`, `actions/deploy-pages@v4`, and the upload action
embedded by `actions/upload-pages-artifact@v4` still declare Node 20 action
runtimes. GitHub forced them onto Node 24. No project command ran under the
unpinned package manager, and these third-party annotations did not fail either
workflow.

## Template audit

```text
Manifest schema valid: passed through strict Zod validation against the documented shape
Foundation paths exist: passed
Runtime pins consistent: passed
Validation commands exist: passed
Portable validation is Git-free; tracked-output and clean-tree validation are release-repository-only
`corepack yarn validate:portable` is the authoritative post-install template gate, including root and subpath browser/PWA checks
Archive exclusions complete: passed
Domain-free audit: passed in Git-free archive mode with regression fixtures
Git tracked-output and clean-tree audits: passed separately after the evidence commit
Rename guide reviewed: passed
Extension guide reviewed: passed
```

The protocol and Worker adapter values in `contractVersions` are source/API
compatibility markers, not serialized wire-schema guarantees. Serialized
versioning remains limited to the validated snapshot and save-record schemas.

## Limitations

- Local exact-runtime validation remains unavailable because the workstation
  uses Node 24.13.0; remote validation used the pinned Node 24.18.0 and Yarn
  4.17.1.
- Manual real-device HTTPS validation remains pending.
- No final v1.0.0 tag has been created.
