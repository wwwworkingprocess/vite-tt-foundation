import { cityPreparationSettings } from './city-preparation-settings.js';
import { createSettlementMetadataLoader } from '../settlement/settlement-metadata-loader.js';
import type { ProceduralCity } from '../representation/d3d-city-model.js';
import { createPublicLayerLoader } from '../assets/public-layer-loader.js';
import { createTerrainLoader } from '../terrain/terrain-loader.js';
import { createStreetCellLoader } from '../representation/street-cells-loader.js';
import { createRoadNetworkLoader } from '../representation/road-network-loader.js';
import {
  buildStreetCellCity,
  streetCellLandmarkProtections,
} from '../representation/d3d-street-cell-city.js';
import { createD3dTerrain } from '../representation/d3d-terrain-model.js';
import { packNativeTerrain } from './native-terrain-dto.js';
import type { PreparationJob } from './preparation-protocol.js';
/** Same existing ZIP cache/CRC/schema/product validators, owned by the visual worker. */
export function createPreparationEngine(
  input: Parameters<typeof createPublicLayerLoader>[0],
) {
  const assets = createPublicLayerLoader(input);
  const digestSha256 = async (text: string) =>
    Array.from(
      new Uint8Array(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)),
      ),
      (b) => b.toString(16).padStart(2, '0'),
    ).join('');
  const cities = new Map<string, ReturnType<typeof make>>();
  const make = () => ({
    plans: new Map<
      string,
      Promise<{ city: ProceduralCity; baseYs: Float64Array }>
    >(),
    metadata: createSettlementMetadataLoader({
      baseUrl: input.baseUrl,
      fetchText: assets.fetchAsset,
      digestSha256,
    }),
    terrain: createTerrainLoader({
      baseUrl: input.baseUrl,
      fetchText: assets.fetchAsset,
    }),
    cells: createStreetCellLoader({
      baseUrl: input.baseUrl,
      fetchText: assets.fetchAsset,
      digestSha256,
    }),
    roads: createRoadNetworkLoader({
      baseUrl: input.baseUrl,
      fetchText: assets.fetchAsset,
      digestSha256,
    }),
  });
  // One recent city's derived loaders/plans. Storage bytes retain the established ZIP cache.
  const current = (id: string) => {
    let found = cities.get(id);
    if (!found) {
      found = make();
      cities.set(id, found);
      if (cities.size > cityPreparationSettings.retainRecentCities + 1)
        cities.delete(cities.keys().next().value!);
    } else {
      cities.delete(id);
      cities.set(id, found);
    }
    return found;
  };
  return Object.freeze({
    async run(job: PreparationJob): Promise<unknown> {
      if (job.kind === 'asset') {
        const r = await assets.fetchAsset(job.url);
        return { ok: r.ok, bytes: new Uint8Array(await r.arrayBuffer()) };
      }
      const l = current(job.city);
      if (job.kind === 'terrain') {
        const r = await l.terrain.resolve(job.city, job.scenario);
        return r.status === 'ready'
          ? { status: 'ready', terrain: packNativeTerrain(r.terrain) }
          : r;
      }
      if (job.kind === 'cells') return l.cells.resolve(job.city, job.level);
      if (job.kind === 'roads') return l.roads.resolve(job.city, job.level);
      const research = job.resolveResearch
        ? await l.metadata
            .resolveSettlementMetadata(job.city)
            .catch(() => undefined)
        : job.metadata;
      const metadata = research?.status === 'ready' ? research : undefined;
      const key =
        job.sceneIdentity +
        ':' +
        job.scale +
        ':' +
        (metadata?.sha256 ?? 'none');
      const wrap = async (
        plan: Promise<{ city: ProceduralCity; baseYs: Float64Array }>,
      ) => {
        const body = await plan;
        return {
          schemaVersion: 1,
          identity: job.identity,
          cityId: job.city,
          city: body.city,
          baseYs: body.baseYs.slice(),
        };
      };
      const previous = l.plans.get(key);
      if (previous) return wrap(previous);
      const plan = (async () => {
        const [native, cells] = await Promise.all([
          l.terrain.resolve(job.city, job.scenario),
          l.cells.resolve(job.city, 'C'),
        ]);
        const terrain =
          native.status === 'ready'
            ? createD3dTerrain(native.terrain, job.model, job.scale)
            : undefined;
        const protections = metadata
          ? streetCellLandmarkProtections(job.model, metadata)
          : undefined;
        const generated = buildStreetCellCity(
          job.model,
          job.population,
          metadata,
          cells,
          terrain,
          protections,
        );
        const baseYs = Float64Array.from(generated.buildings, (b) =>
          terrain ? terrain.ground(b.x, b.z).y : b.baseY,
        );
        return { city: generated, baseYs };
      })();
      l.plans.clear();
      l.plans.set(key, plan);
      void plan.catch(() => {
        if (l.plans.get(key) === plan) l.plans.delete(key);
      });
      return wrap(plan);
    },
  });
}
