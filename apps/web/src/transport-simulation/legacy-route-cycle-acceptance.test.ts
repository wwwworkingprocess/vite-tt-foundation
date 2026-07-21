import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  advanceTransportTicks,
  applyTransportVehicleCommand,
  createScenarioCoordinate,
  createTransportSimulationState,
} from '@torrevieja-tycoon/simulation';
import { createScenarioLoader } from '../scenarios/scenario-loader.js';
import { createDemoVehicleCommandForAuthority } from '../transport-representation/demo-vehicle-command.js';
import { projectVehicleMovementSvg } from '../transport-representation/vehicle-svg-projection.js';

const publicRoot = join(import.meta.dirname, '..', '..', 'public');

describe('legacy A/B/C route-cycle acceptance', () => {
  it('uses canonical Route C legs and performs the explicit 0207 to 0209 handoff', async () => {
    const loader = createScenarioLoader({
      baseUrl: '/',
      fetchText: async (url) => {
        try {
          const text = await readFile(join(publicRoot, url.slice(1)), 'utf8');
          return { ok: true, text: async () => text };
        } catch {
          return { ok: false, text: async () => '' };
        }
      },
      digestSha256: async (text) =>
        createHash('sha256').update(text).digest('hex'),
    });
    await loader.loadCatalog();
    await loader.loadScenario('torrevieja-legacy-abc-v1');
    const scenario = loader.projection.getState().scenario!;
    const coordinate = createScenarioCoordinate(scenario);
    const command = createDemoVehicleCommandForAuthority(
      coordinate,
      () => scenario,
      [],
      'legacy-C',
    );
    expect(command.legs.map((leg) => leg.patternId)).toEqual([
      'legacy-C-torrevieja-lomas',
      'legacy-C-lomas-torrevieja-via-quiron',
    ]);
    let state = createTransportSimulationState(scenario, 0);
    state = applyTransportVehicleCommand(state, command);
    state = applyTransportVehicleCommand(state, {
      kind: 'transport.vehicle.start',
      vehicleId: command.vehicleId,
    });
    const outboundTicks = command.legs[0]!.movementPlan.edgeTravelTicks.reduce(
      (sum, ticks) => sum + ticks,
      0,
    );
    const terminal = advanceTransportTicks(state, outboundTicks);
    expect(terminal.fleet[0]).toMatchObject({
      routeId: 'legacy-C',
      routeLegIndex: 0,
      patternId: 'legacy-C-torrevieja-lomas',
      movement: {
        kind: 'running-at-stop',
        stopNodeId: 'tv-stop-0207',
      },
    });
    expect(
      terminal.graph
        .outgoingEdges('tv-stop-0207')
        .some((edge) => edge.toStopNodeId === 'tv-stop-0209'),
    ).toBe(false);
    const svg = projectVehicleMovementSvg(scenario, terminal.fleet);
    expect(svg.nodes).toHaveLength(98);
    expect(svg.edges).toHaveLength(111);
    expect(svg.vehicles[0]).toMatchObject({
      routeId: 'legacy-C',
      patternId: 'legacy-C-torrevieja-lomas',
      routeLegIndex: 0,
      completedRouteCycles: 0,
    });
    expect(advanceTransportTicks(terminal, 1).fleet[0]).toMatchObject({
      routeLegIndex: 1,
      patternId: 'legacy-C-lomas-torrevieja-via-quiron',
      movement: {
        kind: 'running-on-edge',
        fromStopNodeId: 'tv-stop-0209',
        progressTicks: 1,
      },
    });
  });
});
