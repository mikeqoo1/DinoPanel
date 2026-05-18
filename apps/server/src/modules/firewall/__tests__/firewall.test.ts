import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseUfwRules, buildUfwArgs } from '../drivers/ufw.driver';
import { parseFirewalldOutput, buildRichRule } from '../drivers/firewalld.driver';
import { FirewallService } from '../firewall.service';
import type { FirewallDriver, RawRule } from '../firewall-driver';

// ---------------------------------------------------------------------------
// UfwDriver parser/builder
// ---------------------------------------------------------------------------

const UFW_GOLDEN = `Status: active

     To                         Action      From
     --                         ------      ----
[ 1] 22/tcp                     ALLOW IN    Anywhere
[ 2] 80/tcp                     ALLOW IN    Anywhere
[ 3] 443                        ALLOW IN    Anywhere
[ 4] 22/tcp                     ALLOW IN    192.168.1.0/24
[ 5] 22/tcp (v6)                ALLOW IN    Anywhere (v6)
[ 6] 8080:8090/tcp              ALLOW IN    Anywhere
[ 7] 8081/tcp                   DENY IN     203.0.113.5
`;

describe('UfwDriver parsing', () => {
  it('parses a multi-shape golden output, skipping (v6) duplicates and port-ranges', () => {
    const rules = parseUfwRules(UFW_GOLDEN);
    expect(rules).toEqual([
      { port: 22, proto: 'tcp', source: null, action: 'allow' },
      { port: 80, proto: 'tcp', source: null, action: 'allow' },
      { port: 443, proto: 'any', source: null, action: 'allow' },
      { port: 22, proto: 'tcp', source: '192.168.1.0/24', action: 'allow' },
      { port: 8081, proto: 'tcp', source: '203.0.113.5', action: 'deny' },
    ]);
  });

  it('returns empty array for inactive status', () => {
    expect(parseUfwRules('Status: inactive')).toEqual([]);
  });
});

describe('UfwDriver builder', () => {
  it('builds simple allow without source', () => {
    expect(buildUfwArgs({ port: 22, proto: 'tcp', source: null, action: 'allow' })).toEqual([
      'allow',
      '22/tcp',
    ]);
  });

  it('builds allow with source uses from/to/port form', () => {
    expect(
      buildUfwArgs({ port: 22, proto: 'tcp', source: '10.0.0.0/8', action: 'allow' }),
    ).toEqual(['allow', 'from', '10.0.0.0/8', 'to', 'any', 'port', '22', 'proto', 'tcp']);
  });

  it('omits proto when "any"', () => {
    expect(buildUfwArgs({ port: 443, proto: 'any', source: null, action: 'deny' })).toEqual([
      'deny',
      '443',
    ]);
  });
});

// ---------------------------------------------------------------------------
// FirewalldDriver parser/builder
// ---------------------------------------------------------------------------

const FIREWALLD_GOLDEN = `public (default, active)
  target: default
  icmp-block-inversion: no
  interfaces:
  sources:
  services: ssh dhcpv6-client
  ports: 80/tcp 443/tcp
  protocols:
  forward: yes
  rich rules:
        rule family="ipv4" port port="3000" protocol="tcp" accept
        rule family="ipv4" source address="1.2.3.4" port port="22" protocol="tcp" reject
`;

describe('FirewalldDriver parsing', () => {
  it('parses ports: line and rich rules together', () => {
    const rules = parseFirewalldOutput(FIREWALLD_GOLDEN);
    expect(rules).toContainEqual({ port: 80, proto: 'tcp', source: null, action: 'allow' });
    expect(rules).toContainEqual({ port: 443, proto: 'tcp', source: null, action: 'allow' });
    expect(rules).toContainEqual({ port: 3000, proto: 'tcp', source: null, action: 'allow' });
    expect(rules).toContainEqual({
      port: 22,
      proto: 'tcp',
      source: '1.2.3.4',
      action: 'deny',
    });
  });
});

describe('FirewalldDriver builder', () => {
  it('builds ipv4 rich-rule without source', () => {
    expect(
      buildRichRule({ port: 22, proto: 'tcp', source: null, action: 'allow' }),
    ).toBe('rule family="ipv4" port port="22" protocol="tcp" accept');
  });

  it('builds ipv6 family when source contains :', () => {
    expect(
      buildRichRule({ port: 22, proto: 'tcp', source: '2001:db8::/32', action: 'deny' }),
    ).toBe(
      'rule family="ipv6" source address="2001:db8::/32" port port="22" protocol="tcp" reject',
    );
  });
});

// ---------------------------------------------------------------------------
// FirewallService — staged map + recovery + self-protect
// ---------------------------------------------------------------------------

interface FakeMetaRow {
  id: number;
  port: number;
  proto: 'tcp' | 'udp' | 'any';
  source: string | null;
  action: 'allow' | 'deny';
  comment: string | null;
  createdBy: number | null;
  createdAt: number;
  stagedAt: number | null;
  confirmingAt: number | null;
  confirmedAt: number | null;
}

function makeFakeDb(initialRows: FakeMetaRow[] = []) {
  const rows: FakeMetaRow[] = [...initialRows];
  let nextId = Math.max(0, ...rows.map((r) => r.id)) + 1;

  const fakeDb = {
    rows,
    insert: vi.fn((_table: unknown) => ({
      values: (row: Partial<FakeMetaRow>) => ({
        returning: (_cols: unknown) => {
          const full: FakeMetaRow = {
            id: nextId++,
            port: row.port ?? 0,
            proto: row.proto ?? 'any',
            source: row.source ?? null,
            action: row.action ?? 'allow',
            comment: row.comment ?? null,
            createdBy: row.createdBy ?? null,
            createdAt: Date.now(),
            stagedAt: row.stagedAt ?? null,
            confirmingAt: row.confirmingAt ?? null,
            confirmedAt: row.confirmedAt ?? null,
          };
          rows.push(full);
          return Promise.resolve([{ id: full.id }]);
        },
      }),
    })),
    update: vi.fn((_table: unknown) => ({
      set: (changes: Partial<FakeMetaRow>) => ({
        where: (_clause: unknown) => {
          // Naive: apply changes to ALL rows that match the marker we
          // emitted via eq(). We can't introspect drizzle's SQL easily,
          // so just apply to whichever row(s) have a matching id captured
          // in the test setup. For these tests we rely on tests using the
          // last-inserted row to make this safe.
          for (const r of rows) {
            Object.assign(r, changes);
          }
          return Promise.resolve();
        },
      }),
    })),
    delete: vi.fn((_table: unknown) => ({
      where: (_clause: unknown) => {
        rows.length = 0;
        return Promise.resolve();
      },
    })),
    select: vi.fn((_cols?: unknown) => ({
      from: (_table: unknown) => ({
        where: (_clause: unknown) => ({
          limit: (_n: number) => Promise.resolve(rows.slice(0, _n)),
        }),
        // also direct .where without limit, for listRules
      }),
    })),
  };
  return fakeDb;
}

class FakeDriver implements FirewallDriver {
  readonly backend = 'ufw' as const;
  added: RawRule[] = [];
  removed: RawRule[] = [];
  getStatus = vi.fn().mockResolvedValue({ enabled: true });
  enable = vi.fn().mockResolvedValue(undefined);
  disable = vi.fn().mockResolvedValue(undefined);
  listRules = vi.fn().mockResolvedValue([]);
  addRule = vi.fn(async (r: RawRule) => {
    this.added.push(r);
  });
  removeRule = vi.fn(async (r: RawRule) => {
    this.removed.push(r);
  });
}

function makeConfig(panelPort = 9999, sshPort = 22) {
  return {
    get: vi.fn().mockReturnValue({ env: { PORT: panelPort, SSH_PORT: sshPort } }),
  };
}

const noopLogger = { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() };

describe('FirewallService — self-protect', () => {
  let service: FirewallService;
  let driver: FakeDriver;
  let db: ReturnType<typeof makeFakeDb>;

  beforeEach(() => {
    db = makeFakeDb();
    driver = new FakeDriver();
    service = new FirewallService(db as never, driver, noopLogger as never, makeConfig() as never);
  });

  it('rejects deny on the panel bind port without ack', async () => {
    await expect(
      service.stage(
        { port: 9999, proto: 'tcp', action: 'deny' },
        1,
      ),
    ).rejects.toMatchObject({
      response: { code: 'FIREWALL_SELF_LOCKOUT' },
    });
    expect(driver.added).toHaveLength(0);
  });

  it('rejects deny on the SSH port without ack', async () => {
    await expect(
      service.stage(
        { port: 22, proto: 'tcp', action: 'deny' },
        1,
      ),
    ).rejects.toMatchObject({
      response: { code: 'FIREWALL_SELF_LOCKOUT' },
    });
  });

  it('allows deny when acknowledgeSelfLockout is true', async () => {
    const result = await service.stage(
      { port: 22, proto: 'tcp', action: 'deny', acknowledgeSelfLockout: true },
      1,
    );
    expect(result.stagedId).toBeGreaterThan(0);
    expect(driver.added).toHaveLength(1);
  });

  it('allows allow on the same ports without ack (the safeguard is deny-only)', async () => {
    await service.stage({ port: 22, proto: 'tcp', action: 'allow' }, 1);
    expect(driver.added).toHaveLength(1);
  });
});

describe('FirewallService — staged lifecycle', () => {
  let service: FirewallService;
  let driver: FakeDriver;
  let db: ReturnType<typeof makeFakeDb>;

  beforeEach(() => {
    vi.useFakeTimers();
    db = makeFakeDb();
    driver = new FakeDriver();
    service = new FirewallService(db as never, driver, noopLogger as never, makeConfig() as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('auto-reverts after the 30s window if not confirmed', async () => {
    await service.stage({ port: 8080, proto: 'tcp', action: 'allow' }, 1);
    expect(driver.added).toHaveLength(1);
    expect(driver.removed).toHaveLength(0);

    // advance just past the window
    await vi.advanceTimersByTimeAsync(30_500);

    expect(driver.removed).toHaveLength(1);
    expect(driver.removed[0]).toMatchObject({ port: 8080 });
  });

  it('confirm clears the timer and prevents revert', async () => {
    const staged = await service.stage(
      { port: 8081, proto: 'tcp', action: 'allow' },
      1,
    );
    await service.confirm(staged.stagedId);
    await vi.advanceTimersByTimeAsync(31_000);
    expect(driver.removed).toHaveLength(0);
  });

  it('cancel removes the rule via driver and deletes metadata', async () => {
    const staged = await service.stage(
      { port: 8082, proto: 'tcp', action: 'allow' },
      1,
    );
    await service.cancelStage(staged.stagedId);
    expect(driver.removed).toHaveLength(1);
    expect(driver.removed[0]).toMatchObject({ port: 8082 });
  });
});
