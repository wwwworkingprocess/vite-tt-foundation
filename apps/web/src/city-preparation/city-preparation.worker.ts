import { decodePreparationJob } from './preparation-wire.js';
import { cityPreparationSettings } from './city-preparation-settings.js';
import { createPreparationEngine } from './preparation-engine.js';
import {
  preparationProtocolVersion as version,
  record,
  type PreparationJob,
} from './preparation-protocol.js';
const engine = createPreparationEngine({
  baseUrl: import.meta.env.BASE_URL,
  revisions: import.meta.env.PUBLIC_LAYER_REVISIONS,
  fetchArchive: (url) => fetch(new URL(url, location.origin)),
});
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage: (value: unknown, payloadBuffers: Transferable[]) => void;
};
const buffers = (
  value: unknown,
  seen = new Set<ArrayBuffer>(),
): ArrayBuffer[] => {
  if (ArrayBuffer.isView(value) && value.buffer instanceof ArrayBuffer)
    seen.add(value.buffer);
  else if (Array.isArray(value))
    for (const child of value) buffers(child, seen);
  else if (record(value))
    for (const child of Object.values(value)) buffers(child, seen);
  return [...seen];
};
scope.onmessage = (event) => {
  const data = event.data;
  if (!record(data) || data.version !== version) {
    scope.postMessage({ version, kind: 'protocol-error' }, []);
    return;
  }
  if (data.kind === 'hello') {
    scope.postMessage({ version, kind: 'hello' }, []);
    return;
  }
  if (
    !Number.isSafeInteger(data.id) ||
    !record(data.job) ||
    !['asset', 'terrain', 'cells', 'roads', 'compose'].includes(
      String(data.job.kind),
    )
  ) {
    scope.postMessage(
      { version, id: data.id, ok: false, error: 'Invalid preparation job' },
      [],
    );
    return;
  }
  let job: PreparationJob;
  try {
    job = decodePreparationJob(data.job);
  } catch (error) {
    scope.postMessage(
      { version, id: data.id, ok: false, error: String(error) },
      [],
    );
    return;
  }
  const started = performance.now();
  void engine.run(job).then(
    (value) => {
      try {
        const payloadBuffers = buffers(value);
        if (
          payloadBuffers.reduce((n, b) => n + b.byteLength, 0) >
          cityPreparationSettings.maxPacketBytes
        )
          throw Error('Prepared binary packet byte budget exceeded');
        scope.postMessage(
          {
            version,
            id: data.id,
            ok: true,
            value,
            milliseconds: performance.now() - started,
          },
          payloadBuffers,
        );
      } catch (error) {
        scope.postMessage(
          { version, id: data.id, ok: false, error: String(error) },
          [],
        );
      }
    },
    (error: unknown) =>
      scope.postMessage(
        {
          version,
          id: data.id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        },
        [],
      ),
  );
};
