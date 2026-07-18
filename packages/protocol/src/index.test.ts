import { describe, expect, it } from 'vitest';
import { protocolFoundationVersion } from './index.js';

describe('protocol foundation', () => {
  it('exports its smoke contract', () =>
    expect(protocolFoundationVersion).toBe(1));
});
