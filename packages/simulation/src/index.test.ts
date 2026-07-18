import { describe, expect, it } from 'vitest';
import { simulationFoundationLabel } from './index.js';

describe('simulation foundation', () => {
  it('has no runtime platform requirements', () =>
    expect(simulationFoundationLabel).toBe('standalone simulation package'));
});
