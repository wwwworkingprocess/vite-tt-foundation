export type PreparationStage =
  'acquiring-inputs' | 'preparing' | 'presenting' | 'interactive';
export type PreparationPart = 'terrain' | 'city' | 'roads' | 'fallback';
export type PreparationSnapshot = Readonly<{
  generation: number;
  key: string;
  stage: PreparationStage;
  status: 'loading' | 'ready' | 'error' | 'cancelled';
  error?: string;
  signature?: string;
}>;
/** Application presentation state only. A data result never claims a GPU draw. */
export function createCityPreparationCoordinator() {
  let state: PreparationSnapshot = Object.freeze({
    generation: 0,
    key: '',
    stage: 'acquiring-inputs',
    status: 'cancelled',
  });
  let suspended: PreparationSnapshot | undefined;
  let required = new Set<PreparationPart>();
  const drawn = new Set<PreparationPart>();
  const listeners = new Set<() => void>();
  const publish = (next: PreparationSnapshot) => {
    state = Object.freeze(next);
    for (const listener of listeners) listener();
  };
  const current = (generation: number) =>
    generation === state.generation && state.status === 'loading';
  const finish = () => {
    if ([...required].every((part) => drawn.has(part)))
      publish({ ...state, status: 'ready', stage: 'interactive' });
  };
  return Object.freeze({
    snapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    begin(key: string) {
      suspended = undefined;
      required = new Set();
      drawn.clear();
      publish({
        generation: state.generation + 1,
        key,
        stage: 'acquiring-inputs',
        status: 'loading',
      });
      return state.generation;
    },
    bind(generation: number, signature: string) {
      if (current(generation) && state.signature !== signature) {
        drawn.clear();
        publish({ ...state, signature });
      }
    },
    invalidate(generation: number, part: PreparationPart) {
      if (current(generation)) drawn.delete(part);
    },
    stage(generation: number, stage: PreparationStage) {
      if (
        current(generation) &&
        ['acquiring-inputs', 'preparing', 'presenting', 'interactive'].indexOf(
          stage,
        ) >
          [
            'acquiring-inputs',
            'preparing',
            'presenting',
            'interactive',
          ].indexOf(state.stage)
      )
        publish({ ...state, stage });
    },
    prepared(generation: number, parts: readonly PreparationPart[]) {
      if (!current(generation)) return;
      const actual = parts.length ? parts : ['fallback' as const];
      const changed =
        required.size !== actual.length ||
        actual.some((part) => !required.has(part));
      required = new Set(actual);
      if (state.stage !== 'presenting' || changed)
        publish({ ...state, stage: 'presenting' });
      finish();
    },
    draw(generation: number, part: PreparationPart) {
      if (!current(generation) || drawn.has(part)) return;
      drawn.add(part);
      if (state.stage === 'presenting') finish();
    },
    fail(generation: number, error: string) {
      if (current(generation)) publish({ ...state, status: 'error', error });
    },
    activate(generation: number) {
      if (
        generation === state.generation &&
        state.status === 'cancelled' &&
        suspended
      ) {
        publish(suspended);
        suspended = undefined;
      }
    },
    cancel(generation: number) {
      if (generation === state.generation && state.status !== 'cancelled') {
        suspended = state;
        publish({ ...state, status: 'cancelled' });
      }
    },
  });
}
export type CityPreparationCoordinator = ReturnType<
  typeof createCityPreparationCoordinator
>;
