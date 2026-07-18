# ADR 0001: Foundation toolchain

## Status

Accepted in Phase 1.

## Decision

Pin Node.js 24.18.0 LTS and Yarn 4.17.1. Use Yarn workspaces with the `node-modules` linker. Pin exact dependency versions in manifests and commit the Yarn lockfile.

The initial major tool versions are Vite 8, React 19, TypeScript 6, Vitest 4, Cypress 15, ESLint 10, and Prettier 3. The browser layer owns React Three Fiber 9, Drei 10, Three.js 0.185, Zustand 5, Dexie 4, Zod 4, and `vite-plugin-pwa` 1.

## Rationale

Node 24 is an active supported LTS line and satisfies the Node engine ranges published by Vite 8 and Vitest 4. TypeScript 6.0.3 is selected instead of the newer TypeScript 7 release because `typescript-eslint` 8.64 supports TypeScript versions below 6.1. Exact versions and the lockfile make the template reproducible.

Yarn's `node-modules` linker keeps browser and Cypress tooling conventional while retaining workspace protocol enforcement. Package exports and TypeScript references preserve public package boundaries. The simulation and protocol compilers expose only the ES2023 standard library with no automatically included ambient `@types`; focused ESLint restrictions enforce package dependency direction and reject browser, UI, persistence, PWA, and networking imports from those packages.

## Consequences

Dependency upgrades are deliberate later tasks. Libraries build to `dist` before the web application consumes their public exports. The simulation and protocol packages contain no browser or application dependencies.
