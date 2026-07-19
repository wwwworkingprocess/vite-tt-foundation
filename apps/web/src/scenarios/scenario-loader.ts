import {
  ScenarioDomainError,
  assertScenarioDescriptorMatchesManifest,
  buildDirectedScenarioGraph,
  parseScenarioCatalog,
  parseScenarioManifest,
  parseScenarioPackage,
  type DirectedScenarioGraph,
  type ScenarioCatalog,
  type ScenarioId,
} from '@torrevieja-tycoon/transport-domain';

interface TextResponse {
  readonly ok: boolean;
  text(): Promise<string>;
}
export interface ScenarioLoaderState {
  readonly status:
    'idle' | 'loading-catalogue' | 'loading-scenario' | 'ready' | 'failed';
  readonly catalog?: ScenarioCatalog | undefined;
  readonly selectedScenarioId?: ScenarioId | undefined;
  readonly graph?: DirectedScenarioGraph | undefined;
  readonly title?: string | undefined;
  readonly settlementCount?: number | undefined;
  readonly routeCount?: number | undefined;
  readonly message?: string | undefined;
}
const freeze = <T>(value: T): T => {
  if (value === null || typeof value !== 'object') return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.isFrozen(value) ? value : Object.freeze(value);
};
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Scenario loading failed.';

export function createScenarioLoader(input: {
  readonly baseUrl: string;
  readonly fetchText: (url: string) => Promise<TextResponse>;
  readonly digestSha256: (text: string) => Promise<string>;
  readonly onDiagnostic?: ((error: unknown) => void) | undefined;
}) {
  const base = `/${input.baseUrl.replace(/^\/+|\/+$/g, '')}/`.replace(
    '//',
    '/',
  );
  let state = freeze<ScenarioLoaderState>({ status: 'idle' });
  let generation = 0;
  let listenerSequence = 0;
  const listeners = new Map<
    number,
    (next: ScenarioLoaderState, previous: ScenarioLoaderState) => void
  >();
  const set = (patch: Partial<ScenarioLoaderState>, token: number) => {
    if (token !== generation) return;
    const previous = state;
    state = freeze({ ...state, ...patch });
    for (const listener of [...listeners.values()])
      try {
        listener(state, previous);
      } catch (error) {
        try {
          input.onDiagnostic?.(error);
        } catch {
          // Diagnostics never affect loading.
        }
      }
  };
  const getText = async (url: string, required = true) => {
    const response = await input.fetchText(url);
    if (!response.ok) {
      if (!required) return undefined;
      throw new ScenarioDomainError(
        'malformed-asset',
        `missing required asset ${url}`,
      );
    }
    return response.text();
  };
  const decode = (text: string, context: string): unknown => {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new ScenarioDomainError(
        context === 'catalogue' ? 'malformed-catalogue' : 'malformed-asset',
        context,
      );
    }
  };
  async function loadCatalog() {
    const token = ++generation;
    set({ status: 'loading-catalogue', message: undefined }, token);
    try {
      const text = await getText(`${base}scenarios/catalog.json`);
      const catalog = parseScenarioCatalog(decode(text!, 'catalogue'));
      set({ status: 'idle', catalog, message: undefined }, token);
    } catch (error) {
      set({ status: 'failed', message: errorMessage(error) }, token);
    }
  }
  async function loadScenario(selectedScenarioId: string) {
    const catalog = state.catalog;
    const descriptor = catalog?.scenarios.find(
      (item) => item.scenarioId === selectedScenarioId,
    );
    if (!descriptor) {
      const token = ++generation;
      set(
        { status: 'failed', message: `Unknown scenario ${selectedScenarioId}` },
        token,
      );
      return;
    }
    const token = ++generation;
    set(
      {
        status: 'loading-scenario',
        selectedScenarioId: descriptor.scenarioId,
        graph: undefined,
        message: undefined,
      },
      token,
    );
    try {
      const manifestUrl = `${base}scenarios/${descriptor.manifestPath}`;
      const manifestText = await getText(manifestUrl);
      const manifest = parseScenarioManifest(decode(manifestText!, 'manifest'));
      assertScenarioDescriptorMatchesManifest(descriptor, manifest);
      const directory = manifestUrl.slice(0, manifestUrl.lastIndexOf('/') + 1);
      const decoded = new Map<string, unknown>();
      for (const [name, asset] of Object.entries(manifest.assets)) {
        const text = await getText(`${directory}${asset.path}`, asset.required);
        if (text === undefined) continue;
        const digest = await input.digestSha256(text);
        if (digest.toLowerCase() !== asset.sha256)
          throw new ScenarioDomainError(
            'content-integrity-mismatch',
            `${name} ${asset.path}`,
          );
        decoded.set(name, decode(text, name));
      }
      for (const required of ['settlements', 'stops', 'routes'])
        if (!decoded.has(required))
          throw new ScenarioDomainError(
            'malformed-asset',
            `missing required asset ${required}`,
          );
      const scenario = parseScenarioPackage({
        manifest,
        settlements: decoded.get('settlements'),
        stops: decoded.get('stops'),
        routes: decoded.get('routes'),
        presentation: decoded.get('presentation'),
        provenance: decoded.get('provenance'),
      });
      const graph = buildDirectedScenarioGraph(scenario);
      set(
        {
          status: 'ready',
          graph,
          title: manifest.title,
          settlementCount: scenario.settlements.settlements.length,
          routeCount: scenario.routes.routes.length,
          message: undefined,
        },
        token,
      );
    } catch (error) {
      set({ status: 'failed', message: errorMessage(error) }, token);
    }
  }
  return Object.freeze({
    projection: Object.freeze({
      getState: () => state,
      subscribe(
        listener: (
          next: ScenarioLoaderState,
          previous: ScenarioLoaderState,
        ) => void,
      ) {
        const registration = ++listenerSequence;
        listeners.set(registration, listener);
        return () => {
          listeners.delete(registration);
        };
      },
    }),
    loadCatalog,
    loadScenario,
  });
}

export const browserSha256 = async (text: string) => {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};
