import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpException } from '@nestjs/common';
import { parseUfwRules, buildUfwArgs } from '../drivers/ufw.driver';
import { parseFirewalldOutput, buildRichRule } from '../drivers/firewalld.driver';
import {
  FirewallService,
  parseFail2banJailList,
  parseFail2banJailDetail,
} from '../firewall.service';
import type { FirewallDriver, RawRule } from '../firewall-driver';
import { CommandError, runCommand } from '../../../common/shell/run-command';
import type * as RunCommandModule from '../../../common/shell/run-command';

// Stub the shell layer so the fail2ban service ops (which call the module-level
// runCommand directly, not the injected driver) are controllable. Everything
// else — CommandError, assertSuccess, commandErrorToHttp — stays real so the
// re-wrap + allowlist logic is exercised for real. No other test in this file
// touches runCommand/probeCommand (the FirewallDriver is faked), so this is inert
// for them.
vi.mock('../../../common/shell/run-command', async (importOriginal) => {
  const actual = await importOriginal<typeof RunCommandModule>();
  return { ...actual, runCommand: vi.fn(), probeCommand: vi.fn() };
});

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

describe('FirewallService — driver error re-wrap (v0.6 Phase 0)', () => {
  it('re-wraps a driver CommandError as a coded HttpException, not a bare 500', async () => {
    const db = makeFakeDb();
    const driver = new FakeDriver();
    driver.getStatus = vi
      .fn()
      .mockRejectedValue(new CommandError('TOOL_MISSING', 'ufw: not installed'));
    const service = new FirewallService(
      db as never,
      driver,
      noopLogger as never,
      makeConfig() as never,
    );

    let caught: unknown;
    try {
      await service.getStatus();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(HttpException);
    expect((caught as HttpException).getStatus()).toBe(503);
    expect((caught as HttpException).getResponse()).toMatchObject({
      code: 'FIREWALL_TOOL_MISSING',
    });
  });
});

// ---------------------------------------------------------------------------
// fail2ban-client output parsers (v0.6 Phase 2)
// ---------------------------------------------------------------------------

const F2B_STATUS_GOLDEN = `Status
|- Number of jail:      2
\`- Jail list:   sshd, nginx-http-auth
`;

const F2B_JAIL_GOLDEN = `Status for the jail: sshd
|- Filter
|  |- Currently failed: 1
|  |- Total failed:     3
|  \`- File list:        /var/log/auth.log
\`- Actions
   |- Currently banned: 2
   |- Total banned:     5
   \`- Banned IP list:   192.0.2.10 203.0.113.7
`;

const F2B_EMPTY_JAIL_GOLDEN = `Status for the jail: nginx-http-auth
\`- Actions
   |- Currently banned: 0
   |- Total banned:     0
   \`- Banned IP list:
`;

describe('parseFail2banJailList', () => {
  it('parses the global Jail list line', () => {
    expect(parseFail2banJailList(F2B_STATUS_GOLDEN)).toEqual(['sshd', 'nginx-http-auth']);
  });

  it('returns [] when no jail list is present', () => {
    expect(parseFail2banJailList('Status\n|- Number of jail: 0\n`- Jail list:\t')).toEqual([]);
  });
});

describe('parseFail2banJailDetail', () => {
  it('parses counters + banned IPs from a jail status block', () => {
    expect(parseFail2banJailDetail('sshd', F2B_JAIL_GOLDEN)).toEqual({
      name: 'sshd',
      enabled: true,
      currentlyFailed: 1,
      totalFailed: 3,
      currentlyBanned: 2,
      totalBanned: 5,
      bannedIps: ['192.0.2.10', '203.0.113.7'],
    });
  });

  it('yields an empty bannedIps array when no IPs are banned', () => {
    const jail = parseFail2banJailDetail('nginx-http-auth', F2B_EMPTY_JAIL_GOLDEN);
    expect(jail.bannedIps).toEqual([]);
    expect(jail.currentlyBanned).toBe(0);
    expect(jail.totalBanned).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// fail2ban service guardrails (v0.6 Phase 4)
// ---------------------------------------------------------------------------

describe('FirewallService — fail2ban guardrails (v0.6 Phase 4)', () => {
  function makeF2bService(fail2banAvailable: boolean): FirewallService {
    const db = makeFakeDb();
    const driver = new FakeDriver();
    const service = new FirewallService(
      db as never,
      driver,
      noopLogger as never,
      makeConfig() as never,
    );
    // `fail2banAvailable` is normally set by onApplicationBootstrap()'s probe;
    // set it directly to avoid running the boot sweep in a unit test.
    (service as unknown as { fail2banAvailable: boolean }).fail2banAvailable = fail2banAvailable;
    return service;
  }

  beforeEach(() => {
    vi.mocked(runCommand).mockReset();
  });

  it('ban/unban 400 FAIL2BAN_NOT_AVAILABLE when fail2ban is absent (no shell-out)', async () => {
    const service = makeF2bService(false);
    await expect(service.fail2banBan('sshd', '1.2.3.4')).rejects.toMatchObject({
      response: { code: 'FAIL2BAN_NOT_AVAILABLE' },
    });
    await expect(service.fail2banUnban('1.2.3.4', 'sshd')).rejects.toMatchObject({
      response: { code: 'FAIL2BAN_NOT_AVAILABLE' },
    });
    expect(runCommand).not.toHaveBeenCalled();
  });

  it('ban rejects an unknown jail via the assertJailExists allowlist', async () => {
    const service = makeF2bService(true);
    // `fail2ban-client status` returns the live jail list (sshd, nginx-http-auth).
    vi.mocked(runCommand).mockResolvedValue({ exitCode: 0, stdout: F2B_STATUS_GOLDEN, stderr: '' });
    await expect(service.fail2banBan('does-not-exist', '1.2.3.4')).rejects.toMatchObject({
      response: { code: 'FAIL2BAN_JAIL_NOT_FOUND' },
    });
  });

  it('unban rejects an unknown jail via the assertJailExists allowlist', async () => {
    const service = makeF2bService(true);
    vi.mocked(runCommand).mockResolvedValue({ exitCode: 0, stdout: F2B_STATUS_GOLDEN, stderr: '' });
    await expect(service.fail2banUnban('1.2.3.4', 'does-not-exist')).rejects.toMatchObject({
      response: { code: 'FAIL2BAN_JAIL_NOT_FOUND' },
    });
  });

  it('setJailEnabled rejects an injection-shaped jail name before shelling out', async () => {
    const service = makeF2bService(true);
    await expect(service.fail2banSetJailEnabled('-evil', true)).rejects.toMatchObject({
      response: { code: 'FAIL2BAN_INVALID_JAIL' },
    });
    expect(runCommand).not.toHaveBeenCalled();
  });

  it('ban shells out the exact argv the sudoers Cmnd_Alias pins', async () => {
    const service = makeF2bService(true);
    // The assertJailExists status read + the mutation both go through runCommand;
    // a golden jail list satisfies the allowlist and exitCode 0 satisfies assertSuccess.
    vi.mocked(runCommand).mockResolvedValue({ exitCode: 0, stdout: F2B_STATUS_GOLDEN, stderr: '' });
    await expect(service.fail2banBan('sshd', '1.2.3.4')).resolves.toEqual({ ok: true });
    expect(runCommand).toHaveBeenCalledWith(
      'fail2ban-client',
      ['set', 'sshd', 'banip', '1.2.3.4'],
      expect.anything(),
    );
  });

  it('unban shells out unbanip with the (ip, jail) params in the right order', async () => {
    const service = makeF2bService(true);
    vi.mocked(runCommand).mockResolvedValue({ exitCode: 0, stdout: F2B_STATUS_GOLDEN, stderr: '' });
    // fail2banUnban takes (ip, jail) — the OPPOSITE order from fail2banBan(jail, ip);
    // pin it so a transposition can't slip through.
    await expect(service.fail2banUnban('1.2.3.4', 'sshd')).resolves.toEqual({ ok: true });
    expect(runCommand).toHaveBeenCalledWith(
      'fail2ban-client',
      ['set', 'sshd', 'unbanip', '1.2.3.4'],
      expect.anything(),
    );
  });
});

describe('FirewallService — stderr redaction (v0.6 Phase 4)', () => {
  it('logs full stderr server-side but does NOT forward it to the client (isDev=false)', async () => {
    const db = makeFakeDb();
    const driver = new FakeDriver();
    driver.getStatus = vi
      .fn()
      .mockRejectedValue(new CommandError('COMMAND_FAILED', 'ufw failed', 'sensitive host stderr'));
    const service = new FirewallService(
      db as never,
      driver,
      noopLogger as never,
      makeConfig() as never,
    );

    const caught = (await service.getStatus().catch((e: unknown) => e)) as HttpException;
    expect(caught).toBeInstanceOf(HttpException);
    expect(caught.getResponse()).toMatchObject({ code: 'FIREWALL_COMMAND_FAILED' });
    expect(caught.getResponse()).not.toHaveProperty('details');
    // The full stderr is preserved in the server log, never silently dropped.
    expect(noopLogger.warn).toHaveBeenCalledWith(
      { kind: 'COMMAND_FAILED', stderr: 'sensitive host stderr' },
      'firewall.command_failed',
    );
  });
});
