# Canonical population fields v1 — provenance and freeze pins

## Common source

The three prepared fields were derived from the same pinned population raster:

- Organization: European Commission Joint Research Centre (JRC), with Eurostat
- Dataset: **JRC-ESTAT Census Population Grid 2021**
- Variable: total resident population
- Native resolution: 100 m × 100 m
- Native CRS: ETRS89 / LAEA Europe, EPSG:3035
- License stated in the accepted source documentation: CC BY 4.0
- Dataset DOI: `10.2905/98336641-fd1c-4992-8c7b-c470dd5eb81e`
- Exact raster filename used by the accepted generators: `JRC-ESTAT_Census_Population_2021_100m_rev0726.tif`
- Exact raster SHA-256: `0e4e072b2f2f5040a55f485ee2be756a021b5c305a22c576db28ae8fd20a524e`

The source GeoTIFF is not committed in this preparation package. The canonical JSON is the game-oriented derived artifact.

The JRC field is an estimated spatial disaggregation of census population. Individual cells must not be presented as address-level measured census truth.

## Torrevieja

- external city identity: `Q36730`
- game primary settlement: `es-torrevieja`
- grid: 91 × 96
- resolution: `0.001°`
- canonical grid SHA-256: `c507d7f3a11bde457118ccba329285d49550a0c8959c6865c15b3ec7e12ddd3c`
- crop metadata SHA-256: `79fdafb190fc29b130f99fd2b9570a8e093f01dbcffb79b70eced190aa8a8a18`
- accepted Round-4 source package SHA-256: `187af1dec511f14122f3f3413e1767e095c73e51d5b6c36973eab0fcf365a20a`
- current crop records: 5
- crop safety exceptions: none recorded

## Elche

- external city identity: `Q10509`
- game primary settlement: `es-elche`
- grid: 187 × 259
- resolution: `0.001°`
- canonical grid SHA-256: `b125ee476aff0d27fdfc8a422466b47a87f6e9626a5ff1ffc04a1a0fe8ded3fb`
- crop metadata SHA-256: `356df3269a7e557334f1e8814c0ef72d625052cd1360f0acf45f0ca011e842c5`
- accepted Round-4 source package SHA-256: `202785920460f47faf835e5eb8cc4f41e7e9ecef5a343fa6f329b7443ac28a80`
- current crop records: 13
- crop safety exceptions preserved in metadata: `elche-radial-airport-v1`, `elche-radial-coast-v1`

## Alicante

- external city identity: `Q11959`
- game primary settlement: `es-alicante`
- grid: 113 × 209
- resolution: `0.001°`
- canonical grid SHA-256: `cbe2068d3bf4a97bcf062b995ad5cd4d2c23bbf1957abf96d07db72419cfa3fb`
- crop metadata SHA-256: `2587608609dfb80e1afcab6f28508c7d574e60ddda16ec7e9f5f0e2b0730ef5b`
- accepted Round-4 source package SHA-256: `f6d13f7c62522e900a131f789635142464d1a127e7873f1586454a932b5ee020`
- current crop records: 7
- crop safety exceptions preserved in metadata: `alicante-legacy-north-v1`, `alicante-legacy-all-v1`

## Benidorm

Benidorm population work is planned to use this same contract, including both city and radial scenario families. It is intentionally absent from this preparation bundle because Benidorm is not yet part of the current application scenario baseline and no Benidorm Round-4 archive was supplied to this packaging step.

When it is added, its field must preserve the same invariants:

- one canonical city grid;
- 0.001° lattice if that remains the accepted Benidorm field geometry;
- north-to-south rows and west-to-east columns;
- half-open aligned crop windows;
- no per-scenario resampling or normalization;
- explicit game settlement identity mapping;
- exact source/canonical/crop checksums.

## Freeze rule

The preparation task did not alter any accepted canonical or crop JSON byte. If a later task needs to change population values or crop records, it must create a new reviewed data version rather than silently editing v1.
