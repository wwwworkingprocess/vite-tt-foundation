import { useEffect, useState } from 'react';
import {
  browserSha256,
  createScenarioLoader,
  type ScenarioLoaderState,
} from './scenario-loader.js';

const fetchText = async (url: string) => {
  const response = await fetch(url);
  return { ok: response.ok, text: () => response.text() };
};

export function ScenarioPanel() {
  const [state, setState] = useState<ScenarioLoaderState>({ status: 'idle' });
  const [loader] = useState(() =>
    createScenarioLoader({
      baseUrl: import.meta.env.BASE_URL,
      fetchText,
      digestSha256: browserSha256,
    }),
  );
  useEffect(() => {
    const remove = loader.projection.subscribe((next) => setState(next));
    void loader.loadCatalog().then(() => {
      const first = loader.projection.getState().catalog?.scenarios[0];
      if (first) void loader.loadScenario(first.scenarioId);
    });
    return remove;
  }, [loader]);
  const graph = state.graph;
  return (
    <section aria-labelledby="scenario-title">
      <h2 id="scenario-title">Transport scenario</h2>
      <p data-testid="scenario-status">
        Scenario status: {state.status}
        {state.message ? `: ${state.message}` : ''}
      </p>
      <label>
        Scenario
        <select
          value={state.selectedScenarioId ?? ''}
          disabled={!state.catalog || state.status === 'loading-scenario'}
          onChange={(event) => {
            void loader.loadScenario(event.target.value);
          }}
        >
          <option value="" disabled>
            Select a scenario
          </option>
          {state.catalog?.scenarios.map((scenario) => (
            <option key={scenario.scenarioId} value={scenario.scenarioId}>
              {scenario.title}
            </option>
          ))}
        </select>
      </label>
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
