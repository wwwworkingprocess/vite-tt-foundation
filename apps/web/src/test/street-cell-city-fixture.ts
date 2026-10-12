import { readFileSync } from '../../../../scripts/public-layer-files.mjs';
import { join } from 'node:path';
import {
  parseScenarioPackage,
  parseCityPopulationGrid,
  listActivePopulationCells,
} from '@torrevieja-tycoon/transport-domain';
import { parseSettlementMetadata } from '../settlement/settlement-metadata.js';
import { createTransportMapProjection } from '../representation/transport-map-projection.js';
import { createD3dMapModel } from '../representation/d3d-map-model.js';
import {
  parseStreetCellCatalog,
  decodeStreetCells,
  decodeStreetCellAnnotations,
} from '../representation/street-cells.js';
const root = join(import.meta.dirname, '../../public');
const json = (path: string): unknown =>
  JSON.parse(readFileSync(join(root, path), 'utf8'));
const base = 'scenarios/torrevieja-v1/torrevieja-legacy-all-v1/';
export const cellCityScenario = parseScenarioPackage({
  manifest: json(base + 'scenario.json'),
  settlements: json(base + 'settlements.json'),
  stops: json(base + 'stops.json'),
  routes: json(base + 'routes.json'),
  presentation: json(base + 'presentation.json'),
  provenance: json(base + 'provenance.json'),
});
export const cellCityMap = createD3dMapModel(
  createTransportMapProjection(cellCityScenario),
);
export const cellCityMetadata = {
  status: 'ready',
  sha256: 'real-research',
  primarySettlementId: 'es-torrevieja',
  metadata: parseSettlementMetadata(
    json(
      'settlement-metadata/torrevieja/torrevieja-settlement-metadata.v0.json',
    ),
  ),
} as const;
const grid = parseCityPopulationGrid(
  json(
    'population-fields/torrevieja-v1/torrevieja-city-population-grid-v1.round2.json',
  ),
);
const crops = json(
  'population-fields/torrevieja-v1/torrevieja-population-grid-round3-crops.json',
) as {
  scenarios: {
    scenarioId: string;
    crop: {
      rowStart: number;
      rowEnd: number;
      columnStart: number;
      columnEnd: number;
    };
  }[];
};
const crop = crops.scenarios.find(
  (c) => c.scenarioId === cellCityScenario.manifest.scenarioId,
)!.crop;
export const cellCityPopulation = {
  grid,
  crop,
  canonicalCells: listActivePopulationCells(grid).filter(
    (c) =>
      c.row >= crop.rowStart &&
      c.row < crop.rowEnd &&
      c.column >= crop.columnStart &&
      c.column < crop.columnEnd,
  ),
};
const entry = parseStreetCellCatalog(json('street-cells/catalog.json'))
  .settlements['es-torrevieja']!;
const source = decodeStreetCells(
  json('street-cells/' + entry.products[2]!.path),
  'es-torrevieja',
  entry.products[2]!,
);
export const cellCityCells = Object.freeze({
  ...source,
  annotations: decodeStreetCellAnnotations(
    json('street-cells/' + entry.annotations.path),
    source,
    entry.source.products[2]!.sha256,
  ),
});

import {
  parseTerrainCatalog,
  resolveTerrainViewport,
} from '../terrain/terrain-catalog.js';
import { terrainJsonDecoder } from '../terrain/terrain-json-decoder.js';
import { createD3dTerrain } from '../representation/d3d-terrain-model.js';
const terrainResolution = resolveTerrainViewport(
  parseTerrainCatalog(json('terrain/catalog.json')),
  'es-torrevieja',
  cellCityScenario.manifest.scenarioId,
)!;
export const cellCityTerrain = createD3dTerrain(
  terrainJsonDecoder.decode(
    Object.fromEntries(
      Object.entries(terrainResolution.entry.products).map(([k, p]) => [
        k,
        json('terrain/' + p.path),
      ]),
    ) as { height: unknown; surfaceMask: unknown; coastline: unknown },
    terrainResolution,
  ),
  cellCityMap,
);

/** Catalog-discovered second-city fixture; no invented settlement research. */
export function alicanteCellCityFixture() {
  const catalog = json('scenarios/catalog.json') as {
    scenarios: { scenarioId: string; manifestPath: string }[];
  };
  const path = catalog.scenarios
    .find((s) => s.scenarioId === 'alicante-legacy-core-v1')!
    .manifestPath.replace(/scenario\.json$/, '');
  const scenario = parseScenarioPackage(
    Object.fromEntries(
      [
        'manifest',
        'settlements',
        'stops',
        'routes',
        'presentation',
        'provenance',
      ].map((k) => [
        k,
        json(
          'scenarios/' + path + (k === 'manifest' ? 'scenario' : k) + '.json',
        ),
      ]),
    ) as Parameters<typeof parseScenarioPackage>[0],
  );
  const model = createD3dMapModel(createTransportMapProjection(scenario));
  const populationCatalog = json('population-fields/catalog.json') as {
    cities: {
      primarySettlementId: string;
      gridPath: string;
      cropPath: string;
    }[];
  };
  const p = populationCatalog.cities.find(
    (c) => c.primarySettlementId === 'es-alicante',
  )!;
  const grid = parseCityPopulationGrid(json('population-fields/' + p.gridPath));
  const crops = json('population-fields/' + p.cropPath) as {
    scenarios: { scenarioId: string; crop: typeof cellCityPopulation.crop }[];
  };
  const crop = crops.scenarios.find(
    (c) => c.scenarioId === scenario.manifest.scenarioId,
  )!.crop;
  const population = {
    grid,
    crop,
    canonicalCells: listActivePopulationCells(grid).filter(
      (c) =>
        c.row >= crop.rowStart &&
        c.row < crop.rowEnd &&
        c.column >= crop.columnStart &&
        c.column < crop.columnEnd,
    ),
  };
  const e = parseStreetCellCatalog(json('street-cells/catalog.json'))
    .settlements['es-alicante']!;
  const base = decodeStreetCells(
    json('street-cells/' + e.products[2]!.path),
    'es-alicante',
    e.products[2]!,
  );
  const cells = Object.freeze({
    ...base,
    annotations: decodeStreetCellAnnotations(
      json('street-cells/' + e.annotations.path),
      base,
      e.source.products[2]!.sha256,
    ),
  });
  const resolved = resolveTerrainViewport(
    parseTerrainCatalog(json('terrain/catalog.json')),
    'es-alicante',
    scenario.manifest.scenarioId,
  )!;
  const terrain = createD3dTerrain(
    terrainJsonDecoder.decode(
      Object.fromEntries(
        Object.entries(resolved.entry.products).map(([k, p]) => [
          k,
          json('terrain/' + p.path),
        ]),
      ) as { height: unknown; surfaceMask: unknown; coastline: unknown },
      resolved,
    ),
    model,
  );
  return { scenario, model, population, cells, terrain };
}
