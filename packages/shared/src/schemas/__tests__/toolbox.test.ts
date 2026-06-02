import { describe, it, expect } from 'vitest';
import {
  cleanBodySchema,
  cleanCategorySchema,
  setTimezoneBodySchema,
  isRealFilesystem,
  PSEUDO_FSTYPES,
} from '../toolbox';

describe('cleanCategorySchema — closed cleaner enum', () => {
  it('accepts the three curated, tool-owned categories', () => {
    for (const category of ['journald', 'package_cache', 'docker_prune']) {
      expect(cleanCategorySchema.safeParse(category).success).toBe(true);
    }
  });

  it('rejects any category outside the enum (incl. the dropped tmp_sweep)', () => {
    // tmp_sweep was deliberately dropped (P2-a): a blanket /tmp wipe is unsafe.
    for (const category of ['tmp_sweep', 'rm_rf', 'arbitrary', '']) {
      expect(cleanBodySchema.safeParse({ category }).success).toBe(false);
    }
  });
});

describe('setTimezoneBodySchema — timezone shape guard', () => {
  it('accepts real IANA zone names', () => {
    for (const timezone of ['UTC', 'Asia/Taipei', 'America/Argentina/Buenos_Aires', 'Etc/GMT+8']) {
      expect(setTimezoneBodySchema.safeParse({ timezone }).success).toBe(true);
    }
  });

  it('rejects a leading-dash value so it can never be read as a flag', () => {
    for (const timezone of ['-Asia/Taipei', '--rm', '-rf']) {
      expect(setTimezoneBodySchema.safeParse({ timezone }).success).toBe(false);
    }
  });

  it('rejects shell-injection / path-traversal shapes', () => {
    for (const timezone of ['Asia/Taipei; rm -rf /', '../../etc/passwd', 'UTC && reboot', '$(whoami)']) {
      expect(setTimezoneBodySchema.safeParse({ timezone }).success).toBe(false);
    }
  });

  it('rejects an over-long value (bounded length)', () => {
    expect(setTimezoneBodySchema.safeParse({ timezone: 'A'.repeat(65) }).success).toBe(false);
  });
});

describe('isRealFilesystem — disk-table de-noise key', () => {
  it('accepts real storage filesystems', () => {
    for (const fs of ['ext4', 'ext3', 'xfs', 'btrfs', 'vfat', 'ntfs', 'zfs', 'f2fs', 'exfat']) {
      expect(isRealFilesystem(fs)).toBe(true);
    }
  });

  it('rejects docker-overlay + kernel pseudo filesystems', () => {
    for (const fs of ['overlay', 'tmpfs', 'devtmpfs', 'proc', 'sysfs', 'cgroup', 'cgroup2', 'squashfs']) {
      expect(isRealFilesystem(fs)).toBe(false);
      expect(PSEUDO_FSTYPES.has(fs)).toBe(true);
    }
  });

  it('rejects any fuse.* type (e.g. fuse.sshfs)', () => {
    expect(isRealFilesystem('fuse.sshfs')).toBe(false);
    expect(isRealFilesystem('fuse.gvfsd-fuse')).toBe(false);
  });
});
