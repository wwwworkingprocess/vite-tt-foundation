import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  buildStopCatchments,
  listEligibleStopPlaces,
  parseCityPopulationGrid,
  parseScenarioPackage,
} from '../packages/transport-domain/dist/index.js';

const root = new URL('../', import.meta.url).pathname.replace(/^\/(.:)/, '$1');
const publicRoot = join(root, 'apps/web/public');
const populationRoot = join(publicRoot, 'population-fields');
const write = process.argv.includes('--write');
const json = async (path) => JSON.parse(await readFile(path, 'utf8'));
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const verifyChecksumManifest = async (manifestPath, basePath) => {
  const manifest = await readFile(manifestPath, 'utf8');
  for (const [index, line] of manifest.split(/\r?\n/).entries()) {
    if (line.length === 0) continue;
    const match = /^([0-9a-f]{64}) {2}(.+)$/.exec(line);
    if (!match)
      throw new Error(
        `${manifestPath}: invalid checksum entry on line ${index + 1}`,
      );
    const relativePath = match[2].replace(/^\.\//, '');
    const actual = sha256(await readFile(join(basePath, relativePath), 'utf8'));
    if (actual !== match[1])
      throw new Error(
        `${relativePath}: checksum mismatch in ${manifestPath}; expected ${match[1]}, actual ${actual}`,
      );
  }
};
const checkedAdd = (left, right, context) => {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new Error(`${context} overflow`);
  return result;
};
const scenarioPackage = async (scenarioId) => {
  const descriptor = scenarioCatalogue.scenarios.find(
    (candidate) => candidate.scenarioId === scenarioId,
  );
  if (!descriptor) throw new Error(`Unknown public scenario ${scenarioId}.`);
  const directory = join(
    publicRoot,
    'scenarios',
    descriptor.manifestPath,
    '..',
  );
  const asset = (name) => json(join(directory, name));
  return parseScenarioPackage({
    manifest: await asset('scenario.json'),
    settlements: await asset('settlements.json'),
    stops: await asset('stops.json'),
    routes: await asset('routes.json'),
    presentation: await asset('presentation.json'),
    provenance: await asset('provenance.json'),
  });
};
const rounded = (value) => Number(value.toFixed(7));
const bounds = (grid, window) => ({
  south: rounded(
    grid.originCellCenter.latitude -
      (window.rowEnd - 0.5) * grid.resolutionDegrees,
  ),
  west: rounded(
    grid.originCellCenter.longitude +
      (window.columnStart - 0.5) * grid.resolutionDegrees,
  ),
  north: rounded(
    grid.originCellCenter.latitude -
      (window.rowStart - 0.5) * grid.resolutionDegrees,
  ),
  east: rounded(
    grid.originCellCenter.longitude +
      (window.columnEnd - 0.5) * grid.resolutionDegrees,
  ),
});
const contains = (window, row, column) =>
  row >= window.rowStart &&
  row < window.rowEnd &&
  column >= window.columnStart &&
  column < window.columnEnd;
const reconcileCropRecords = (descriptors, records, settlementId) => {
  const supported = descriptors.filter(
    (descriptor) => descriptor.primarySettlementId === settlementId,
  );
  const descriptorById = new Map(
    supported.map((descriptor) => [descriptor.scenarioId, descriptor]),
  );
  const recordById = new Map();
  for (const record of records) {
    const descriptor = descriptorById.get(record.scenarioId);
    if (!descriptor)
      throw new Error(
        `${record.scenarioId}: population crop references an unknown or unsupported public scenario`,
      );
    if (recordById.has(record.scenarioId))
      throw new Error(`${record.scenarioId}: duplicate population crop record`);
    const recordContentHash = record.catalogContentHash ?? record.contentHash;
    if (recordContentHash !== descriptor.contentHash)
      throw new Error(
        `${record.scenarioId}: stale population crop content hash ${recordContentHash}; expected ${descriptor.contentHash}`,
      );
    recordById.set(record.scenarioId, record);
  }
  for (const descriptor of supported)
    if (!recordById.has(descriptor.scenarioId))
      throw new Error(
        `${descriptor.scenarioId}: population crop record missing`,
      );
  return supported.map((descriptor) => ({
    descriptor,
    record: recordById.get(descriptor.scenarioId),
  }));
};
const canonicalAnchor = (grid, scenarioId, stop) => {
  const rowCoordinate =
    (grid.originCellCenter.latitude - stop.position.latitude) /
    grid.resolutionDegrees;
  const columnCoordinate =
    (stop.position.longitude - grid.originCellCenter.longitude) /
    grid.resolutionDegrees;
  if (
    rowCoordinate < -0.5 ||
    rowCoordinate >= grid.rows - 0.5 ||
    columnCoordinate < -0.5 ||
    columnCoordinate >= grid.columns - 0.5
  )
    throw new Error(
      `${scenarioId}: StopPlace ${stop.stopPlaceId} at ${stop.position.latitude},${stop.position.longitude} lies outside canonical population grid`,
    );
  return {
    row: Math.round(rowCoordinate),
    column: Math.round(columnCoordinate),
    stopPlaceId: stop.stopPlaceId,
  };
};
const expectFailure = (operation, pattern) => {
  assert.throws(operation, pattern);
};
const runFixtureChecks = () => {
  const descriptor = {
    scenarioId: 'fixture',
    primarySettlementId: 'city',
    contentHash: 'current',
  };
  const record = { scenarioId: 'fixture', catalogContentHash: 'current' };
  expectFailure(
    () => reconcileCropRecords([descriptor], [], 'city'),
    /record missing/,
  );
  expectFailure(
    () => reconcileCropRecords([descriptor], [record, record], 'city'),
    /duplicate/,
  );
  expectFailure(
    () =>
      reconcileCropRecords(
        [descriptor],
        [{ ...record, catalogContentHash: 'stale' }],
        'city',
      ),
    /stale/,
  );
  expectFailure(
    () =>
      canonicalAnchor(
        {
          originCellCenter: { latitude: 1, longitude: 1 },
          resolutionDegrees: 0.001,
          rows: 1,
          columns: 1,
        },
        'fixture',
        {
          stopPlaceId: 'outside',
          position: { latitude: 2, longitude: 1 },
        },
      ),
    /outside canonical population grid/,
  );
};
runFixtureChecks();
if (!write) {
  await verifyChecksumManifest(
    join(populationRoot, 'CHECKSUMS.sha256'),
    populationRoot,
  );
  await verifyChecksumManifest(
    join(root, 'PREPARATION-CHECKSUMS.sha256'),
    root,
  );
}

const cataloguePath = join(populationRoot, 'catalog.json');
const catalogue = await json(cataloguePath);
const scenarioCatalogue = await json(
  join(publicRoot, 'scenarios/catalog.json'),
);
const maxAccessDistanceCells =
  catalogue.operationalCropPolicy?.maxAccessDistanceCells;
if (
  !Number.isSafeInteger(maxAccessDistanceCells) ||
  maxAccessDistanceCells <= 0
)
  throw new Error('Population catalogue operational crop policy is invalid');
const reconcileCurrentMetadata = (record, city) => {
  const historicalKeys = [
    'extensionApplied',
    'eligiblePositionedStopPlaceCount',
    'stopPlaceVerificationBasis',
    'everyEligiblePositionedStopPlaceInsideViewport',
    'everyEligiblePositionedStopPlaceInsideCrop',
    'anomalies',
    'representativeOutsideStopPlaces',
    'minimumAlignedExtensionRecommended',
    'stopPlaceSafety',
    'notes',
  ];
  const historical = Object.fromEntries(
    historicalKeys
      .filter((key) => record[key] !== undefined)
      .map((key) => [key, record[key]]),
  );
  const torreviejaExpanded = Boolean(
    record.stopPlaceSafety?.extensionApplied ??
    record.historicalPreparationEvidence?.stopPlaceSafety?.extensionApplied,
  );
  record.historicalPreparationEvidence ??= {
    status: 'historical-round-3-round-4-preparation-evidence',
    ...historical,
  };
  for (const key of historicalKeys) delete record[key];
  record.operationalCropStatus = {
    differsFromAcceptedPreparationCrop:
      city.primarySettlementId === 'es-torrevieja' ? torreviejaExpanded : true,
    everyRouteUsedEligibleStopPlaceAnchorRepresented: true,
    everyRequiredProductionCatchmentCellRepresented: true,
    furtherExtensionRequired: false,
    maxAccessDistanceCells,
  };
};
const reports = [];
for (const city of catalogue.cities) {
  const gridPath = join(populationRoot, city.gridPath);
  const cropPath = join(populationRoot, city.cropPath);
  const gridText = await readFile(gridPath, 'utf8');
  const cropText = await readFile(cropPath, 'utf8');
  if (sha256(gridText) !== city.gridSha256)
    throw new Error(
      `Canonical population grid integrity mismatch: ${city.gridPath}`,
    );
  if (sha256(cropText) !== city.cropSha256)
    throw new Error(
      `Operational population crop integrity mismatch: ${city.cropPath}`,
    );
  const grid = parseCityPopulationGrid(JSON.parse(gridText));
  const scenarioCount = scenarioCatalogue.scenarios.filter(
    (scenario) => scenario.primarySettlementId === city.primarySettlementId,
  ).length;
  const catalogueMetadata = {
    externalCityId: city.externalCityId,
    gridVersion: city.gridVersion,
    rows: city.rows,
    columns: city.columns,
    resolutionDegrees: city.resolutionDegrees,
    scenarioCount: city.scenarioCount,
  };
  const canonicalMetadata = {
    externalCityId: grid.cityId,
    gridVersion: grid.gridVersion,
    rows: grid.rows,
    columns: grid.columns,
    resolutionDegrees: grid.resolutionDegrees,
    scenarioCount,
  };
  if (JSON.stringify(catalogueMetadata) !== JSON.stringify(canonicalMetadata))
    throw new Error(
      `${city.primarySettlementId}: population catalogue metadata does not match canonical grid and public scenarios`,
    );
  const cropDocument = JSON.parse(cropText);
  if (cropDocument.canonicalGrid?.sha256 !== city.gridSha256)
    throw new Error(
      `${city.primarySettlementId}: crop canonical-grid SHA ${cropDocument.canonicalGrid?.sha256} does not match ${city.gridSha256}`,
    );
  const reconciled = reconcileCropRecords(
    scenarioCatalogue.scenarios,
    cropDocument.scenarios,
    city.primarySettlementId,
  );
  let changed = false;
  for (const { descriptor, record } of reconciled) {
    const crop = record.crop;
    if (
      !Number.isSafeInteger(crop.rowStart) ||
      !Number.isSafeInteger(crop.rowEnd) ||
      !Number.isSafeInteger(crop.columnStart) ||
      !Number.isSafeInteger(crop.columnEnd) ||
      crop.rowStart < 0 ||
      crop.columnStart < 0 ||
      crop.rowStart >= crop.rowEnd ||
      crop.columnStart >= crop.columnEnd ||
      crop.rowEnd > grid.rows ||
      crop.columnEnd > grid.columns
    )
      throw new Error(
        `${record.scenarioId}: invalid population crop [${crop.rowStart},${crop.rowEnd})x[${crop.columnStart},${crop.columnEnd}) for ${grid.rows}x${grid.columns} grid`,
      );
    const scenario = await scenarioPackage(record.scenarioId);
    if (scenario.manifest.contentHash !== descriptor.contentHash)
      throw new Error(
        `${record.scenarioId}: parsed scenario content hash does not match public catalogue`,
      );
    const catchment = buildStopCatchments({
      grid,
      scenario,
      maxAccessDistanceCells,
    });
    const eligible = listEligibleStopPlaces(scenario);
    const required = catchment.cellAssignments
      .filter((cell) => cell.assignedStopPlaceId !== null)
      .map((cell) => ({
        row: cell.row,
        column: cell.column,
        stopPlaceId: cell.assignedStopPlaceId,
      }));
    for (const stop of eligible)
      required.push(canonicalAnchor(grid, record.scenarioId, stop));
    const old = { ...record.crop };
    const expected = {
      rowStart: Math.min(old.rowStart, ...required.map((cell) => cell.row)),
      rowEnd: Math.max(old.rowEnd, ...required.map((cell) => cell.row + 1)),
      columnStart: Math.min(
        old.columnStart,
        ...required.map((cell) => cell.column),
      ),
      columnEnd: Math.max(
        old.columnEnd,
        ...required.map((cell) => cell.column + 1),
      ),
    };
    const missing = required.filter(
      (cell) => !contains(record.crop, cell.row, cell.column),
    );
    if (missing.length > 0 && !write) {
      const first = missing[0];
      throw new Error(
        `${record.scenarioId}: StopPlace ${first.stopPlaceId} requires canonical cell r${first.row}c${first.column} outside crop [${old.rowStart},${old.rowEnd})x[${old.columnStart},${old.columnEnd})`,
      );
    }
    if (
      JSON.stringify(expected) !==
      JSON.stringify({
        rowStart: old.rowStart,
        rowEnd: old.rowEnd,
        columnStart: old.columnStart,
        columnEnd: old.columnEnd,
      })
    ) {
      changed = true;
      const weights = grid.populationWeights
        .slice(expected.rowStart, expected.rowEnd)
        .flatMap((row) => row.slice(expected.columnStart, expected.columnEnd));
      const total = weights.reduce(
        (sum, weight) => checkedAdd(sum, weight, record.scenarioId),
        0,
      );
      record.crop = {
        ...expected,
        dimensions: {
          rows: expected.rowEnd - expected.rowStart,
          columns: expected.columnEnd - expected.columnStart,
        },
        alignedGeographicBounds: bounds(grid, expected),
      };
      record.totalIncludedWeight = total;
      record.nonzeroCellCount = weights.filter((weight) => weight > 0).length;
      record.cityWeightPercent =
        (total / cropDocument.canonicalGrid.cityTotalWeight) * 100;
      if (record.stopPlaceSafety) {
        record.stopPlaceSafety.everyRelevantPositionedStopPlaceInsideAlignedCrop = true;
        record.stopPlaceSafety.minimumAlignedExtensionRequired = false;
        record.stopPlaceSafety.extensionApplied = true;
      }
    }
    if (write) {
      const alignedGeographicBounds = bounds(grid, record.crop);
      if (
        JSON.stringify(alignedGeographicBounds) !==
        JSON.stringify(record.crop.alignedGeographicBounds)
      )
        changed = true;
      record.crop.alignedGeographicBounds = alignedGeographicBounds;
    }
    reports.push({
      scenarioId: record.scenarioId,
      old,
      current: record.crop,
      eligibleStopPlaces: eligible.length,
      outsideOldCrop: required.filter(
        (cell) => !contains(old, cell.row, cell.column),
      ).length,
      outsideCurrentCrop: required.filter(
        (cell) => !contains(record.crop, cell.row, cell.column),
      ).length,
      requiredCells: required.length,
    });
    if (write) {
      reconcileCurrentMetadata(record, city);
      changed = true;
    }
  }
  if (write) {
    cropDocument.historicalPreparation ??= {
      status: 'historical-round-3-round-4-preparation-evidence',
      purpose: cropDocument.purpose,
      ...(cropDocument.generatedForReviewOn
        ? { generatedForReviewOn: cropDocument.generatedForReviewOn }
        : {}),
      ...(cropDocument.commonCropSummary
        ? { commonCropSummary: cropDocument.commonCropSummary }
        : {}),
      ...(cropDocument.stopPlaceValidation
        ? { stopPlaceValidation: cropDocument.stopPlaceValidation }
        : {}),
    };
    cropDocument.purpose = `${city.primarySettlementId} current deterministic operational population crop metadata`;
    cropDocument.operationalCropPolicy = { maxAccessDistanceCells };
    cropDocument.operationalStatus = {
      allSupportedScenarioCropsSufficient: true,
      scenarioViewportsUnchanged: true,
    };
    delete cropDocument.generatedForReviewOn;
    delete cropDocument.commonCropSummary;
    delete cropDocument.stopPlaceValidation;
  }
  if (changed && write) {
    const text = `${JSON.stringify(cropDocument, null, 2)}\n`;
    await writeFile(cropPath, text);
    city.cropSha256 = sha256(text);
    city.cropAnomalyScenarioIds = [];
  }
}

if (write) {
  await writeFile(cataloguePath, `${JSON.stringify(catalogue, null, 2)}\n`);
  const files = [
    'catalog.json',
    ...catalogue.cities.flatMap((city) => [city.gridPath, city.cropPath]),
  ];
  const checksums = [];
  for (const path of files) {
    const text = await readFile(join(populationRoot, path), 'utf8');
    checksums.push(`${sha256(text)}  ${path.replaceAll('\\', '/')}`);
  }
  await writeFile(
    join(populationRoot, 'CHECKSUMS.sha256'),
    `${checksums.join('\n')}\n`,
  );
  const preparationPath = join(root, 'PREPARATION-CHECKSUMS.sha256');
  const preparationFiles = (await readFile(preparationPath, 'utf8'))
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.slice(66).replace(/^\.\//, ''));
  const preparationChecksums = [];
  for (const path of preparationFiles)
    preparationChecksums.push(
      `${sha256(await readFile(join(root, path), 'utf8'))}  ./${path.replaceAll('\\', '/')}`,
    );
  await writeFile(preparationPath, `${preparationChecksums.join('\n')}\n`);
  await verifyChecksumManifest(
    join(populationRoot, 'CHECKSUMS.sha256'),
    populationRoot,
  );
  await verifyChecksumManifest(preparationPath, root);
}

console.log(JSON.stringify(reports, null, 2));
