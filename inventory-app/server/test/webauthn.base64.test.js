import { describe, it, expect } from 'vitest';
import { Buffer } from 'buffer';

function base64urlEncode(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64');
}

describe('base64url conversions', () => {
  it('encodes and decodes deterministically', () => {
    const data = new Uint8Array([1,2,3,4,5]);
    const enc = base64urlEncode(data);
    const dec = base64urlDecode(enc);
    expect(Buffer.from(dec)).toEqual(Buffer.from(data));
  });
});
