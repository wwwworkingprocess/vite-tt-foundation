# Architecture Principles

**Document status:** Current architecture contract

These principles are durable constraints. A phase prompt may add detail, but it should not weaken them without an explicit architecture decision.

## 1. Simulation first

The simulation core is the authoritative model of the game. It determines what happens; clients determine how those facts are presented and how users issue commands.

## 2. Standalone simulation

`packages/simulation` must compile and run without:

- React or React Three Fiber;
- Three.js;
- Zustand;
- Dexie, IndexedDB, or local storage;
- Socket.IO or browser networking;
- service workers or PWA APIs;
- the DOM or other browser-only globals.

A valid simulation test must be able to execute entirely in a non-browser test environment.

## 3. Deterministic advancement

Given the same:

- initial scenario;
- rules configuration;
- random seed;
- ordered commands;
- number of simulation ticks;

…the simulation must produce the same authoritative result.

Rendering frame rate, browser performance, and animation timing must not change the result.

## 4. Commands, events, and snapshots

Public changes to simulation state occur through validated commands. The simulation may emit domain events and produce snapshots or read models.

Clients must not mutate authoritative state objects directly.

## 5. Persistence is external

The simulation may:

- define snapshot schemas;
- create snapshots;
- validate and migrate supported snapshot versions;
- restore a simulation from a snapshot.

The simulation may not choose or access a persistence mechanism. IndexedDB, server storage, in-memory test storage, and export files are host concerns.

## 6. Representation is replaceable

React Three Fiber is the first graphical client, not part of the simulation model. The same simulation should be usable by:

- an abstract node-graph renderer;
- a geographic renderer;
- a headless test runner;
- a balancing CLI;
- a future server host;
- a future alternate client.

## 7. Transport is replaceable

The browser should communicate with the simulation through an adapter-neutral client contract. A local worker transport and a future Socket.IO transport should expose equivalent command/event/snapshot semantics.

## 8. One engine, multiple rulesets

Easy, Normal, and Realistic modes configure one simulation engine. Shared concepts such as nodes, edges, services, vehicles, passengers, time, and commands must not be reimplemented per mode.

## 9. Explicit state ownership

Authoritative simulation state, application integration state, and presentation state must remain distinguishable. A value should have one clear owner.

## 10. Phase discipline

Infrastructure and mechanics are added only when required by the active phase. Speculative systems increase maintenance cost and obscure architectural validation.

Every phase must leave the repository buildable, testable, documented, and reviewable.
