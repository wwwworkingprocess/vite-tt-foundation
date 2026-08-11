import type { CanonicalScenario } from '@torrevieja-tycoon/transport-domain';
import type { ScenarioLoaderState } from './scenario-loader.js';
import {
  createCityScenarioGroups,
  type CityNameLookup,
} from '../ui/open-screen-model.js';

export type ScenarioSelectionState = Readonly<{
  requestedScenarioId?: string | undefined;
  status: 'idle' | 'loading' | 'ready' | 'failed';
  scenario?: CanonicalScenario | undefined;
  message?: string | undefined;
}>;

export function ScenarioPanel(props: {
  readonly state: ScenarioLoaderState;
  readonly cityNames: CityNameLookup;
  readonly disabled?: boolean | undefined;
  readonly onScenarioChange: (scenarioId: string) => void;
}) {
  const { state } = props;
  const graph = state.graph;
  const groups = state.catalog
    ? createCityScenarioGroups(state.catalog, props.cityNames)
    : [];
  const selectedDescriptor = state.catalog?.scenarios.find(
    ({ scenarioId }) => scenarioId === state.selectedScenarioId,
  );
  const selectedCityId =
    selectedDescriptor?.primarySettlementId ?? groups[0]?.cityId;
  const selectedGroup = groups.find(({ cityId }) => cityId === selectedCityId);
  return (
    <section aria-labelledby="scenario-title">
      <h2 id="scenario-title">Transport scenario</h2>
      <p data-testid="scenario-status">
        Scenario status: {state.status}
        {state.message ? `: ${state.message}` : ''}
      </p>
      <label>
        City
        <select
          aria-label="City"
          value={selectedCityId ?? ''}
          disabled={
            props.disabled ||
            !state.catalog ||
            state.status === 'loading-scenario'
          }
          onChange={(event) => {
            const first = groups.find(
              ({ cityId }) => cityId === event.target.value,
            )?.scenarios[0];
            if (first) props.onScenarioChange(first.scenarioId);
          }}
        >
          {groups.map(({ cityId, name }) => (
            <option key={cityId} value={cityId}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Scenario
        <select
          value={state.selectedScenarioId ?? ''}
          disabled={
            props.disabled ||
            !state.catalog ||
            state.status === 'loading-scenario'
          }
          onChange={(event) => props.onScenarioChange(event.target.value)}
        >
          <option value="" disabled>
            Select a scenario
          </option>
          {selectedGroup?.scenarios.map((scenario) => (
            <option key={scenario.scenarioId} value={scenario.scenarioId}>
              {scenario.title}
            </option>
          ))}
        </select>
      </label>
      {state.status === 'failed' && state.selectedScenarioId ? (
        <button
          type="button"
          disabled={props.disabled}
          onClick={() => props.onScenarioChange(state.selectedScenarioId!)}
        >
          Retry selected scenario
        </button>
      ) : null}
      {graph ? (
        <dl aria-label="Scenario graph summary">
          <div>
            <dt>Selected scenario</dt>
            <dd>{state.title}</dd>
          </div>
          <div>
            <dt>Settlements</dt>
            <dd>{state.settlementCount}</dd>
          </div>
          <div>
            <dt>Stop nodes</dt>
            <dd>{graph.summary.nodes}</dd>
          </div>
          <div>
            <dt>Routes</dt>
            <dd>{state.routeCount}</dd>
          </div>
          <div>
            <dt>Patterns</dt>
            <dd>{graph.summary.patterns}</dd>
          </div>
          <div>
            <dt>Directed edges</dt>
            <dd>{graph.summary.edges}</dd>
          </div>
        </dl>
      ) : null}
    </section>
  );
}
