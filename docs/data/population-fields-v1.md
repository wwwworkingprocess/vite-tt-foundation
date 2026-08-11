# Canonical population fields v1 — preparation contract

## Status

**Prepared data baseline. Not yet connected to passenger demand.**

This directory documents the canonical population-field assets staged for the next Torrevieja Tycoon implementation milestone. The preparation commit is intentionally data/documentation-only: adding these files must not cause passengers to spawn, alter simulation authority, or change save/snapshot/client/Worker contracts.

Current prepared cities:

- Torrevieja — primary settlement `es-torrevieja`
- Elche — primary settlement `es-elche`
- Alicante — primary settlement `es-alicante`

Benidorm is a planned fourth city, including radial scenario families, but **is not part of the current game/scenario baseline and is not bundled in this preparation package**. Do not invent a Benidorm settlement identity, scenario mapping, or runtime fallback. Its accepted population package can be added later using this same format after the engine/browser integration is proven with the current cities.

## Runtime data location

Static data is staged under:

`apps/web/public/population-fields/`

The discovery index is:

`apps/web/public/population-fields/catalog.json`

The index maps game-domain `primarySettlementId` values to canonical city fields. The canonical grid's external `cityId` (currently a Wikidata QID) is provenance/geographic identity and must **not** replace the game's settlement identity.

## Canonical model

There is exactly one canonical population grid per city:

```text
canonical city grid
├─ fixed originCellCenter
├─ fixed resolutionDegrees
├─ north-to-south rows
├─ west-to-east columns
└─ immutable integer populationWeights[row][column]
```

A scenario does not own a separately authored or normalized population matrix. It references an aligned crop window from its city's canonical grid:

```text
city populationWeights
  [rowStart:rowEnd)
  [columnStart:columnEnd)
       ↓
scenario-aligned population view
```

Crop indices are half-open. A canonical cell keeps exactly the same weight in every scenario that includes it.

Do not:

- interpolate;
- resample;
- smooth per scenario;
- renormalize per scenario;
- mutate canonical weights;
- duplicate scenario-specific population matrices in source control.

## Scenario matching

Future integration must resolve population data from canonical scenario identity, not from scenario-name prefixes.

The intended lookup chain is:

```text
CanonicalScenario.manifest.primarySettlementId
→ population-fields/catalog.json
→ canonical city grid

CanonicalScenario.manifest.scenarioId
+ scenarioVersion/contentHash where available in crop metadata
→ exact crop record
```

Where crop metadata pins a scenario content hash, integration should treat a mismatch as stale/incompatible data rather than silently applying a crop produced for different package bytes.

## Population weights versus passenger emission

The matrix answers **where potential origin population exists**. It does not define a passenger spawn rate.

Passenger activation is a separate implementation milestone that must combine the canonical field/crop with the existing transport-domain/simulation concepts, including StopPlace catchments and `PassengerDemandPlanV1` policy.

The preparation baseline therefore does **not** define:

- passengers per tick;
- emission-rate constants;
- access radius/policy changes;
- destination probabilities;
- economic values;
- offline progression.

## Scenario crop safety and anomalies

Crop metadata is evidence, not permission to rewrite scenario geography.

Most current crop records contain every route-used positioned StopPlace. Known accepted exceptions are preserved explicitly in the source crop metadata:

- Elche: `elche-radial-airport-v1`, `elche-radial-coast-v1`
- Alicante: `alicante-legacy-north-v1`, `alicante-legacy-all-v1`

Those records contain advisory `minimumAlignedExtensionRecommended` data. The preparation commit deliberately does **not** apply those extensions or modify scenario bounds.

The later integration task must choose and test its behavior explicitly. It must not silently expand a crop, silently rewrite scenario bounds, or fall back to the complete city grid merely to make a test pass.

Torrevieja's five current crop records pass their StopPlace safety check and are suitable as the first end-to-end passenger-demand integration target.

## Integrity

The accepted canonical and crop JSON bytes are copied unchanged from their Round-4 review packages. Their historical filenames are preserved so the accepted SHA-256 values remain directly traceable.

`apps/web/public/population-fields/CHECKSUMS.sha256` covers the staged static data files.

No production TypeScript/JavaScript, scenario package, persistence contract, or build configuration belongs in this preparation commit.
