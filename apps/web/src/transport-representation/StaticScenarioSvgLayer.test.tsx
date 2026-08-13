import { render } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseScenarioPackage } from '@torrevieja-tycoon/transport-domain';
import StaticScenarioSvgLayer from './StaticScenarioSvgLayer.js';
import { projectVehicleMovementSvg } from './vehicle-svg-projection.js';

const fixture = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  'packages',
  'transport-domain',
  'fixtures',
  'torrevieja-mini-v1',
);
const json = (name: string) =>
  JSON.parse(readFileSync(join(fixture, name), 'utf8')) as unknown;
const scenario = parseScenarioPackage({
  manifest: json('scenario.json'),
  settlements: json('settlements.json'),
  stops: json('stops.json'),
  routes: json('routes.json'),
  presentation: json('presentation.json'),
  provenance: json('provenance.json'),
});

it('does not rerender the static scenario layer for a vehicle-only parent update', () => {
  const projection = projectVehicleMovementSvg(scenario, []);
  const onSelectionChange = vi.fn();
  let edgeReads = 0;
  const edges = new Proxy(projection.edges, {
    get(target, property, receiver) {
      if (property === 'map') edgeReads += 1;
      return Reflect.get(target, property, receiver);
    },
  });
  const view = (vehicleTick: number) => (
    <svg data-vehicle-tick={vehicleTick}>
      <StaticScenarioSvgLayer
        edges={edges}
        nodes={projection.nodes}
        selection={null}
        onSelectionChange={onSelectionChange}
      />
    </svg>
  );
  const rendered = render(view(0));
  expect(edgeReads).toBe(1);
  rendered.rerender(view(1));
  expect(edgeReads).toBe(1);
});
