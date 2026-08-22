import { describe, expect, it } from 'vitest';
import {
  advanceTransportTicksInternal,
  advanceTransportTicksWithEvents,
  createTransportSimulationSnapshot,
  createTransportSimulationState,
} from './transport-simulation.js';
import { demandPlan, scenario } from './transport-snapshot-v9.fixture.test.js';

const passengerRuntimePhases = [
  'passenger-emission',
  'passenger-access-arrival',
  'passenger-destination-waiting',
  'passenger-vehicle-transit',
  'passenger-destination-access-completion',
] as const;

describe('passenger runtime phase profiling', () => {
  it('observes finite ordered phases without changing authority or transitions', () => {
    const state = createTransportSimulationState(scenario(), 0, demandPlan());
    const observed: string[] = [];
    let phase: (typeof passengerRuntimePhases)[number] | undefined;
    const nextPhase = [undefined, 1, 2, 4, 3, 4] as const;
    const events: Parameters<typeof advanceTransportTicksInternal>[2] = [];
    const profiled = advanceTransportTicksInternal(
      state,
      3,
      events,
      (boundary) => {
        const waitingChildren = [
          'waiting-plan-preparation',
          'waiting-existing-authority-preparation',
          'waiting-new-assignment-activation',
          'waiting-ordering-finalization',
        ] as const;
        if (boundary >= 9) {
          const prior = waitingChildren[boundary - 9];
          if (prior) observed.push(`finish:${prior}`);
          const next = waitingChildren[boundary - 8];
          if (next) observed.push(`start:${next}`);
          return;
        }
        if (boundary === 7) {
          observed.push('finish:passenger-destination-allocation');
          observed.push('start:passenger-waiting-activation');
          observed.push('start:waiting-plan-preparation');
          return;
        }
        if (boundary === 8) {
          observed.push('finish:passenger-waiting-activation');
          return;
        }
        if (phase) observed.push(`finish:${phase}`);
        const next = boundary === 0 ? 0 : nextPhase[boundary];
        phase = next === undefined ? undefined : passengerRuntimePhases[next];
        if (phase) observed.push(`start:${phase}`);
      },
    );
    const ordinary = advanceTransportTicksWithEvents(state, 3);

    expect(createTransportSimulationSnapshot(profiled)).toEqual(
      createTransportSimulationSnapshot(ordinary.state),
    );
    expect(events).toEqual(ordinary.passengerOriginStopArrivalEvents);
    expect(
      new Set(
        observed
          .map((entry) => entry.split(':')[1])
          .filter((name) => passengerRuntimePhases.includes(name as never)),
      ),
    ).toEqual(
      new Set(passengerRuntimePhases.filter((_, index) => index !== 3)),
    );
    expect(
      observed.filter(
        (entry) =>
          !entry.includes('destination-allocation') &&
          !entry.includes('waiting-activation'),
      ),
    ).toEqual(
      expect.arrayContaining(
        passengerRuntimePhases.flatMap((name, index) =>
          index === 3 ? [] : [`start:${name}`, `finish:${name}`],
        ),
      ),
    );
    const destinationStart = observed.indexOf(
      'start:passenger-destination-waiting',
    );
    const allocationFinish = observed.indexOf(
      'finish:passenger-destination-allocation',
    );
    const activationStart = observed.indexOf(
      'start:passenger-waiting-activation',
    );
    const activationFinish = observed.indexOf(
      'finish:passenger-waiting-activation',
    );
    const destinationFinish = observed.indexOf(
      'finish:passenger-destination-waiting',
    );
    const waitingChildTransitions = [
      'start:passenger-waiting-activation',
      'start:waiting-plan-preparation',
      'finish:waiting-plan-preparation',
      'start:waiting-existing-authority-preparation',
      'finish:waiting-existing-authority-preparation',
      'start:waiting-new-assignment-activation',
      'finish:waiting-new-assignment-activation',
      'start:waiting-ordering-finalization',
      'finish:waiting-ordering-finalization',
      'finish:passenger-waiting-activation',
    ];
    expect(
      observed.filter(
        (entry) =>
          entry === 'start:passenger-waiting-activation' ||
          entry === 'finish:passenger-waiting-activation' ||
          entry.startsWith('start:waiting-') ||
          entry.startsWith('finish:waiting-'),
      ),
    ).toEqual(Array.from({ length: 3 }).flatMap(() => waitingChildTransitions));
    expect([
      destinationStart,
      allocationFinish,
      activationStart,
      activationFinish,
      destinationFinish,
    ]).toEqual(
      [
        ...new Set([
          destinationStart,
          allocationFinish,
          activationStart,
          activationFinish,
          destinationFinish,
        ]),
      ].sort((left, right) => left - right),
    );
  });
});
