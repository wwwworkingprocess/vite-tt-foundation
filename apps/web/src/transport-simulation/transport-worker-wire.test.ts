import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseScenarioPackage } from '@torrevieja-tycoon/transport-domain';
import {
  parseTransportWorkerRequest,
  parseTransportWorkerResponse,
} from './transport-worker-wire.js';

const fixture = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  'packages',
  'transport-domain',
  'fixtures',
  'torrevieja-mini-v1',
);
const json = (name: string) =>
  JSON.parse(readFileSync(join(fixture, name), 'utf8')) as unknown;
const scenario = parseScenarioPackage({
  manifest: json('scenario.json'),
  settlements: json('settlements.json'),
  stops: json('stops.json'),
  routes: json('routes.json'),
  presentation: json('presentation.json'),
  provenance: json('provenance.json'),
});

describe('transport Worker wire schemas', () => {
  it('rejects legacy Phase 4B contract-V1 envelopes explicitly', () => {
    expect(() =>
      parseTransportWorkerRequest({
        kind: 'transport-worker-request',
        contractVersion: 1,
        requestId: 1,
        operation: 'close',
        payload: null,
      }),
    ).toThrow();
    expect(() =>
      parseTransportWorkerResponse({
        kind: 'transport-worker-result',
        contractVersion: 1,
        requestId: 1,
        operation: 'close',
        payload: null,
      }),
    ).toThrow();
    for (const contractVersion of [1, 2]) {
      expect(() =>
        parseTransportWorkerRequest({
          kind: 'transport-worker-request',
          contractVersion,
          requestId: 1,
          operation: 'close',
          payload: null,
        }),
      ).toThrow();
      expect(() =>
        parseTransportWorkerResponse({
          kind: 'transport-worker-result',
          contractVersion,
          requestId: 1,
          operation: 'close',
          payload: null,
        }),
      ).toThrow();
    }
  });
  it('rejects unsafe IDs, operation/payload mismatches, markers, and unknown fields', () => {
    const close = {
      kind: 'transport-worker-request',
      contractVersion: 3,
      requestId: 1,
      operation: 'close',
      payload: null,
    };
    expect(parseTransportWorkerRequest(close)).toEqual(close);
    for (const malformed of [
      { ...close, requestId: 0 },
      { ...close, requestId: Number.MAX_SAFE_INTEGER + 1 },
      { ...close, contractVersion: 1 },
      { ...close, payload: {} },
      { ...close, extra: true },
    ])
      expect(() => parseTransportWorkerRequest(malformed)).toThrow();
  });

  it('rejects malformed results, publications, failures, and operation mismatches', () => {
    const close = {
      kind: 'transport-worker-result',
      contractVersion: 3,
      requestId: 1,
      operation: 'close',
      payload: null,
    };
    expect(parseTransportWorkerResponse(close)).toEqual(close);
    expect(() =>
      parseTransportWorkerResponse({ ...close, operation: 'connect' }),
    ).not.toThrow();
    for (const malformed of [
      { ...close, payload: 'closed' },
      { ...close, requestId: -1 },
      { ...close, contractVersion: 9 },
      {
        kind: 'transport-worker-failure',
        contractVersion: 3,
        requestId: 1,
        operation: 'close',
        message: '',
      },
      {
        kind: 'transport-worker-publication',
        contractVersion: 3,
        channel: 'unknown',
        payload: {},
      },
    ])
      expect(() => parseTransportWorkerResponse(malformed)).toThrow();
  });

  it('validates nested connect variants and every operation-specific result', () => {
    const envelope = {
      kind: 'transport-worker-request',
      contractVersion: 3,
      requestId: 1,
      operation: 'connect',
    };
    expect(() =>
      parseTransportWorkerRequest({
        ...envelope,
        payload: {
          kind: 'transport-client-connect',
          contractVersion: 3,
          mode: 'new',
          gameId: 'game',
          timelineId: 'timeline',
          initialSimulationTick: 0,
          scenario: {},
        },
      }),
    ).toThrow();
    expect(() =>
      parseTransportWorkerRequest({
        ...envelope,
        payload: {
          kind: 'transport-client-connect',
          contractVersion: 3,
          mode: 'restore',
          gameId: 'game',
          timelineId: 'timeline',
          scenario,
          snapshot: {},
        },
      }),
    ).toThrow();
    for (const [operation, payload] of [
      ['send-command', {}],
      ['synchronize', {}],
      ['export-snapshot', {}],
    ] as const)
      expect(() =>
        parseTransportWorkerResponse({
          kind: 'transport-worker-result',
          contractVersion: 3,
          requestId: 1,
          operation,
          payload,
        }),
      ).toThrow();
    expect(
      parseTransportWorkerResponse({
        kind: 'transport-worker-failure',
        contractVersion: 3,
        message: 'invalid request',
      }),
    ).toMatchObject({ kind: 'transport-worker-failure' });
    for (const channel of ['reliable', 'render'] as const)
      expect(() =>
        parseTransportWorkerResponse({
          kind: 'transport-worker-publication',
          contractVersion: 3,
          channel,
          payload: {},
        }),
      ).toThrow();
  });
});
