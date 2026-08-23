# Passenger runtime phase profiling

The headless simulation runtime benchmark accepts
`--profile-passenger-phases`. This opt-in diagnostic measures the existing
authoritative tick path without reproducing passenger work. Simulation defines
five finite semantic boundaries: emission, access/physical-arrival,
destination/waiting activation, vehicle transit, and destination access/journey
completion. The Node benchmark supplies the monotonic clock and aggregates
durations and naturally available work counts.

The destination/waiting interval retains its original top-level timing and adds
two nested diagnostics: destination allocation and waiting activation. A third
residual is derived from the independently measured top-level duration and
captures state finalization without adding another simulation boundary.
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
child. Across the broader destination/waiting parent, the independently derived
residual/finalization interval is largest. Both are evidence for a later task;
neither is optimized here.

The profile excludes scenario and population loading, demand-plan and itinerary
construction, warmup, Snapshot V9 creation/hashing, persistence, adapters, and
representation. Percentages are shares of measured passenger-phase time, not
CPU or whole-game percentages. Unattributed simulation time is authoritative
tick time outside those phase boundaries.

Reference comparisons use `torrevieja-legacy-abc-v1`,
`cartagena-radial-legacy-all-v1`, and `malaga-day-legacy-all-v1` at W1 and W12.
W12 is the current maximum-amortization fallback; it is not assumed universally
fastest. A future device/city calibrator may select any supported integer from
1 through 12. Post-change profiling selects any later optimization target.
Existing-cohort validation, assignment activation, sorting, freezing, and other
passenger phases remain deliberately unchanged in this milestone.

The reviewed mandatory Worker functionality measured 192,991 bytes against the
former 193,000-byte coordinate. The architect-authorized 200,000-byte Worker
budget is a housekeeping reconciliation; chunk accounting and the independent
total-JavaScript budget remain unchanged.
