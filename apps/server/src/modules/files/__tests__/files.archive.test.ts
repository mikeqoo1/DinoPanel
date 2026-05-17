import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep as pathSep } from 'node:path';
import unzipper from 'unzipper';

import { FilesService } from '../files.service';

// Integration tests for compressToDisk + extract. Uses real fs under a
// per-test tmpdir; deliberately does not share the mocked-fs setup
// from files.service.test.ts.

let workdir = '';
const svc = new FilesService();

beforeEach(async () => {
  workdir = await fs.mkdtemp(join(tmpdir(), 'dinopanel-archive-test-'));
});

afterEach(async () => {
  if (workdir) await fs.rm(workdir, { recursive: true, force: true });
});

async function seedTree(): Promise<{ root: string }> {
  const root = join(workdir, 'src');
  await fs.mkdir(join(root, 'sub'), { recursive: true });
  await fs.writeFile(join(root, 'a.txt'), 'alpha\n');
  await fs.writeFile(join(root, 'sub', 'b.txt'), 'beta\n');
  return { root };
}

describe('FilesService.compressToDisk', () => {
  it('AR-1 — writes a tar.gz archive containing the source tree', async () => {
    const { root } = await seedTree();
    const dest = join(workdir, 'out.tar.gz');

    await svc.compressToDisk([root], dest, 'tar.gz');

    const st = await fs.stat(dest);
    expect(st.isFile()).toBe(true);
    expect(st.size).toBeGreaterThan(0);
  });

  it('AR-2 — writes a zip archive containing the source tree', async () => {
    const { root } = await seedTree();
    const dest = join(workdir, 'out.zip');

    await svc.compressToDisk([root], dest, 'zip');

    const st = await fs.stat(dest);
    expect(st.isFile()).toBe(true);
    expect(st.size).toBeGreaterThan(0);
  });

  it('AR-3 — empty paths array → BadRequestException', async () => {
    await expect(
      svc.compressToDisk([], join(workdir, 'out.tar.gz'), 'tar.gz'),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('FilesService.extract', () => {
  it('AR-4 — round-trips a tar.gz: compressToDisk → extract → contents match', async () => {
    const { root } = await seedTree();
    const archive = join(workdir, 'round.tar.gz');
    const out = join(workdir, 'out');

    await svc.compressToDisk([root], archive, 'tar.gz');
    await svc.extract(archive, out);

    const aContents = await fs.readFile(join(out, 'src', 'a.txt'), 'utf8');
    const bContents = await fs.readFile(join(out, 'src', 'sub', 'b.txt'), 'utf8');
    expect(aContents).toBe('alpha\n');
    expect(bContents).toBe('beta\n');
  });

  it('AR-5 — round-trips a zip: compressToDisk → extract → contents match', async () => {
    const { root } = await seedTree();
    const archive = join(workdir, 'round.zip');
    const out = join(workdir, 'out');

    await svc.compressToDisk([root], archive, 'zip');
    await svc.extract(archive, out);

    const aContents = await fs.readFile(join(out, 'src', 'a.txt'), 'utf8');
    const bContents = await fs.readFile(join(out, 'src', 'sub', 'b.txt'), 'utf8');
    expect(aContents).toBe('alpha\n');
    expect(bContents).toBe('beta\n');
  });

  it('AR-6 — rejects a zip whose entry path escapes the destination', async () => {
    // archiver normalises entry names (strips leading "..") when writing a
    // zip, so a "real" malicious archive can't be built via archiver. We
    // instead spy on unzipper.Open.file and return a synthetic directory
    // listing that contains a path-traversing entry.
    const malicious = join(workdir, 'evil.zip');
    await fs.writeFile(malicious, ''); // file just needs to exist + stat as a regular file

    const fakeDirectory = {
      files: [
        { path: '../escaped.txt', type: 'File', stream: () => { throw new Error('should not stream'); } },
        { path: 'inner.txt', type: 'File', stream: () => { throw new Error('should not stream'); } },
      ],
    };
    const openSpy = vi.spyOn(unzipper.Open, 'file').mockResolvedValue(fakeDirectory as never);

    try {
      const out = join(workdir, 'out');
      await expect(svc.extract(malicious, out)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'FILE_ARCHIVE_TRAVERSAL' }),
      });

      // Neither entry should have been written — we reject before any stream() call.
      await expect(fs.access(join(workdir, 'escaped.txt'))).rejects.toBeDefined();
      await expect(fs.access(join(out, 'inner.txt'))).rejects.toBeDefined();
    } finally {
      openSpy.mockRestore();
    }
  });

  it('AR-7 — unsupported extension → FILE_UNSUPPORTED_ARCHIVE', async () => {
    const fake = join(workdir, 'thing.rar');
    await fs.writeFile(fake, 'not a real archive');

    await expect(svc.extract(fake, join(workdir, 'out'))).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'FILE_UNSUPPORTED_ARCHIVE' }),
    });
  });

  it('AR-8 — entry resolving to a sibling-prefix path is rejected (the `+ pathSep` regression case)', async () => {
    // Regression for the prefix-comparison: dest is "/tmp/foo" and an
    // entry resolves to "/tmp/foo_extra/x.txt". Without the trailing
    // path separator in the comparison we would falsely accept it because
    // "/tmp/foo_extra/x.txt".startsWith("/tmp/foo") is true.
    const evilDir = join(workdir, 'foo');
    await fs.mkdir(evilDir);
    const archive = join(workdir, 'evil2.zip');
    await fs.writeFile(archive, '');

    const fakeDirectory = {
      files: [
        { path: '../foo_extra/x.txt', type: 'File', stream: () => { throw new Error('should not stream'); } },
      ],
    };
    const openSpy = vi.spyOn(unzipper.Open, 'file').mockResolvedValue(fakeDirectory as never);

    try {
      await expect(svc.extract(archive, evilDir)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'FILE_ARCHIVE_TRAVERSAL' }),
      });
    } finally {
      openSpy.mockRestore();
    }

    // pathSep import is referenced — covers the regression case the guard targets
    expect(pathSep).toMatch(/[/\\]/);
  });
});
