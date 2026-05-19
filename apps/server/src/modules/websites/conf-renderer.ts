import type {
  Domain,
  PhpPayload,
  ReverseProxyPayload,
  SiteCertInfo,
  SitePayload,
  StaticSitePayload,
} from '@dinopanel/shared';
import { join } from 'node:path';

export interface RenderContext {
  /** Site name (already validated by siteNameSchema + assertSafeSiteName). */
  name: string;
  /** Primary domain (validated by domainSchema). */
  primaryDomain: Domain;
  /** Type-specific payload (validated by sitePayloadSchema). */
  payload: SitePayload;
  /** Per-site content root, e.g. `/opt/dinopanel/sites/<name>`. */
  siteRoot: string;
  /** ACME challenge webroot, e.g. `/opt/dinopanel/acme`. */
  acmeRoot: string;
  /** Issued cert paths, when SSL is provisioned. */
  cert?: SiteCertInfo | null;
  /** PHP-FPM Unix socket path; required when rendering PHP sites. */
  phpFpmSocketPath?: string;
}

export class NotImplementedYetError extends Error {
  constructor(public readonly feature: string) {
    super(`${feature}: NOT_IMPLEMENTED_YET`);
    this.name = 'NotImplementedYetError';
  }
}

export class MissingPhpFpmConfigError extends Error {
  constructor() {
    super(
      'PHP site requires phpFpmSocketPath in RenderContext (set PHP_FPM_SOCKET_PATH env)',
    );
    this.name = 'MissingPhpFpmConfigError';
  }
}

/**
 * Render an nginx server block from a typed context.
 *
 * Every input has been Zod-validated before reaching this function.
 * Defense-in-depth: the renderer never interpolates raw user strings
 * outside of values that the schema already constrained. Domain regex
 * forbids `;`, `{`, `}`, etc.; upstream URL is parsed by URL ctor;
 * paths are derived from validated site name.
 */
export function renderSiteConf(ctx: RenderContext): string {
  switch (ctx.payload.type) {
    case 'static':
      return renderStatic(ctx, ctx.payload);
    case 'reverse_proxy':
      return renderReverseProxy(ctx, ctx.payload);
    case 'php':
      return renderPhp(ctx, ctx.payload);
  }
}

function renderHead(ctx: RenderContext): string {
  return `# Managed by DinoPanel — site=${ctx.name}\n# Edit at your own risk; reconcile will surface drift.\n`;
}

function renderListen(ctx: RenderContext): string {
  const lines = ['    listen 80;', '    listen [::]:80;'];
  if (ctx.cert) {
    lines.push('    listen 443 ssl;', '    listen [::]:443 ssl;');
  }
  return lines.join('\n');
}

function renderSslBlock(cert: SiteCertInfo): string {
  return [
    `    ssl_certificate ${cert.fullchainPath};`,
    `    ssl_certificate_key ${cert.privkeyPath};`,
    '    ssl_protocols TLSv1.2 TLSv1.3;',
    '    ssl_prefer_server_ciphers off;',
  ].join('\n');
}

function renderAcmeChallengeLocation(acmeRoot: string): string {
  // Unconditional include — costs nothing on sites without ACME, and saves
  // the "I forgot to add the location block" footgun in Phase 4.
  return [
    '    location ^~ /.well-known/acme-challenge/ {',
    `        root ${acmeRoot};`,
    '        default_type "text/plain";',
    '    }',
  ].join('\n');
}

function renderStatic(ctx: RenderContext, payload: StaticSitePayload): string {
  const docRoot = join(ctx.siteRoot, 'public');
  const indexDirective = `    index ${payload.indexFiles.join(' ')};`;
  return [
    renderHead(ctx),
    'server {',
    renderListen(ctx),
    `    server_name ${ctx.primaryDomain};`,
    ctx.cert ? renderSslBlock(ctx.cert) : '',
    renderAcmeChallengeLocation(ctx.acmeRoot),
    `    root ${docRoot};`,
    indexDirective,
    '    location / {',
    '        try_files $uri $uri/ =404;',
    '    }',
    '}',
    '',
  ]
    .filter((s) => s !== '')
    .join('\n');
}

function renderPhp(ctx: RenderContext, payload: PhpPayload): string {
  if (!ctx.phpFpmSocketPath) throw new MissingPhpFpmConfigError();
  const docRoot = join(ctx.siteRoot, 'public');
  const indexDirective = `    index ${payload.documentIndex.join(' ')};`;
  return [
    renderHead(ctx),
    `# PHP ${payload.phpVersion} via FPM at ${ctx.phpFpmSocketPath}`,
    'server {',
    renderListen(ctx),
    `    server_name ${ctx.primaryDomain};`,
    ctx.cert ? renderSslBlock(ctx.cert) : '',
    renderAcmeChallengeLocation(ctx.acmeRoot),
    `    root ${docRoot};`,
    indexDirective,
    '    location / {',
    '        try_files $uri $uri/ /index.php?$query_string;',
    '    }',
    '    location ~ \\.php$ {',
    `        fastcgi_pass unix:${ctx.phpFpmSocketPath};`,
    '        fastcgi_index index.php;',
    '        include fastcgi_params;',
    '        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;',
    '        fastcgi_param PATH_INFO $fastcgi_path_info;',
    '        fastcgi_split_path_info ^(.+\\.php)(/.+)$;',
    '    }',
    '    location ~ /\\.(?!well-known) {',
    '        deny all;',
    '    }',
    '}',
    '',
  ]
    .filter((s) => s !== '')
    .join('\n');
}

function renderReverseProxy(
  ctx: RenderContext,
  payload: ReverseProxyPayload,
): string {
  const hostDirective = payload.preserveHostHeader
    ? '        proxy_set_header Host $host;'
    : '        proxy_set_header Host $proxy_host;';
  return [
    renderHead(ctx),
    'server {',
    renderListen(ctx),
    `    server_name ${ctx.primaryDomain};`,
    ctx.cert ? renderSslBlock(ctx.cert) : '',
    renderAcmeChallengeLocation(ctx.acmeRoot),
    '    location / {',
    `        proxy_pass ${payload.upstream};`,
    hostDirective,
    '        proxy_set_header X-Real-IP $remote_addr;',
    '        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;',
    '        proxy_set_header X-Forwarded-Proto $scheme;',
    '        proxy_http_version 1.1;',
    '        proxy_set_header Connection "";',
    '    }',
    '}',
    '',
  ]
    .filter((s) => s !== '')
    .join('\n');
}
