import type { D3dMapModel } from '../representation/d3d-map-model.js';
import type { ScenarioPopulationView } from '../population/population-field-loader.js';
import type { SettlementMetadataView } from '../settlement/settlement-metadata-loader.js';
import type { CellLevel } from '../representation/street-cells.js';
export type PreparationJob =
  | Readonly<{ kind: 'asset'; url: string }>
  | Readonly<{ kind: 'terrain'; city: string; scenario: string }>
  | Readonly<{ kind: 'cells'; city: string; level: CellLevel }>
  | Readonly<{ kind: 'roads'; city: string; level: CellLevel }>
  | Readonly<{
      kind: 'compose';
      identity: string;
      sceneIdentity: string;
      resolveResearch?: boolean;
      city: string;
      scenario: string;
      model: D3dMapModel;
      population: ScenarioPopulationView;
      metadata:
        Extract<SettlementMetadataView, { status: 'ready' }> | undefined;
      scale: number;
    }>;
export interface PreparationWorker {
  postMessage(message: unknown, buffers?: Transferable[]): void;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
  terminate(): void;
}
export const preparationProtocolVersion = 1;
export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
