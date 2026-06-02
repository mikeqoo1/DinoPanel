import { describe, it, expect } from 'vitest';
import { HttpException } from '@nestjs/common';
import { parseDf, parseDu, UnavailableDiskDriver } from '../drivers/disk-driver';

// Real `df -PTB1` (the dev host prints a localized zh_TW header — the parser
// skips line 0 and reads data rows positionally; rows are locale-proof under -P).
// `-T` inserts the fstype column (never localized) right after the device. The
// `overlay` row is the docker-host noise the web de-noises by fstype.
const DF_GOLDEN = `檔案系統        類型      1-區塊         已用        可用 容量 掛載點
tmpfs           tmpfs     1646391296      7602176  1638789120   1% /run
/dev/sda9       ext4    257802690560 166477746176 78154674176  69% /
overlay         overlay 257802690560 166477746176 78154674176  69% /var/lib/docker/overlay2/abc/merged
tmpfs           tmpfs        5242880         4096     5238784   1% /run/lock
/dev/sda3       vfat       535805952      6979584   528826368   2% /boot/efi
`;

// Pseudo filesystems (only appear with `df -a`): Capacity "-" => usePercent null;
// the all-dash systemd-1 binfmt row has a non-numeric block column and is skipped.
const DF_PSEUDO_GOLDEN = `Filesystem Type 1-blocks Used Available Capacity Mounted on
sysfs sysfs 0 0 0 - /sys
systemd-1 - - - - - /proc/sys/fs/binfmt_misc
`;

const DU_GOLDEN = `25138581504\t/var
20133314560\t/var/lib
4761554944\t/var/log
171286528\t/var/cache
86016\t/var/tmp
`;

describe('parseDf', () => {
  it('parses df -PTB1 rows positionally (incl. fstype), skipping the (localized) header', () => {
    expect(parseDf(DF_GOLDEN)).toEqual([
      { source: 'tmpfs', fstype: 'tmpfs', mount: '/run', total: 1646391296, used: 7602176, available: 1638789120, usePercent: 1 },
      { source: '/dev/sda9', fstype: 'ext4', mount: '/', total: 257802690560, used: 166477746176, available: 78154674176, usePercent: 69 },
      { source: 'overlay', fstype: 'overlay', mount: '/var/lib/docker/overlay2/abc/merged', total: 257802690560, used: 166477746176, available: 78154674176, usePercent: 69 },
      { source: 'tmpfs', fstype: 'tmpfs', mount: '/run/lock', total: 5242880, used: 4096, available: 5238784, usePercent: 1 },
      { source: '/dev/sda3', fstype: 'vfat', mount: '/boot/efi', total: 535805952, used: 6979584, available: 528826368, usePercent: 2 },
    ]);
  });

  it('maps "-" capacity to null and skips non-numeric rows', () => {
    const rows = parseDf(DF_PSEUDO_GOLDEN);
    expect(rows).toEqual([
      { source: 'sysfs', fstype: 'sysfs', mount: '/sys', total: 0, used: 0, available: 0, usePercent: null },
    ]);
  });

  it('clamps a >100% capacity (root-reserved blocks) to 100', () => {
    const rows = parseDf('Filesystem Type 1-blocks Used Available Capacity Mounted on\n/dev/sda1 ext4 1000 1000 0 105% /\n');
    expect(rows[0]!.usePercent).toBe(100);
  });
});

describe('parseDu', () => {
  it('extracts the root total and returns children largest-first', () => {
    expect(parseDu(DU_GOLDEN, '/var')).toEqual({
      root: '/var',
      total: 25138581504,
      entries: [
        { path: '/var/lib', bytes: 20133314560 },
        { path: '/var/log', bytes: 4761554944 },
        { path: '/var/cache', bytes: 171286528 },
        { path: '/var/tmp', bytes: 86016 },
      ],
    });
  });
});

describe('UnavailableDiskDriver — degrades to 503 when df is absent', () => {
  const driver = new UnavailableDiskDriver();

  it('reports available=false without touching the host', () => {
    expect(driver.available).toBe(false);
  });

  it.each([
    ['listFilesystems', () => driver.listFilesystems()],
    ['breakdown', () => driver.breakdown()],
  ])('%s 503s with DISK_NOT_CONFIGURED', (_name, op) => {
    let caught: unknown;
    try {
      void op();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(HttpException);
    expect((caught as HttpException).getStatus()).toBe(503);
    expect((caught as HttpException).getResponse()).toMatchObject({ code: 'DISK_NOT_CONFIGURED' });
  });
});
