import {
  freezeSettlement,
  type BuildingProfile,
  type SettlementMetadata,
} from '../settlement/settlement-metadata.js';
import type { SettlementPopulationOverlay } from '../settlement/settlement-population-overlay.js';
import {
  pointInPolygon,
  lookupSettlementContext,
  landmarkReservationMetres,
  polygonArea,
} from '../settlement/settlement-metadata-spatial.js';
import {
  d3dProjectedPoint,
  d3dGeographicPoint,
  d3dMetreScale,
  type D3dMapModel,
  type D3dWorldPoint,
} from './d3d-map-model.js';
import type {
  CityBuilding,
  UrbanBlock,
  ProceduralCity,
} from './d3d-city-model.js';
import {
  citySeed,
  distanceToCorridor,
  type UrbanCorridor,
} from './d3d-city-spatial.js';

/** Known V0 descriptors only: a restrained presentation palette, never natural-language inference. */
const palette: Readonly<Record<string, string>> = {
  'white render': '#ece8dc',
  'white stucco': '#ece8dc',
  'warm cream render': '#dfd2b5',
  'cream render': '#e3d8bf',
  'light cream render': '#e3d8bf',
  'pale sand render': '#d6c6a6',
  'light stone/ceramic accents': '#cec6b4',
  'pale ochre render': '#d3bf9b',
  'light masonry accents': '#cec6b4',
  'light beige render': '#ded3bc',
  'pale grey render': '#cbcfc8',
  'light render panels': '#d3d5cd',
  'neutral cladding': '#b7c0b9',
  'glazed entrance zones': '#9cabac',
  'light metal panel': '#c0c8c4',
  'neutral render': '#c8c8ba',
  'concrete block': '#b7b9ad',
  'project-specific neutral façade': '#d3d4c8',
  'light render': '#deded2',
  'glass/metal accents': '#a7babc',
  'light concrete': '#c1c3b7',
  'white parapet': '#dfdfd1',
  'terrace finish': '#c8bca3',
  'flat light roof': '#c6c8bb',
  'terracotta red': '#ad775e',
  'warm clay': '#b58a6b',
  'terracotta accents': '#ae8064',
  'flat membrane roof': '#9baba5',
  'industrial roof': '#9aa9a5',
  'industrial metal': '#99aaa7',
  'flat roof': '#c2c6bc',
};
export const settlementPaletteColor = (token: string): string =>
  palette[token] ?? '#d2cdbb';
export function selectDevelopmentProfile(
  metadata: SettlementMetadata,
  mix: SettlementMetadata['zones'][number]['buildingProfileMix'],
  seed: number,
): BuildingProfile {
  let remaining = (seed % 10000) / 10000;
  let selected = mix.at(-1)!;
  for (const entry of mix) {
    remaining -= entry.weight;
    if (remaining < 0) {
      selected = entry;
      break;
    }
  }
  return metadata.buildingProfiles.find(
    (profile) => profile.id === selected.buildingProfileId,
  )!;
}
const sample = (
  range: { readonly min: number; readonly max: number },
  seed: number,
) => range.min + (range.max - range.min) * ((seed % 1000) / 999);
const geo = (model: D3dMapModel, point: readonly [number, number]) =>
  d3dProjectedPoint(model, { longitude: point[0], latitude: point[1] });

/** Static metre-based presentation. Population controls occupancy, never morphology authority. */
export function generateMetadataCity(
  model: D3dMapModel,
  settlement: SettlementPopulationOverlay,
  fallback: ProceduralCity,
): ProceduralCity {
  const { population, metadata } = settlement;
  const metre = d3dMetreScale(model).worldUnitsPerMetre;
  const corridors = fallback.corridors.map((road) => ({
    ...road,
    width: 12 * metre,
  }));
  const reservations = metadata.landmarks.map((landmark) => ({
    ...geo(model, landmark.coordinate),
    id: landmark.id,
    radius: landmarkReservationMetres(metadata, landmark) * metre,
  }));
  const landscapes = [
    ...metadata.zones
      .map((zone) => ({ zone, area: polygonArea(zone.boundary) }))
      .sort((a, b) => b.area - a.area || b.zone.id.localeCompare(a.zone.id))
      .map(({ zone }, i) => ({
        color: {
          'very-low': '#a9b892',
          low: '#acb997',
          medium: '#b4bc9d',
          high: '#bbb899',
          'very-high': '#c1bc9f',
        }[zone.densityCharacter],
        surfaceY: 0.015 + (i / metadata.zones.length) * 0.006,
        rings: zone.boundary.coordinates.map((ring) =>
          ring.map((point) => geo(model, point)),
        ),
      })),
    ...metadata.landscapeRegions
      .map((region) => ({
        region,
        hard: Number(region.buildability === 'none'),
        water: Number(region.type === 'sea' || region.type === 'lagoon'),
      }))
      .sort(
        (a, b) =>
          a.hard - b.hard ||
          a.water - b.water ||
          a.region.id.localeCompare(b.region.id),
      )
      .map(({ region }, i) => ({
        surfaceY: 0.026 + (i / metadata.landscapeRegions.length) * 0.003,
        color:
          region.type === 'sea' || region.type === 'lagoon'
            ? '#8fb8bb'
            : region.type === 'wetland'
              ? '#97ad97'
              : '#a4b78f',
        rings: region.boundary.coordinates.map((ring) =>
          ring.map((point) => geo(model, point)),
        ),
      })),
  ];
  const hardMasks = metadata.landscapeRegions
    .filter((region) => region.buildability === 'none')
    .map((region) => ({
      boundary: region.boundary,
      rings: region.boundary.coordinates.map((ring) =>
        ring.map((point) => geo(model, point)),
      ),
    }));
  const touchesMask = (point: D3dWorldPoint, radius: number) =>
    hardMasks.some(
      (mask) =>
        pointInPolygon(geographic(model, point), mask.boundary) ||
        mask.rings.some((ring) =>
          ring.slice(1).some(
            (end, i) =>
              distanceToCorridor(point, {
                from: ring[i]!,
                to: end,
                width: 0,
              }) <= radius,
          ),
        ),
    );
  const withinCrop = (point: D3dWorldPoint, radius: number) =>
    point.x - radius >= fallback.bounds.minX &&
    point.x + radius <= fallback.bounds.maxX &&
    point.z - radius >= fallback.bounds.minZ &&
    point.z + radius <= fallback.bounds.maxZ;
  const clear = (point: D3dWorldPoint, radius: number) =>
    withinCrop(point, radius) &&
    !touchesMask(point, radius) &&
    !reservations.some(
      (l) => Math.hypot(l.x - point.x, l.z - point.z) < l.radius + radius,
    ) &&
    !model.stops.some(
      (stop) =>
        Math.hypot(stop.x - point.x, stop.z - point.z) < 12 * metre + radius,
    ) &&
    !corridors.some(
      (road) => distanceToCorridor(point, road) < road.width / 2 + radius,
    );
  const context = (point: D3dWorldPoint) =>
    lookupSettlementContext(metadata, geographic(model, point));
  const cellKey = (point: readonly [number, number]) =>
    `${Math.round((population.grid.originCellCenter.latitude - point[1]) / population.grid.resolutionDegrees)}:${Math.round((point[0] - population.grid.originCellCenter.longitude) / population.grid.resolutionDegrees)}`;
  const cells = new Map(
    settlement.cells.map((cell) => [
      cellKey([cell.cell.center.longitude, cell.cell.center.latitude]),
      cell,
    ]),
  );
  const maximum = population.canonicalCells.reduce(
    (max, cell) => Math.max(max, cell.populationWeight),
    1,
  );
  const buildings: CityBuilding[] = fallback.buildings
    .map((building) => ({
      ...building,
      width: Math.min(building.width, 18 * metre),
      depth: Math.min(building.depth, 18 * metre),
      height: building.storeys * 3.1 * metre,
    }))
    .filter(
      (building) =>
        context(building).zoneId === undefined &&
        clear(building, Math.hypot(building.width, building.depth) / 2) &&
        (context(building).buildability === 'default' ||
          citySeed(building.id) % 12 === 0),
    );
  const blocks: UrbanBlock[] = [];
  const localStreets: UrbanCorridor[] = [];
  const streetKeys = new Set<string>();
  const addStreet = (
    from: D3dWorldPoint,
    to: D3dWorldPoint,
    width: number,
    zoneId: string,
  ) => {
    const length = Math.hypot(to.x - from.x, to.z - from.z),
      steps = Math.ceil(length / (12 * metre));
    for (let i = 0; i < steps; i++) {
      const a = {
        x: from.x + ((to.x - from.x) * i) / steps,
        z: from.z + ((to.z - from.z) * i) / steps,
      };
      const b = {
        x: from.x + ((to.x - from.x) * (i + 1)) / steps,
        z: from.z + ((to.z - from.z) * (i + 1)) / steps,
      };
      const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
      const key = [
        `${a.x.toFixed(5)}:${a.z.toFixed(5)}`,
        `${b.x.toFixed(5)}:${b.z.toFixed(5)}`,
      ]
        .sort()
        .join('/');
      if (
        streetKeys.has(key) ||
        !withinCrop(mid, width) ||
        touchesMask(mid, Math.hypot(length / steps, width) / 2) ||
        context(mid).zoneId !== zoneId
      )
        continue;
      streetKeys.add(key);
      localStreets.push({ from: a, to: b, width });
    }
  };
  for (const zone of metadata.zones) {
    const urban = metadata.urbanProfiles.find(
      (profile) => profile.id === zone.urbanProfileId,
    )!;
    const seed = citySeed(`${metadata.schemaVersion}:${zone.id}`);
    const angle =
      ((zone.principalOrientationDeg +
        (urban.orientationBehavior === 'locally-adaptive'
          ? ((seed % 9) - 4) *
            { high: 0.25, medium: 0.5, low: 1 }[zone.orientationConfidence]
          : 0)) *
        Math.PI) /
      180;
    const cos = Math.cos(angle),
      sin = Math.sin(angle);
    const toWorld = (u: number, v: number): D3dWorldPoint => ({
      x: u * cos + v * sin,
      z: -u * sin + v * cos,
    });
    const points = zone.boundary.coordinates[0]!.map((point) =>
      geo(model, point),
    ).map((p) => ({ u: p.x * cos - p.z * sin, v: p.x * sin + p.z * cos }));
    const minU = Math.min(...points.map((p) => p.u)),
      maxU = Math.max(...points.map((p) => p.u)),
      minV = Math.min(...points.map((p) => p.v)),
      maxV = Math.max(...points.map((p) => p.v));
    const widthM = sample(urban.typicalBlockWidthM, seed),
      depthM = sample(urban.typicalBlockDepthM, seed >>> 8);
    const street = sample(urban.typicalStreetWidthM, seed >>> 12) * metre,
      width = widthM * metre,
      depth = depthM * metre;
    let row = 0;
    for (
      let v = minV + depth / 2 + street;
      v < maxV;
      v += depth + street, row++
    ) {
      const drift =
        urban.streetPattern === 'orthogonal'
          ? 0
          : ((citySeed(`${zone.id}:${row}`) % 100) / 100 - 0.5) *
            (1 - urban.streetRegularity) *
            width *
            0.4;
      let column = 0;
      for (
        let u = minU + width / 2 + street + drift;
        u < maxU;
        u += width + street, column++
      ) {
        const center = toWorld(u, v);
        if (
          context(center).zoneId !== zone.id ||
          !withinCrop(center, 0) ||
          touchesMask(center, 0)
        )
          continue;
        const blockId = `${zone.id}-block-${row}-${column}`,
          blockSeed = citySeed(blockId);
        const profile = selectDevelopmentProfile(
          metadata,
          zone.buildingProfileMix,
          blockSeed,
        );
        const corners = [
          toWorld(u - width / 2, v - depth / 2),
          toWorld(u + width / 2, v - depth / 2),
          toWorld(u - width / 2, v + depth / 2),
          toWorld(u + width / 2, v + depth / 2),
        ];
        const cell = cells.get(cellKey(geographic(model, center)));
        const density =
          cell?.zoneId === zone.id
            ? Math.pow(cell.cell.populationWeight / maximum, 0.4)
            : 0;
        blocks.push({
          id: blockId,
          componentId: zone.id,
          zoneId: zone.id,
          urbanProfileId: urban.id,
          widthM,
          depthM,
          layoutRow: row,
          layoutColumn: column,
          density,
          minX: Math.min(...corners.map((p) => p.x)),
          maxX: Math.max(...corners.map((p) => p.x)),
          minZ: Math.min(...corners.map((p) => p.z)),
          maxZ: Math.max(...corners.map((p) => p.z)),
        });
        addStreet(
          toWorld(u - width / 2 - street / 2, v - depth / 2 - street / 2),
          toWorld(u + width / 2 + street / 2, v - depth / 2 - street / 2),
          street,
          zone.id,
        );
        if (urban.orientationBehavior !== 'single-axis' || column % 2 === 0)
          addStreet(
            toWorld(u - width / 2 - street / 2, v - depth / 2 - street / 2),
            toWorld(u - width / 2 - street / 2, v + depth / 2 + street / 2),
            street,
            zone.id,
          );
        const frontage =
            sample(urban.typicalParcelFrontageM, blockSeed) * metre,
          parcelDepth =
            sample(urban.typicalParcelDepthM, blockSeed >>> 8) * metre;
        const columns = Math.max(1, Math.floor(width / frontage)),
          rows = Math.min(
            Math.max(1, Math.floor(depth / parcelDepth)),
            // Fine-grain frontages face the two streets; large plots retain one deep yard.
            {
              'fine-grain': 2,
              'medium-grain': Infinity,
              'detached-lot': Infinity,
              mixed: Infinity,
              'large-plot': 1,
              superblock: 1,
            }[urban.parcelPattern],
          );
        const lotWidth = width / columns,
          lotDepth = depth / rows;
        const open = sample(urban.openSpaceRatio, blockSeed >>> 10),
          coverage = Math.min(
            sample(urban.plotCoverageRatio, blockSeed >>> 4),
            1 - open,
          );
        const family =
          profile.allowedArchetypes[
            (blockSeed >>> 16) % profile.allowedArchetypes.length
          ]!;
        const residential = profile.dominantUses.includes('residential');
        for (let r = 0; r < rows; r++)
          for (let c = 0; c < columns; c++) {
            const parcelId = `${blockId}-parcel-${r}-${c}`,
              variation = citySeed(parcelId);
            const p = toWorld(
              u - width / 2 + (c + 0.5) * lotWidth,
              v - depth / 2 + (r + 0.5) * lotDepth,
            );
            const local = context(p),
              support = cells.get(cellKey(geographic(model, p)));
            const localDensity =
              support?.zoneId === zone.id
                ? Math.pow(support.cell.populationWeight / maximum, 0.4)
                : 0;
            const occupancy =
              (residential
                ? localDensity > 0
                  ? 0.68 + 0.32 * localDensity
                  : 0
                : 0.8) *
              (1 - open * 0.45) *
              (urban.urbanEdgeBehavior === 'fragmented' ? 0.2 : 1) *
              (local.buildability === 'strongly-constrained' ? 0.08 : 1) *
              (profile.repetitionBehavior === 'landmark-driven' ? 0.55 : 1);
            if (
              local.zoneId !== zone.id ||
              (variation % 1000) / 1000 >= occupancy
            )
              continue;
            const repetitive =
              profile.repetitionBehavior === 'highly-repetitive';
            const archetype = repetitive
              ? family
              : profile.repetitionBehavior === 'locally-repetitive'
                ? profile.allowedArchetypes[
                    (blockSeed + (variation % 2)) %
                      profile.allowedArchetypes.length
                  ]!
                : profile.allowedArchetypes[
                    variation % profile.allowedArchetypes.length
                  ]!;
            const side =
              sample(
                { min: urban.setbackM.sideMin, max: urban.setbackM.sideMax },
                repetitive ? blockSeed : variation,
              ) * metre;
            const front =
              sample(
                { min: urban.setbackM.frontMin, max: urban.setbackM.frontMax },
                repetitive ? blockSeed : variation >>> 8,
              ) * metre;
            const footprintFactor = { small: 0.85, medium: 0.95, large: 1 }[
              profile.footprintScale
            ];
            const buildingWidth = Math.min(
                lotWidth - 2 * side,
                lotWidth * Math.sqrt(coverage) * footprintFactor,
              ),
              buildingDepth = Math.min(
                lotDepth - 2 * front,
                lotDepth * Math.sqrt(coverage) * footprintFactor,
              );
            if (buildingWidth < 2 * metre || buildingDepth < 3 * metre)
              continue;
            const radius = Math.hypot(buildingWidth, buildingDepth) / 2;
            if (
              !clear(p, radius) ||
              !pointInPolygon(geographic(model, p), zone.boundary)
            )
              continue;
            const storeys = Math.min(
              profile.storeys.max,
              Math.max(
                profile.storeys.min,
                Math.round(
                  profile.storeys.typicalMin +
                    (profile.storeys.typicalMax - profile.storeys.typicalMin) *
                      (residential ? localDensity : (blockSeed % 100) / 100) +
                    (repetitive ? 0 : (variation % 3) - 1),
                ),
              ),
            );
            const tone = repetitive ? blockSeed : blockSeed + (variation % 2);
            buildings.push({
              ...p,
              id: parcelId,
              blockId,
              zoneId: zone.id,
              buildingProfileId: profile.id,
              width: buildingWidth,
              depth: buildingDepth,
              rotation: angle,
              archetype,
              storeys,
              height: storeys * 3.1 * metre,
              baseY: 0.035,
              wallVariant: 0,
              roofVariant: 0,
              wallColor: settlementPaletteColor(
                profile.wallPalette[tone % profile.wallPalette.length]!,
              ),
              roofColor: settlementPaletteColor(
                profile.roofPalette[tone % profile.roofPalette.length]!,
              ),
              density: localDensity,
            });
          }
      }
    }
  }
  const components: ProceduralCity['components'][number][] = [];
  const componentIds = new Map<string, string>();
  const remainingBlocks = new Map(
    blocks.map((block) => [
      `${block.zoneId}:${block.layoutRow}:${block.layoutColumn}`,
      block,
    ]),
  );
  for (const [key, block] of [...remainingBlocks]) {
    if (!remainingBlocks.delete(key)) continue;
    const connected = [block],
      id = `component-${block.id}`;
    for (let i = 0; i < connected.length; i++) {
      const next = connected[i]!;
      componentIds.set(next.id, id);
      for (const [dr, dc] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ]) {
        const neighborKey = `${next.zoneId}:${next.layoutRow! + dr!}:${next.layoutColumn! + dc!}`;
        const neighbor = remainingBlocks.get(neighborKey);
        if (neighbor) {
          remainingBlocks.delete(neighborKey);
          connected.push(neighbor);
        }
      }
    }
    components.push({
      id,
      tiles: connected.map((b) => ({
        r: b.layoutRow!,
        c: b.layoutColumn!,
        density: b.density,
      })),
    });
  }
  const fallbackBlockIds = new Set(
    buildings.filter((b) => b.zoneId === undefined).map((b) => b.blockId),
  );
  const fallbackBlocks = fallback.blocks.filter((block) =>
    fallbackBlockIds.has(block.id),
  );
  const fallbackComponentIds = new Set(
    fallbackBlocks.map((b) => b.componentId),
  );
  components.push(
    ...fallback.components.filter((component) =>
      fallbackComponentIds.has(component.id),
    ),
  );
  const ground = fallback.ground.filter((patch) => {
    const p = {
      x: (patch.minX + patch.maxX) / 2,
      z: (patch.minZ + patch.maxZ) / 2,
    };
    return (
      context(p).zoneId === undefined &&
      !touchesMask(
        p,
        Math.hypot(patch.maxX - patch.minX, patch.maxZ - patch.minZ) / 2,
      )
    );
  });
  // Output freezes only presentation-owned descriptors. It preserves the population view's identity.
  return Object.freeze({
    ...fallback,
    settlement,
    corridors: freezeSettlement(corridors),
    localStreets: freezeSettlement(localStreets),
    reservations: freezeSettlement(reservations),
    landscapes: freezeSettlement(landscapes),
    components: freezeSettlement(components),
    blocks: freezeSettlement([
      ...fallbackBlocks,
      ...blocks.map((block) => ({
        ...block,
        componentId: componentIds.get(block.id)!,
      })),
    ]),
    ground: freezeSettlement(ground),
    buildings: freezeSettlement(buildings),
    far: freezeSettlement(buildings.filter((_, i) => i % 8 === 0)),
    medium: freezeSettlement(buildings.filter((_, i) => i % 2 === 0)),
    mini: freezeSettlement(buildings.filter((_, i) => i % 32 === 0)),
    storeyHeight: 3.1 * metre,
    stopClearance: 12 * metre,
  });
}

function geographic(
  model: D3dMapModel,
  point: D3dWorldPoint,
): readonly [number, number] {
  const value = d3dGeographicPoint(model, point);
  return [value.longitude, value.latitude];
}
