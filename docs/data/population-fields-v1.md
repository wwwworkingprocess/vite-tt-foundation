# Canonical population fields v1 — active runtime contract

## Status

The population fields are active runtime authority for deterministic passenger
demand in Torrevieja, Elche, Alicante, Benidorm, Cartagena, Murcia, and
Málaga, including the large Cartagena radial scenarios.

Runtime assets live under `apps/web/public/population-fields/`. The catalogue
maps canonical scenario `primarySettlementId` values to one city grid and one
scenario-crop document. Scenario IDs, versions, and content hashes select the
exact crop; display names and scenario-ID prefixes are not authority.

## Canonical grids

Each city owns one byte-frozen Round-4-derived canonical grid:

- cell centres use WGS84 latitude and longitude;
- resolution is exactly `0.001° × 0.001°`;
- rows run north to south and columns west to east;
- every non-negative integer population weight is preserved exactly.

Runtime and authoring code must not interpolate, resample, smooth, normalize,
or create scenario-specific population matrices.

## Operational scenario crops

Operational crops are reviewed deterministic derivatives, not byte-frozen
source authority. A crop is the smallest canonical-grid-aligned half-open
rectangle containing its accepted preparation crop plus every canonical cell
required by route-used eligible StopPlace catchments. It may be regenerated
when the service/catchment footprint expands without changing the scenario
viewport or canonical weights.

The scenario viewport remains presentation framing. It is not the passenger
service boundary.

The population catalogue records the machine-readable operational crop policy:

```json
{ "maxAccessDistanceCells": 5 }
```

The authoring audit, runtime population view, and Production Passenger Demand
Policy V1 must agree on that value. Runtime mismatch fails closed; runtime does
not widen a crop.

## Active passenger pipeline

The application resolves:

```text
exact canonical scenario
→ primary settlement population entry
→ hash-verified canonical grid and operational crop
→ immutable scenario population view
→ deterministic StopPlace catchments
→ PassengerDemandPlanV1
→ new-game or restore semantic preflight
```

Population weights express relative demand potential, not passengers per tick.
StopPlaces are physical access magnets; directional StopNodes remain itinerary
and vehicle-call identities.

## Production Passenger Demand Policy V1

The deterministic development-seed policy is:

- maximum access distance: `5` grid cells;
- emission credits per weight per tick: `1`;
- credits per passenger: `50,000`;
- access ticks per cell: `1`.

The 50,000-credit threshold makes the real fields observable without flooding
passenger authority. It is initial/debug tuning, not final economics or game
balance.

## Integrity

Canonical grids remain byte-frozen and retain their accepted SHA-256 values.
Operational crop JSON is reviewed generated metadata and has current hashes
distinct from its historical Round-4 preparation hashes.

`apps/web/public/population-fields/CHECKSUMS.sha256` protects all public
population assets. `PREPARATION-CHECKSUMS.sha256` preserves the complete
population preparation/current-document integrity set. The normal population
audit verifies both manifests, catalogue reconciliation, crop policy, grid
containment, scenario content hashes, and catchment sufficiency.

The diagnostic SVG overlay is hidden by default and derives presentation
geometry from canonical cell boundaries. It never becomes simulation authority.
