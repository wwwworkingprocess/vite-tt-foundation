import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  parseCommandRevision,
  parseRenderSnapshotSequence,
  parseStreamOffset,
  parseTimelineId,
} from './index.js';

describe('protocol position primitives', () => {
  it('creates distinct JSON-safe position values', () => {
    const commandRevision = parseCommandRevision(3);
    const streamOffset = parseStreamOffset(3);
    const renderSequence = parseRenderSnapshotSequence(3);
    const timelineId = parseTimelineId('timeline:restored-2');

    expectTypeOf(commandRevision).not.toEqualTypeOf(streamOffset);
    expectTypeOf(streamOffset).not.toEqualTypeOf(renderSequence);
    expectTypeOf(timelineId).not.toEqualTypeOf(commandRevision);

    expect(
      JSON.parse(
        JSON.stringify({
          commandRevision,
          streamOffset,
          renderSequence,
          timelineId,
        }),
      ),
    ).toEqual({
      commandRevision: 3,
      streamOffset: 3,
      renderSequence: 3,
      timelineId: 'timeline:restored-2',
    });
  });

  it.each([
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
    '1',
  ])('rejects invalid numeric position %s', (value) => {
    expect(() => parseCommandRevision(value)).toThrow();
    expect(() => parseStreamOffset(value)).toThrow();
    expect(() => parseRenderSnapshotSequence(value)).toThrow();
  });

  it.each([
    '',
    ' leading',
    'trailing ',
    'contains space',
    '!',
    'a'.repeat(129),
    42,
    null,
  ])('rejects malformed timeline ID %s', (value) =>
    expect(() => parseTimelineId(value)).toThrow(),
  );
});
