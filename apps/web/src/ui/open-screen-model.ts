import type {
  ScenarioCatalog,
  SettlementId,
} from '@torrevieja-tycoon/transport-domain';
import { createDexieTransportSaveRepository } from '../transport-simulation/transport-save-repository.js';
import type { TransportSaveSummary } from '../transport-simulation/transport-save-record.js';

export type CityNameLookup = Readonly<Record<string, string>>;

export type SaveDiscovery = Readonly<{
  resumableSave?: TransportSaveSummary | undefined;
  unavailableSaveMessage?: string | undefined;
}>;

export async function discoverBrowserSave(): Promise<SaveDiscovery> {
  const repository = createDexieTransportSaveRepository('foundation-template');
  try {
    const classified = await repository.list();
    const current = classified
      .flatMap((item) =>
        item.classification === 'current' ? [item.summary] : [],
      )
      .sort(
        (left, right) =>
          right.updatedAtUtcMs - left.updatedAtUtcMs ||
          left.saveId.localeCompare(right.saveId),
      );
    return Object.freeze({
      resumableSave: current[0],
      unavailableSaveMessage:
        current.length === 0 &&
        classified.some((item) => item.classification !== 'unrelated')
          ? 'A previous save exists but is unavailable in this version.'
          : undefined,
    });
  } finally {
    void repository.close();
  }
}

export interface CityScenarioGroup {
  readonly cityId: SettlementId;
  readonly name: string;
  readonly scenarios: ScenarioCatalog['scenarios'];
}

const freeze = <T>(value: T): T => {
  if (value === null || typeof value !== 'object') return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.isFrozen(value) ? value : Object.freeze(value);
};

export function createCityScenarioGroups(
  catalog: ScenarioCatalog,
  names: CityNameLookup,
): readonly Readonly<CityScenarioGroup>[] {
  const groups = new Map<
    SettlementId,
    ScenarioCatalog['scenarios'][number][]
  >();
  for (const scenario of catalog.scenarios) {
    const group = groups.get(scenario.primarySettlementId) ?? [];
    group.push(scenario);
    groups.set(scenario.primarySettlementId, group);
  }
  return freeze(
    [...groups].map(([cityId, scenarios]) => ({
      cityId,
      name: names[cityId] ?? cityId,
      scenarios,
    })),
  );
}

export function formatLastPlayed(updatedAtUtcMs: number, nowUtcMs: number) {
  if (
    !Number.isSafeInteger(updatedAtUtcMs) ||
    updatedAtUtcMs < 0 ||
    !Number.isSafeInteger(nowUtcMs) ||
    nowUtcMs < 0
  )
    throw new Error('Last-played metadata is invalid.');
  if (updatedAtUtcMs >= nowUtcMs) return 'Last played just now';
  const elapsedMinutes = Math.floor((nowUtcMs - updatedAtUtcMs) / 60_000);
  if (elapsedMinutes === 0) return 'Last played just now';
  if (elapsedMinutes < 60)
    return `Last played ${elapsedMinutes} minute${elapsedMinutes === 1 ? '' : 's'} ago`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24)
    return `Last played ${elapsedHours} hour${elapsedHours === 1 ? '' : 's'} ago`;
  const elapsedDays = Math.floor(elapsedHours / 24);
  return `Last played ${elapsedDays} day${elapsedDays === 1 ? '' : 's'} ago`;
}
