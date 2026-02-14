import { describe, expect, it, vi } from 'vitest';

import { createScanThrottle } from '../src/renderer/scanner.js';

describe('createScanThrottle', () => {
  it('accepts first scan and rejects same code within the throttle window', () => {
    const base = 1_000_000;
    const accept = createScanThrottle({ windowMs: 1200 });

    expect(accept('ABC', base)).toBe(true);
    expect(accept('ABC', base + 100)).toBe(false);
    expect(accept('ABC', base + 1199)).toBe(false);
    expect(accept('ABC', base + 1200)).toBe(true);
  });

  it('accepts different codes without delay', () => {
    const base = 2_000_000;
    const accept = createScanThrottle({ windowMs: 1200 });

    expect(accept('A', base)).toBe(true);
    expect(accept('B', base + 10)).toBe(true);
    expect(accept('A', base + 20)).toBe(true); // last code is B, so A is accepted
  });

  it('rejects blank codes', () => {
    const accept = createScanThrottle({ windowMs: 1200 });
    expect(accept('')).toBe(false);
    expect(accept('   ')).toBe(false);
    expect(accept(null)).toBe(false);
  });
});
