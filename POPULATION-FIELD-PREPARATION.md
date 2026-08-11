# Population-field preparation overlay

This overlay stages accepted population-field data for the next Torrevieja Tycoon development phase.

Apply it to a clean repository by extracting at repository root. It adds only new files under:

- `apps/web/public/population-fields/`
- `docs/data/`

It intentionally contains no production-code change. Passenger demand remains disabled until the subsequent implementation milestone explicitly wires these assets into the existing deterministic demand pipeline.

Read before implementation:

1. `docs/data/population-fields-v1.md`
2. `docs/data/population-fields-v1-provenance.md`
3. `apps/web/public/population-fields/catalog.json`

Prepared current cities: Torrevieja, Elche, Alicante.

Planned later city: Benidorm, including radial families. Benidorm is not bundled in this overlay.
