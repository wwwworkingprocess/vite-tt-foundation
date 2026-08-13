# Population-field preparation overlay — historical record

> **Historical status:** This file describes the original data-only preparation
> overlay. It is not the current runtime contract. See
> `docs/current-state.md` and `docs/data/population-fields-v1.md`.

This overlay originally staged accepted population-field data for a later
Torrevieja Tycoon development phase.

Apply it to a clean repository by extracting at repository root. It adds only new files under:

- `apps/web/public/population-fields/`
- `docs/data/`

At that historical point it intentionally contained no production-code change,
and passenger demand remained disabled pending a subsequent implementation
milestone. Population-backed passenger demand is active in the current product.

Read before implementation:

1. `docs/data/population-fields-v1.md`
2. `docs/data/population-fields-v1-provenance.md`
3. `apps/web/public/population-fields/catalog.json`

Prepared current cities: Torrevieja, Elche, Alicante.

Planned later city: Benidorm, including radial families. Benidorm is not bundled in this overlay.
