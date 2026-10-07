export function terrainFixture() {
  const viewport = {
    terrainViewportId: 'test-viewport',
    width: 3,
    height: 3,
    rasterBounds3035: {
      west: 3375000,
      south: 1720000,
      east: 3375075,
      north: 1720075,
    },
    rowOrder: 'north-to-south',
    columnOrder: 'west-to-east',
    storageOrder: 'row-major',
  };
  const mapping = {
    a: viewport.terrainViewportId,
    b: viewport.terrainViewportId,
  };
  const product = (path: string, mediaType = 'application/json') => ({
    path,
    mediaType,
    schemaVersion: '0.0.0',
    byteLength: 1,
    sha256: 'a'.repeat(64),
  });
  const entry = {
    terrainVersion: 'v0',
    crs: 'EPSG:3035',
    resolutionMeters: { x: 25, y: 25 },
    scenarioIds: ['a', 'b'],
    scenarioViewportMap: mapping,
    viewports: [viewport],
    products: {
      height: product('test/height.json'),
      surfaceMask: product('test/mask.json'),
      coastline: product('test/coast.geojson', 'application/geo+json'),
    },
  };
  const common = {
    schemaVersion: '0.0.0',
    settlementId: 'test',
    crs: 'EPSG:3035',
    resolutionMetersX: 25,
    resolutionMetersY: 25,
    scenarioViewportMap: mapping,
  };
  return {
    catalog: {
      schemaVersion: '0.0.0',
      purpose: 'test',
      pathSemantics: 'product paths are relative to this catalog file',
      settlements: { test: entry },
    },
    height: {
      ...common,
      viewports: [
        {
          ...viewport,
          elevationUnit: 'm',
          elevations: [-4, 0, 4, 4, 8, 12, null, null, null],
        },
      ],
    },
    surfaceMask: {
      ...common,
      derivationRule: 'prepared-coastal-eudem-finite-land-null-water-v0',
      viewports: [
        {
          ...viewport,
          encoding: 'row-major-0-water-1-land',
          cells: [1, 1, 1, 1, 1, 1, 0, 0, 0],
        },
      ],
    },
    coastline: {
      type: 'FeatureCollection',
      schemaVersion: '0.0.0',
      settlementId: 'test',
      coordinateReferenceSystem: 'EPSG:3035',
      coordinateUnit: 'm',
      geoJsonProfile: 'workbench-projected-v0',
      sourceMaskSchemaVersion: '0.0.0',
      sourceViewportIds: ['test-viewport'],
      features: [],
    },
  };
}
