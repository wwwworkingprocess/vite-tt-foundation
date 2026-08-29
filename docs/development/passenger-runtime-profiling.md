# Passenger runtime phase profiling

The headless simulation runtime benchmark accepts
`--profile-passenger-phases`. This opt-in diagnostic measures the existing
authoritative tick path without reproducing passenger work. Simulation defines
five finite semantic boundaries: emission, access/physical-arrival,
destination/waiting activation, vehicle transit, and destination access/journey
completion. The Node benchmark supplies the monotonic clock and aggregates
durations and naturally available work counts.

The destination/waiting interval retains its original top-level timing and adds
two nested diagnostics: destination allocation and waiting activation. Three
further nested regions attribute the post-activation work: accessing-group
ordering, canonical StopPlace authority materialization, and state
finalization. Unattributed time is derived from the independently measured
parent rather than defining that parent as the sum of its children.
Waiting activation remains independently timed around the complete trusted
simulation activation call and is explained by four nested regions: plan
preparation, existing-authority preparation, new-assignment activation, and
ordering/finalization. The accepted refinement identified repeated strict plan
parsing and full demand-cell `Map` construction as the dominant steady-state
cost. Trusted advancement now reuses the existing WeakMap-cached
`PassengerDemandRuntimeIndex`, whose closure-hidden cell lookup is built once
per canonical plan identity. The public activation boundary remains strict and
delegates to the same core only after parsing its plan.

`demandPlanCells` describes canonical plan size. It does not claim that all
cells were traversed during each profiled activation. The separate
`planPreparationCellEvaluations` counter is zero for trusted steady-state
activation. The retained lookup adds one derived runtime entry per plan cell,
replacing repeated transient O(plan cells) maps; it is not persisted and is
reconstructed after restore.

The accepted Torrevieja, Cartagena, and Málaga W1/W12 profiles now measure
trusted plan preparation at approximately 0.007–0.018 ms/tick with zero
per-tick plan-cell evaluations, down from approximately 16.85–217.73 ms/tick.
Within waiting activation, ordering/finalization is now the largest measured
child. Across the broader destination/waiting parent, state finalization is the
dominant post-activation region at approximately 48–76% of the parent. The two
full StopPlace authority materializations scale linearly from 79 through 1,032
StopPlaces but account for only approximately 1.9–2.7% of the parent. This
disproved the materialization-dominance hypothesis and identified recursive
freezing of freshly reconstructed StopPlace authority as the actual scaling
cost. Trusted advancement now reuses each unchanged `stopArrivals` and
`destinationCursors` record, reuses an entire canonical array when every value
is unchanged, and freezes only changed records and replacement arrays before
root finalization. Snapshot authority and canonical array ordering are
unchanged.

Across the follow-up W1/W12 profiles, state finalization fell from approximately
0.34–4.30 ms/tick to 0.03–0.08 ms/tick. Stop-authority materialization increased
only from approximately 0.01–0.14 ms/tick to 0.02–0.19 ms/tick, while the
enclosing destination/waiting interval and all six unprofiled whole-simulation
runs improved. The cost was therefore removed rather than moved between timing
regions. Waiting activation is now the largest destination/waiting child in the
measured scenarios; its existing-cohort preparation and ordering/finalization
children remain the next evidence-backed investigation, not part of this
optimization.

The profile excludes scenario and population loading, demand-plan and itinerary
construction, warmup, Snapshot V9 creation/hashing, persistence, adapters, and
representation. Percentages are shares of measured passenger-phase time, not
CPU or whole-game percentages. Unattributed simulation time is authoritative
tick time outside those phase boundaries.

Reference comparisons use `torrevieja-legacy-abc-v1`,
`cartagena-radial-legacy-all-v1`, and `malaga-day-legacy-all-v1` at W1 and W12.
W12 remains the maximum-amortization fallback; it is not assumed universally
fastest. Apps/web now runs bounded scheduler-only device/scenario calibration
and may select any supported integer from 1 through 12 when the measured win is
material. Calibration is non-authoritative and unpersisted. The urgent passenger
performance epic is concluded; retained profiling is a regression and future
diagnostic tool rather than an instruction to continue algorithm optimization.
Existing-cohort validation, assignment activation, sorting, freezing, and other
passenger phases remain deliberately unchanged.

The reviewed mandatory Worker functionality measured 192,991 bytes against the
former 193,000-byte coordinate. The architect-authorized 200,000-byte Worker
budget is a housekeeping reconciliation; chunk accounting and the independent
total-JavaScript budget remain unchanged.
