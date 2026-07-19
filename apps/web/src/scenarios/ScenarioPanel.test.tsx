import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => {
  const state = {
    status: 'ready' as const,
    selectedScenarioId: 'torrevieja-v1',
    title: 'Torrevieja',
    settlementCount: 1,
    routeCount: 1,
    catalog: {
      scenarios: [{ scenarioId: 'torrevieja-v1', title: 'Torrevieja' }],
    },
    graph: { summary: { nodes: 231, routes: 1, patterns: 2, edges: 6 } },
    scenario: { manifest: { scenarioId: 'torrevieja-v1' } },
  };
  let authorityListener: ((state: unknown) => void) | undefined;
  const controller = {
    projection: {
      subscribe: vi.fn((listener: (state: unknown) => void) => {
        authorityListener = listener;
        return () => undefined;
      }),
    },
    startNew: vi.fn(async () => {
      authorityListener?.({
        status: 'ready',
        scenario: {
          scenarioSchemaVersion: '1.0.0',
          scenarioId: 'torrevieja-v1',
          scenarioVersion: '1.0.0',
          contentHash: 'a'.repeat(64),
        },
        simulationTick: 0,
      });
    }),
    advanceTicks: vi.fn(async () => undefined),
    save: vi.fn(async () => undefined),
    restore: vi.fn(async () => undefined),
    close: vi.fn(async () => {
      authorityListener?.({ status: 'failed', message: 'close failed' });
    }),
  };
  return {
    state,
    loadCatalog: vi.fn(async () => undefined),
    loadScenario: vi.fn(async () => undefined),
    controller,
    controllerInput: undefined as unknown as {
      scenarioResolver: {
        resolve(coordinate: {
          scenarioSchemaVersion: string;
          scenarioId: string;
          scenarioVersion: string;
          contentHash: string;
        }): Promise<unknown>;
      };
    },
  };
});
vi.mock('@torrevieja-tycoon/simulation', () => ({
  createScenarioCoordinate: () => ({
    scenarioSchemaVersion: '1.0.0',
    scenarioId: 'torrevieja-v1',
    scenarioVersion: '1.0.0',
    contentHash: 'a'.repeat(64),
  }),
  scenarioCoordinatesEqual: (
    left: Record<string, unknown>,
    right: Record<string, unknown>,
  ) => JSON.stringify(left) === JSON.stringify(right),
}));
vi.mock('../transport-simulation/browser-transport-worker.js', () => ({
  createBrowserTransportWorker: vi.fn(),
  isBrowserTransportWorkerAvailable: () => true,
}));
vi.mock('../transport-simulation/worker-transport-client.js', () => ({
  createWorkerTransportSimulationClient: vi.fn(),
}));
vi.mock('../transport-simulation/transport-controller.js', () => ({
  createTransportApplicationController: (
    input: typeof fake.controllerInput,
  ) => {
    fake.controllerInput = input;
    return fake.controller;
  },
}));
vi.mock('../transport-simulation/transport-save-repository.js', () => ({
  createDexieTransportSaveRepository: () => ({ close: vi.fn() }),
}));
vi.mock('./scenario-loader.js', () => ({
  browserSha256: vi.fn(),
  createScenarioLoader: () => ({
    projection: {
      getState: () => fake.state,
      subscribe: (listener: (state: typeof fake.state) => void) => {
        listener(fake.state);
        return () => undefined;
      },
    },
    loadCatalog: fake.loadCatalog,
    loadScenario: fake.loadScenario,
  }),
}));

import { ScenarioPanel } from './ScenarioPanel.js';

it('presents the selected scenario summary and selection action', async () => {
  render(<ScenarioPanel />);
  expect(await screen.findByText('231')).toBeInTheDocument();
  expect(screen.getByText('Directed edges').nextSibling).toHaveTextContent('6');
  fireEvent.change(screen.getByLabelText('Scenario'), {
    target: { value: 'torrevieja-v1' },
  });
  expect(fake.loadScenario).toHaveBeenCalledWith('torrevieja-v1');
  fireEvent.click(
    screen.getByRole('button', { name: 'Start selected scenario' }),
  );
  expect(
    await screen.findByText(/Authoritative scenario: torrevieja-v1@1.0.0/),
  ).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole('button', { name: 'Advance selected scenario' }),
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Save selected scenario' }),
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Restore selected scenario' }),
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Close selected scenario' }),
  );
  expect(fake.controller.advanceTicks).toHaveBeenCalledWith(1);
  expect(fake.controller.save).toHaveBeenCalled();
  expect(fake.controller.restore).toHaveBeenCalledWith({
    saveId: 'transport-slot',
    timelineId: 'browser-transport-restored-1',
  });
  expect(fake.controller.close).toHaveBeenCalled();
  expect(await screen.findByRole('alert')).toHaveTextContent('close failed');

  const coordinate = {
    scenarioSchemaVersion: '1.0.0',
    scenarioId: 'torrevieja-v1',
    scenarioVersion: '1.0.0',
    contentHash: 'a'.repeat(64),
  };
  await expect(
    fake.controllerInput.scenarioResolver.resolve(coordinate),
  ).resolves.toBe(fake.state.scenario);
  const selected = fake.state.scenario;
  (fake.state as { scenario?: unknown }).scenario = undefined;
  fake.loadScenario.mockImplementationOnce(async () => {
    (fake.state as { scenario?: unknown }).scenario = selected;
  });
  await expect(
    fake.controllerInput.scenarioResolver.resolve(coordinate),
  ).resolves.toBe(selected);
  (fake.state as { scenario?: unknown }).scenario = undefined;
  await expect(
    fake.controllerInput.scenarioResolver.resolve(coordinate),
  ).rejects.toThrow('unavailable');
  (fake.state as { scenario?: unknown }).scenario = selected;
  for (const [field, value] of [
    ['scenarioSchemaVersion', '2.0.0'],
    ['scenarioId', 'different'],
    ['scenarioVersion', '2.0.0'],
    ['contentHash', 'b'.repeat(64)],
  ] as const)
    await expect(
      fake.controllerInput.scenarioResolver.resolve({
        ...coordinate,
        [field]: value,
      }),
    ).rejects.toThrow('unavailable');
});
