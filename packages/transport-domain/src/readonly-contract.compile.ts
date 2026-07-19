import type {
  CanonicalScenario,
  DirectedScenarioGraph,
  ScenarioCatalog,
  ScenarioManifest,
} from './index.js';

export function readonlyContractCompileOnly(
  catalog: ScenarioCatalog,
  manifest: ScenarioManifest,
  scenario: CanonicalScenario,
  graph: DirectedScenarioGraph,
) {
  // @ts-expect-error catalogue collection is deeply readonly
  catalog.scenarios.push(catalog.scenarios[0]);
  // @ts-expect-error nested descriptor collection is deeply readonly
  catalog.scenarios[0]!.settlementIds.push('x');
  // @ts-expect-error manifest nested collection is deeply readonly
  manifest.settlementIds.push('x');
  // @ts-expect-error stop collection is deeply readonly
  scenario.stops.stopNodes.push(scenario.stops.stopNodes[0]!);
  // @ts-expect-error positions are deeply readonly
  scenario.stops.stopNodes[0]!.position.latitude = 0;
  // @ts-expect-error patterns are deeply readonly
  scenario.routes.routes[0]!.patterns.push(
    scenario.routes.routes[0]!.patterns[0]!,
  );
  // @ts-expect-error pattern stop IDs are deeply readonly
  scenario.routes.routes[0]!.patterns[0]!.stopNodeIds[0] = 'x';
  // @ts-expect-error graph nodes are deeply readonly
  graph.nodes.push(graph.nodes[0]!);
  // @ts-expect-error query results are deeply readonly
  graph.route('x')!.patterns[0]!.stopNodeIds[0] = 'x';
}
