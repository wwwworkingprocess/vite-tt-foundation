import { describe, expect, it } from 'vitest';
import { protocolContractVersion } from './index.js';

describe('protocol foundation', () => {
  it('exports its smoke contract', () =>
    expect(protocolContractVersion).toBe(1));
});
