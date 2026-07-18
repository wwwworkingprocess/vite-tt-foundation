# Domain Extension Guide

## Objective

Introduce a game domain without weakening accepted foundation boundaries.

## Recommended order

### 1. Scenario data

Define validated immutable scenario input. Torrevieja Tycoon will later
consume canonical directional stop nodes and directed route patterns.
Ingestion/geocoding remains external.

### 2. Simulation state

Add deterministic domain entities with stable IDs, explicit ordering, and
browser independence.

### 3. Snapshot evolution

Create the next snapshot schema version deliberately. Add migration or
rejection policy, JSON round-trip tests, and deep immutability tests.
Never silently reinterpret version one.

### 4. Commands

Add simulation-owned validated domain commands and pure application.

### 5. Protocol

Extend command/result/update/read-model unions while preserving runtime
validation, JSON safety, direct/Worker parity, idempotency, and reliable
versus replaceable semantics.

### 6. Host and projections

Publish minimal immutable authoritative and render projections. Never
expose mutable simulation internals.

### 7. Application workflows

Add controller orchestration without moving rules into Zustand or React.

### 8. Representation

React/R3F consumes read-only projections and issues commands. Rendering
does not directly mutate simulation.

### 9. Persistence

Update save/snapshot schemas and restore tests before relying on new domain
data in saved games.

### 10. Acceptance path

Maintain:

```text
start
-> domain command
-> Worker publication
-> save
-> restore new timeline
-> domain state preserved
-> continue
-> close
```
