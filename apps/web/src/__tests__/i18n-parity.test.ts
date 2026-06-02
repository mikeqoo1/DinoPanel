import { describe, it, expect } from 'vitest';
import en from '../i18n/en.json';
import zhTW from '../i18n/zh-TW.json';

// Phase 4 hardening: a missing translation key silently falls back to the key
// string in the UI. This guard fails the build the moment the two locale files
// drift apart (covers toolbox.* and every other module), so parity is never a
// manual check again.
function flattenKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? flattenKeys(value as Record<string, unknown>, path)
      : [path];
  });
}

describe('i18n locale parity (zh-TW vs en)', () => {
  const enKeys = new Set(flattenKeys(en as Record<string, unknown>));
  const zhKeys = new Set(flattenKeys(zhTW as Record<string, unknown>));

  it('every en.json key exists in zh-TW.json', () => {
    expect([...enKeys].filter((k) => !zhKeys.has(k))).toEqual([]);
  });

  it('every zh-TW.json key exists in en.json', () => {
    expect([...zhKeys].filter((k) => !enKeys.has(k))).toEqual([]);
  });

  it('includes the v0.6 toolbox keys in both locales', () => {
    expect(enKeys.has('toolbox.title')).toBe(true);
    expect(zhKeys.has('toolbox.title')).toBe(true);
    expect(enKeys.has('nav.toolbox')).toBe(true);
    expect(zhKeys.has('nav.toolbox')).toBe(true);
  });
});
