import { describe, expect, it } from 'vitest';
import {
  parseCommandId,
  parseFoundationCommandEnvelope,
  parseGameId,
  parseTimelineId,
} from '@torrevieja-tycoon/protocol';

import { createDirectFoundationClient } from './direct-client.js';

const gameId = parseGameId('direct-failure-game');
const timelineId = parseTimelineId('direct-failure-timeline');

function validCommand() {
  return parseFoundationCommandEnvelope({
    kind: 'foundation-command',
    gameId,
    timelineId,
    commandId: parseCommandId('after-rejection'),
    correlationId: 'after-rejection-correlation',
    clientId: 'direct-client',
    sessionId: 'direct-session',
    expectedCommandRevision: 0,
    command: { type: 'foundation.advance-ticks', count: 1 },
  });
}

async function connectedClient() {
  const client = createDirectFoundationClient();
  await client.connect({
    mode: 'new',
    gameId,
    timelineId,
    initialSimulationTick: 0,
  });
  return client;
}

describe('direct foundation client failure tracking', () => {
  it('rejects an invalid queued command and remains ready for later work', async () => {
    const client = await connectedClient();

    await expect(
      client.sendCommand({ kind: 'invalid-foundation-command' } as never),
    ).rejects.toThrow();
    expect(client.getLifecycle()).toMatchObject({ state: 'ready' });
    await expect(client.sendCommand(validCommand())).resolves.toMatchObject({
      status: 'applied',
      resultingSimulationTick: 1,
    });

    await client.close();
  });

  it('keeps close terminal when an invalid queued command rejects afterward', async () => {
    const client = await connectedClient();
    const pending = client.sendCommand({
      kind: 'invalid-foundation-command',
    } as never);

    await client.close();
    await expect(pending).rejects.toThrow('Foundation client closed.');
    await Promise.resolve();
    expect(client.getLifecycle()).toEqual({ state: 'closed' });
  });
});
