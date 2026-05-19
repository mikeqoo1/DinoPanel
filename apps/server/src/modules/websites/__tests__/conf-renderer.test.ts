import { describe, it, expect } from 'vitest';
import {
  NotImplementedYetError,
  renderSiteConf,
  type RenderContext,
} from '../conf-renderer';
import {
  siteCreateSchema,
  type ReverseProxyPayload,
  type StaticSitePayload,
} from '@dinopanel/shared';

const baseCtx = (overrides: Partial<RenderContext> = {}): RenderContext => ({
  name: 'blog',
  primaryDomain: 'blog.example.com',
  siteRoot: '/opt/dinopanel/sites/blog',
  acmeRoot: '/opt/dinopanel/acme',
  payload: {
    type: 'static',
    indexFiles: ['index.html', 'index.htm'],
  } satisfies StaticSitePayload,
  cert: null,
  ...overrides,
});

describe('renderSiteConf — static', () => {
  it('produces a recognisable static-site server block', () => {
    const out = renderSiteConf(baseCtx());
    expect(out).toContain('server_name blog.example.com;');
    expect(out).toContain('root /opt/dinopanel/sites/blog/public;');
    expect(out).toContain('index index.html index.htm;');
    expect(out).toContain('try_files $uri $uri/ =404;');
    // ACME challenge block must be present unconditionally
    expect(out).toContain('/.well-known/acme-challenge/');
    expect(out).toContain('root /opt/dinopanel/acme;');
    // No SSL when cert is null
    expect(out).not.toContain('ssl_certificate');
    expect(out).not.toContain('listen 443');
  });
});

describe('renderSiteConf — reverse_proxy', () => {
  const proxyPayload: ReverseProxyPayload = {
    type: 'reverse_proxy',
    upstream: 'http://127.0.0.1:3000',
    preserveHostHeader: false,
  };

  it('emits proxy_pass + standard X-Forwarded-* headers', () => {
    const out = renderSiteConf(
      baseCtx({ name: 'api', primaryDomain: 'api.example.com', payload: proxyPayload }),
    );
    expect(out).toContain('proxy_pass http://127.0.0.1:3000;');
    expect(out).toContain('proxy_set_header X-Real-IP $remote_addr;');
    expect(out).toContain(
      'proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;',
    );
    expect(out).toContain('proxy_set_header X-Forwarded-Proto $scheme;');
    // ACME challenge survives the proxy template too
    expect(out).toContain('/.well-known/acme-challenge/');
  });

  it('switches Host header forwarding when preserveHostHeader is true', () => {
    const out = renderSiteConf(
      baseCtx({
        name: 'api',
        primaryDomain: 'api.example.com',
        payload: { ...proxyPayload, preserveHostHeader: true },
      }),
    );
    expect(out).toContain('proxy_set_header Host $host;');
    expect(out).not.toContain('proxy_set_header Host $proxy_host;');
  });
});

describe('renderSiteConf — PHP stub', () => {
  it('throws NotImplementedYetError; landing in Phase 3', () => {
    expect(() =>
      renderSiteConf(
        baseCtx({
          payload: { type: 'php', phpVersion: '8.3', documentIndex: ['index.php'] },
        }),
      ),
    ).toThrow(NotImplementedYetError);
  });
});

describe('schema rejects shell-injection probes before reaching the renderer', () => {
  it('rejects a malicious domain like "evil.com;rm -rf /"', () => {
    const parsed = siteCreateSchema.safeParse({
      name: 'blog',
      primaryDomain: 'evil.com;rm -rf /',
      payload: { type: 'static', indexFiles: ['index.html'] },
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects an upstream URL that is not http(s)', () => {
    const parsed = siteCreateSchema.safeParse({
      name: 'api',
      primaryDomain: 'api.example.com',
      payload: {
        type: 'reverse_proxy',
        upstream: 'file:///etc/passwd',
        preserveHostHeader: false,
      },
    });
    expect(parsed.success).toBe(false);
  });
});
