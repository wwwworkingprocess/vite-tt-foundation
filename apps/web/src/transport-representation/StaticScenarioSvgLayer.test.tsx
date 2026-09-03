import { fireEvent, render } from '@testing-library/react';
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
const publicFixture = join(
  import.meta.dirname,
  '..',
  '..',
  'public',
  'scenarios',
  'murcia-v1',
  'murcia-rayo-south-v1',
);
const publicJson = (name: string) =>
  JSON.parse(readFileSync(join(publicFixture, name), 'utf8')) as unknown;
const physicalScenario = parseScenarioPackage({
  manifest: publicJson('scenario.json'),
  settlements: publicJson('settlements.json'),
  stops: publicJson('stops.json'),
  routes: publicJson('routes.json'),
  presentation: publicJson('presentation.json'),
  provenance: publicJson('provenance.json'),
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

it('keeps degenerate and uncoloured edges decorative', () => {
  const projection = projectVehicleMovementSvg(scenario, []);
  const edge = projection.edges[0]!;
  const uncolouredEdge = {
    edgeId: edge.edgeId,
    routeId: edge.routeId,
    patternId: edge.patternId,
    x1: edge.x1,
    y1: edge.y1,
    x2: edge.x2,
    y2: edge.y2,
  };
  const rendered = render(
    <svg>
      <StaticScenarioSvgLayer
        edges={[{ ...uncolouredEdge, x2: edge.x1, y2: edge.y1 }]}
        nodes={[]}
        selection={null}
        onSelectionChange={vi.fn()}
      />
    </svg>,
  );

  expect(rendered.container.querySelector('line')).toHaveAttribute(
    'stroke',
    'currentColor',
  );
  expect(
    rendered.container.querySelector('[data-testid="edge-direction"]'),
  ).not.toBeInTheDocument();
});

it('retains physical StopPlace pointer and keyboard activation', () => {
  const projection = projectVehicleMovementSvg(physicalScenario, []);
  const node = projection.nodes.find((candidate) => candidate.stopPlaceId)!;
  const onSelectionChange = vi.fn();
  const rendered = render(
    <svg>
      <StaticScenarioSvgLayer
        edges={[]}
        nodes={[node]}
        selection={null}
        onSelectionChange={onSelectionChange}
      />
    </svg>,
  );
  const stop = rendered.getByRole('button');

  fireEvent.keyDown(stop, { key: 'ArrowRight' });
  fireEvent.keyDown(stop, { key: 'Enter' });
  fireEvent.keyDown(stop, { key: ' ' });
  fireEvent.click(stop);

  expect(onSelectionChange).toHaveBeenCalledTimes(3);
  expect(onSelectionChange).toHaveBeenLastCalledWith({
    kind: 'stop',
    stopPlaceId: node.stopPlaceId,
  });
  rendered.rerender(
    <svg>
      <StaticScenarioSvgLayer
        edges={[]}
        nodes={[node]}
        selection={{ kind: 'stop', stopPlaceId: node.stopPlaceId! }}
        onSelectionChange={onSelectionChange}
      />
    </svg>,
  );
  expect(rendered.getByRole('button')).toHaveAttribute('data-selected', 'true');
});
