import { describe, it, expect } from 'vitest';
import { resolveWebsitesPaths, assertSafeSiteName } from '../paths';

describe('resolveWebsitesPaths', () => {
  it('lays out the six v0.3 directories under the given root', () => {
    const p = resolveWebsitesPaths('/opt/dinopanel');
    expect(p).toEqual({
      root: '/opt/dinopanel',
      sitesDir: '/opt/dinopanel/sites',
      nginxConfDir: '/opt/dinopanel/nginx/conf.d',
      acmeDir: '/opt/dinopanel/acme',
      acmeCertsDir: '/opt/dinopanel/acme/certs',
      acmeChallengeDir: '/opt/dinopanel/acme/.well-known/acme-challenge',
    });
  });

  it('honors a custom root without leaking the default', () => {
    const p = resolveWebsitesPaths('/tmp/dp-test');
    expect(p.sitesDir).toBe('/tmp/dp-test/sites');
    expect(p.acmeChallengeDir).toBe(
      '/tmp/dp-test/acme/.well-known/acme-challenge',
    );
  });
});

describe('assertSafeSiteName', () => {
  it('accepts safe names', () => {
    expect(() => assertSafeSiteName('blog')).not.toThrow();
    expect(() => assertSafeSiteName('my-site')).not.toThrow();
    expect(() => assertSafeSiteName('site_2')).not.toThrow();
    expect(() => assertSafeSiteName('a1')).not.toThrow();
  });

  it('rejects path separators and NUL', () => {
    expect(() => assertSafeSiteName('foo/bar')).toThrow(/'\/'/);
    expect(() => assertSafeSiteName('foo\\bar')).toThrow(/'\\\\'/);
    expect(() => assertSafeSiteName('foo\0bar')).toThrow(/NUL/);
  });

  it("rejects '..' even with otherwise-legal characters", () => {
    expect(() => assertSafeSiteName('a..b')).toThrow(/'\.\.'/);
    expect(() => assertSafeSiteName('..')).toThrow();
  });

  it('rejects leading dot or dash', () => {
    expect(() => assertSafeSiteName('.hidden')).toThrow(/leading/);
    expect(() => assertSafeSiteName('-flag')).toThrow(/leading/);
  });

  it('rejects empty and over-length names', () => {
    expect(() => assertSafeSiteName('')).toThrow(/length/);
    expect(() => assertSafeSiteName('a'.repeat(64))).toThrow(/length/);
  });

  it('rejects uppercase, spaces, and shell metacharacters', () => {
    expect(() => assertSafeSiteName('FooBar')).toThrow();
    expect(() => assertSafeSiteName('foo bar')).toThrow();
    expect(() => assertSafeSiteName('a$b')).toThrow();
    expect(() => assertSafeSiteName('a;b')).toThrow();
  });
});
