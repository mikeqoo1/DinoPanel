import { describe, it, expect } from 'vitest';
import {
  resolveDatabasesPaths,
  assertSafeInstanceName,
  containerNameOf,
} from '../paths';

describe('resolveDatabasesPaths', () => {
  it('lays out per-engine and per-instance dirs under the given root', () => {
    const p = resolveDatabasesPaths('/opt/dinopanel/databases');
    expect(p.root).toBe('/opt/dinopanel/databases');
    expect(p.engineDir('mysql')).toBe('/opt/dinopanel/databases/mysql');
    expect(p.instanceDir('postgresql', 'app')).toBe(
      '/opt/dinopanel/databases/postgresql/app',
    );
  });
});

describe('assertSafeInstanceName', () => {
  it('accepts safe names', () => {
    expect(() => assertSafeInstanceName('shop')).not.toThrow();
    expect(() => assertSafeInstanceName('my-db')).not.toThrow();
    expect(() => assertSafeInstanceName('a1')).not.toThrow();
  });

  it('rejects path separators and NUL', () => {
    expect(() => assertSafeInstanceName('foo/bar')).toThrow(/'\/'/);
    expect(() => assertSafeInstanceName('foo\\bar')).toThrow(/'\\\\'/);
    expect(() => assertSafeInstanceName('foo\0bar')).toThrow(/NUL/);
  });

  it("rejects '..' and leading '-'", () => {
    expect(() => assertSafeInstanceName('..')).toThrow(/'\.\.'/);
    expect(() => assertSafeInstanceName('-bad')).toThrow(/leading '-'/);
  });

  it('rejects uppercase / underscores (tighter than v0.3 site names)', () => {
    // v0.4 instance names also become container name suffix + PMM
    // service_name — narrower charset (no underscore) is intentional.
    expect(() => assertSafeInstanceName('MyDB')).toThrow();
    expect(() => assertSafeInstanceName('with_underscore')).toThrow();
  });
});

describe('containerNameOf', () => {
  it('composes `dinopanel-<engine>-<instance>` (canonical PMM service_name)', () => {
    expect(containerNameOf('mysql', 'shop')).toBe('dinopanel-mysql-shop');
    expect(containerNameOf('postgresql', 'app')).toBe(
      'dinopanel-postgresql-app',
    );
  });
});
