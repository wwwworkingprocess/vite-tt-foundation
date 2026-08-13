import {
  listActivePopulationCells,
  parseCityPopulationGrid,
  type ActivePopulationCell,
  type CanonicalScenario,
  type CityPopulationGrid,
} from '@torrevieja-tycoon/transport-domain';

export interface PopulationCropWindow {
  readonly rowStart: number;
  readonly rowEnd: number;
  readonly columnStart: number;
  readonly columnEnd: number;
}

export interface ScenarioPopulationView {
  readonly grid: CityPopulationGrid;
  readonly crop: Readonly<PopulationCropWindow>;
  readonly canonicalCells: readonly Readonly<ActivePopulationCell>[];
  readonly totalPopulationWeight: number;
  readonly nonzeroCellCount: number;
  readonly gridSha256: string;
  readonly cropSha256: string;
  readonly demandModelContentHash: string;
  readonly operationalCropPolicy: Readonly<{
    maxAccessDistanceCells: number;
  }>;
}

interface TextResponse {
  readonly ok: boolean;
  text(): Promise<string>;
}

interface PopulationCityEntry {
  readonly primarySettlementId: string;
  readonly gridPath: string;
  readonly cropPath: string;
  readonly gridSha256: string;
  readonly cropSha256: string;
}

interface PopulationCatalogue {
  readonly schemaVersion: '1.0.0';
  readonly operationalCropPolicy: Readonly<{
    maxAccessDistanceCells: number;
  }>;
  readonly cities: readonly PopulationCityEntry[];
}

const sha256Pattern = /^[0-9a-f]{64}$/;
const deepFreeze = <T>(value: T): T => {
  if (value === null || typeof value !== 'object') return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;
const requireString = (value: unknown, context: string) => {
  if (typeof value !== 'string' || value.length === 0)
    throw new Error(`Invalid population field ${context}`);
  return value;
};
const requireIndex = (value: unknown, context: string) => {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new Error(`Invalid population field ${context}`);
  return value as number;
};
const joinAssetUrl = (baseUrl: string, path: string) =>
  `${baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`}population-fields/${path}`;

const parseCatalogue = (value: unknown): PopulationCatalogue => {
  if (
    !isRecord(value) ||
    value.schemaVersion !== '1.0.0' ||
    !isRecord(value.operationalCropPolicy) ||
    !Number.isSafeInteger(value.operationalCropPolicy.maxAccessDistanceCells) ||
    (value.operationalCropPolicy.maxAccessDistanceCells as number) <= 0 ||
    !Array.isArray(value.cities)
  )
    throw new Error('Invalid population field catalogue');
  const cities = value.cities.map((city, index) => {
    if (!isRecord(city))
      throw new Error(`Invalid population field city ${index}`);
    const entry = {
      primarySettlementId: requireString(
        city.primarySettlementId,
        'settlement',
      ),
      gridPath: requireString(city.gridPath, 'grid path'),
      cropPath: requireString(city.cropPath, 'crop path'),
      gridSha256: requireString(city.gridSha256, 'grid hash'),
      cropSha256: requireString(city.cropSha256, 'crop hash'),
    };
    if (
      !sha256Pattern.test(entry.gridSha256) ||
      !sha256Pattern.test(entry.cropSha256)
    )
      throw new Error('Invalid population field asset hash');
    return entry;
  });
  return deepFreeze({
    schemaVersion: '1.0.0' as const,
    operationalCropPolicy: {
      maxAccessDistanceCells: value.operationalCropPolicy
        .maxAccessDistanceCells as number,
    },
    cities,
  });
};

const parseCrop = (
  value: unknown,
  scenario: CanonicalScenario,
): PopulationCropWindow => {
  if (!isRecord(value) || !Array.isArray(value.scenarios))
    throw new Error('Invalid population field crop catalogue');
  const scenarios = value.scenarios as unknown[];
  const record = scenarios.find(
    (candidate) =>
      isRecord(candidate) &&
      candidate.scenarioId === scenario.manifest.scenarioId &&
      (candidate.catalogContentHash === scenario.manifest.contentHash ||
        candidate.contentHash === scenario.manifest.contentHash),
  );
  if (!isRecord(record) || !isRecord(record.crop))
    throw new Error(
      `Population field crop missing for ${scenario.manifest.scenarioId}`,
    );
  return deepFreeze({
    rowStart: requireIndex(record.crop.rowStart, 'rowStart'),
    rowEnd: requireIndex(record.crop.rowEnd, 'rowEnd'),
    columnStart: requireIndex(record.crop.columnStart, 'columnStart'),
    columnEnd: requireIndex(record.crop.columnEnd, 'columnEnd'),
  });
};

export function createPopulationFieldLoader(input: {
  readonly baseUrl: string;
  readonly fetchText: (url: string) => Promise<TextResponse>;
  readonly digestSha256: (text: string) => Promise<string>;
}) {
  let cataloguePromise: Promise<PopulationCatalogue> | undefined;
  const assetCache = new Map<string, Promise<string>>();
  const fetchAsset = (path: string, hash: string) => {
    const key = `${path}:${hash}`;
    const cached = assetCache.get(key);
    if (cached) return cached;
    const request = (async () => {
      const response = await input.fetchText(joinAssetUrl(input.baseUrl, path));
      if (!response.ok)
        throw new Error(`Population field asset unavailable: ${path}`);
      const text = await response.text();
      if ((await input.digestSha256(text)) !== hash)
        throw new Error(`Population field integrity mismatch: ${path}`);
      return text;
    })();
    assetCache.set(key, request);
    void request.catch(() => {
      assetCache.delete(key);
    });
    return request;
  };
  const loadCatalogue = () => {
    if (cataloguePromise) return cataloguePromise;
    const request = (async () => {
      const response = await input.fetchText(
        joinAssetUrl(input.baseUrl, 'catalog.json'),
      );
      if (!response.ok)
        throw new Error('Population field catalogue unavailable');
      return parseCatalogue(JSON.parse(await response.text()) as unknown);
    })();
    cataloguePromise = request;
    void request.catch(() => {
      cataloguePromise = undefined;
    });
    return request;
  };

  return deepFreeze({
    async resolveScenarioPopulation(
      scenario: CanonicalScenario,
    ): Promise<ScenarioPopulationView> {
      const catalogue = await loadCatalogue();
      const entry = catalogue.cities.find(
        (city) =>
          city.primarySettlementId === scenario.manifest.primarySettlementId,
      );
      if (!entry)
        throw new Error(
          `Population field unavailable for ${scenario.manifest.primarySettlementId}`,
        );
      const [gridText, cropText] = await Promise.all([
        fetchAsset(entry.gridPath, entry.gridSha256),
        fetchAsset(entry.cropPath, entry.cropSha256),
      ]);
      const canonicalGrid = parseCityPopulationGrid(
        JSON.parse(gridText) as unknown,
      );
      const crop = parseCrop(JSON.parse(cropText) as unknown, scenario);
      if (
        crop.rowStart >= crop.rowEnd ||
        crop.columnStart >= crop.columnEnd ||
        crop.rowEnd > canonicalGrid.rows ||
        crop.columnEnd > canonicalGrid.columns
      )
        throw new Error(
          `Population field crop outside canonical grid for ${scenario.manifest.scenarioId}`,
        );
      const grid = parseCityPopulationGrid({
        ...canonicalGrid,
        originCellCenter: {
          latitude:
            canonicalGrid.originCellCenter.latitude -
            crop.rowStart * canonicalGrid.resolutionDegrees,
          longitude:
            canonicalGrid.originCellCenter.longitude +
            crop.columnStart * canonicalGrid.resolutionDegrees,
        },
        rows: crop.rowEnd - crop.rowStart,
        columns: crop.columnEnd - crop.columnStart,
        populationWeights: canonicalGrid.populationWeights
          .slice(crop.rowStart, crop.rowEnd)
          .map((row) => row.slice(crop.columnStart, crop.columnEnd)),
      });
      const localCells = listActivePopulationCells(grid);
      const canonicalCells = localCells.map((cell) =>
        deepFreeze({
          ...cell,
          cellId:
            `r${cell.row + crop.rowStart}c${cell.column + crop.columnStart}` as ActivePopulationCell['cellId'],
          row: cell.row + crop.rowStart,
          column: cell.column + crop.columnStart,
        }),
      );
      const totalPopulationWeight = localCells.reduce(
        (total, cell) => total + cell.populationWeight,
        0,
      );
      if (!Number.isSafeInteger(totalPopulationWeight))
        throw new Error('Population field weight overflow');
      const demandModelContentHash = await input.digestSha256(
        JSON.stringify({
          kind: 'population-demand-model-v1',
          gridSha256: entry.gridSha256,
          rowStart: crop.rowStart,
          rowEnd: crop.rowEnd,
          columnStart: crop.columnStart,
          columnEnd: crop.columnEnd,
          maxAccessDistanceCells:
            catalogue.operationalCropPolicy.maxAccessDistanceCells,
        }),
      );
      return deepFreeze({
        grid,
        crop,
        canonicalCells,
        totalPopulationWeight,
        nonzeroCellCount: localCells.length,
        gridSha256: entry.gridSha256,
        cropSha256: entry.cropSha256,
        demandModelContentHash,
        operationalCropPolicy: catalogue.operationalCropPolicy,
      });
    },
  });
}
