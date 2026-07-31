import { normalizeUgandaPhone } from '../src/modules/auth/auth.service';

describe('normalizeUgandaPhone', () => {
  it('leaves a properly-formatted +256 number unchanged', () => {
    expect(normalizeUgandaPhone('+256701234567')).toBe('+256701234567');
  });

  it('adds the + to a bare 256-prefixed number', () => {
    expect(normalizeUgandaPhone('256701234567')).toBe('+256701234567');
  });

  it('converts a local 0-prefixed number to +256 format', () => {
    expect(normalizeUgandaPhone('0701234567')).toBe('+256701234567');
  });

  it('converts a bare 9-digit local number (no leading 0) to +256 format', () => {
    expect(normalizeUgandaPhone('701234567')).toBe('+256701234567');
  });

  it('strips spaces and formatting before normalizing', () => {
    expect(normalizeUgandaPhone('070 123 4567')).toBe('+256701234567');
  });

  it('passes through a value that matches no known Uganda format unchanged', () => {
    expect(normalizeUgandaPhone('12345')).toBe('12345');
  });
});
