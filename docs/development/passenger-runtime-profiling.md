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
Waiting activation remains independently timed around the complete strict
activation call and is explained by four nested regions: plan preparation,
existing-authority preparation, new-assignment activation, and ordering/finalization.
These measurements characterize cost ownership only; they do not introduce a
trusted variant, cache, index, validation shortcut, or passenger optimization.

The profile excludes scenario and population loading, demand-plan and itinerary
construction, warmup, Snapshot V9 creation/hashing, persistence, adapters, and
representation. Percentages are shares of measured passenger-phase time, not
CPU or whole-game percentages. Unattributed simulation time is authoritative
tick time outside those phase boundaries.

Reference comparisons use `torrevieja-legacy-abc-v1`,
`cartagena-radial-legacy-all-v1`, and `malaga-day-legacy-all-v1` at W1 and W12.
W12 is the current maximum-amortization fallback; it is not assumed universally
fastest. A future device/city calibrator may select any supported integer from
1 through 12. Profiling evidence selects a later optimization target; this
milestone performs no further passenger optimization.

The reviewed mandatory Worker functionality measured 192,991 bytes against the
former 193,000-byte coordinate. The architect-authorized 200,000-byte Worker
budget is a housekeeping reconciliation; chunk accounting and the independent
total-JavaScript budget remain unchanged.
