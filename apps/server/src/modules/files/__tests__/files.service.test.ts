import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, PayloadTooLargeException } from '@nestjs/common';

// ---------------------------------------------------------------------------
// fs mock — hoisted so it's available inside vi.mock factory
// ---------------------------------------------------------------------------

const fsMock = vi.hoisted(() => ({
  stat: vi.fn(),
  open: vi.fn(),
  readFile: vi.fn(),
  mkdir: vi.fn(),
  readdir: vi.fn(),
  lstat: vi.fn(),
  access: vi.fn(),
  rm: vi.fn(),
  rename: vi.fn(),
  cp: vi.fn(),
  chmod: vi.fn(),
  chown: vi.fn(),
  readlink: vi.fn(),
  writeFile: vi.fn(),
  realpath: vi.fn(),
}));

const streamsMock = vi.hoisted(() => ({
  createReadStream: vi.fn(),
  createWriteStream: vi.fn(),
}));

vi.mock('node:fs', () => ({
  promises: fsMock,
  constants: { R_OK: 4 },
  createReadStream: streamsMock.createReadStream,
  createWriteStream: streamsMock.createWriteStream,
}));

vi.mock('archiver', () => ({ default: vi.fn() }));

import { PassThrough, Readable } from 'node:stream';
import { FilesService } from '../files.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeService() {
  return new FilesService();
}

/** Build a fake file descriptor returned by fs.open() */
function makeFd(buf: Buffer) {
  return {
    read: vi.fn(async (target: Buffer, offset: number, length: number, _pos: number) => {
      buf.copy(target, offset, 0, length);
      return { bytesRead: Math.min(length, buf.length) };
    }),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

/** Build a fake stat object for a regular file */
function makeFileStat(size: number) {
  return { isFile: () => true, isDirectory: () => false, size, mode: 0o644, mtimeMs: 0, uid: 0, gid: 0 };
}

// ---------------------------------------------------------------------------
// resolvePath — path traversal / input validation (cases 1-5)
// ---------------------------------------------------------------------------

describe('FilesService.resolvePath', () => {
  let svc: FilesService;

  beforeEach(() => {
    svc = makeService();
  });

  // case 1 — pure relative path with leading ".."
  it('1: rejects pure relative path starting with ..', () => {
    expect(() => svc.resolvePath('../etc/passwd')).toThrow(BadRequestException);
  });

  // case 2 — absolute path that contains ".." mid-segment
  // path.resolve() natively folds ".." segments, so "/home/user/../../etc/passwd"
  // becomes "/etc/passwd" — a valid canonical absolute path.
  // resolvePath() returns it without throwing; write operations call assertWritable()
  // separately to enforce the deny-list on /etc.
  it('2: absolute path with .. mid-segment resolves to canonical path via resolve()', () => {
    const result = svc.resolvePath('/home/user/../../etc/passwd');
    expect(result).toBe('/etc/passwd');
  });

  // case 3 — null byte embedded in path
  it('3: rejects path with embedded null byte', () => {
    expect(() => svc.resolvePath('/tmp/file\0.txt')).toThrow(BadRequestException);
  });

  // case 4 — URL-encoded traversal sequence; service does NOT URL-decode inputs
  // "%2e%2e%2fpasswd" is not absolute, so it fails the isAbsolute() guard before
  // the traversal check is ever reached.
  it('4: rejects URL-encoded %2e%2e%2f path (not absolute, fails at isAbsolute guard)', () => {
    expect(() => svc.resolvePath('%2e%2e%2fpasswd')).toThrow(BadRequestException);
  });

  // case 5 — legitimate absolute path passes and returns canonical path
  it('5: accepts valid absolute path and returns resolved string', () => {
    const result = svc.resolvePath('/tmp/foo.txt');
    expect(result).toBe('/tmp/foo.txt');
    expect(typeof result).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// readText — binary detection (cases 6-7)
// ---------------------------------------------------------------------------

describe('FilesService.readText', () => {
  let svc: FilesService;

  beforeEach(() => {
    svc = makeService();
    vi.clearAllMocks();
    // Default: realpath passes through the input unchanged (non-symlink normal file)
    fsMock.realpath.mockImplementation((p: string) => Promise.resolve(p));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // case 6 — valid UTF-8 text file containing emoji
  it('6: reads UTF-8 text file with emoji successfully', async () => {
    const content = 'Hello 🦕 world\nline two\n';
    const buf = Buffer.from(content, 'utf-8');
    const stat = makeFileStat(buf.length);

    fsMock.stat.mockResolvedValue(stat);
    fsMock.open.mockResolvedValue(makeFd(buf));
    fsMock.readFile.mockResolvedValue(content);

    const result = await svc.readText('/tmp/emoji.txt');
    expect(result.content).toBe(content);
    expect(result.size).toBe(buf.length);
  });

  // case 7 — binary file containing null bytes → throws BadRequestException with code FILE_BINARY
  it('7: rejects binary file containing null bytes', async () => {
    // Simulate a binary buffer that contains null bytes
    const buf = Buffer.alloc(512, 0); // all null bytes → definitely binary
    buf[0] = 0x89; // PNG magic byte
    buf[1] = 0x50;
    const stat = makeFileStat(buf.length);

    fsMock.stat.mockResolvedValue(stat);
    fsMock.open.mockResolvedValue(makeFd(buf));

    await expect(svc.readText('/tmp/image.png')).rejects.toThrow(BadRequestException);
    await expect(svc.readText('/tmp/image.png')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'FILE_BINARY' }),
    });
  });
});

// ---------------------------------------------------------------------------
// remove — dangerous system path protection (cases 8-10)
// ---------------------------------------------------------------------------

describe('FilesService.remove', () => {
  let svc: FilesService;

  beforeEach(() => {
    svc = makeService();
    vi.clearAllMocks();
    fsMock.rm.mockResolvedValue(undefined);
  });

  // case 8 — attempt to remove filesystem root
  it('8: refuses to delete /', async () => {
    await expect(svc.remove('/')).rejects.toThrow(ForbiddenException);
    expect(fsMock.rm).not.toHaveBeenCalled();
  });

  // case 9 — attempt to remove /etc
  it('9: refuses to delete /etc', async () => {
    await expect(svc.remove('/etc')).rejects.toThrow(ForbiddenException);
    expect(fsMock.rm).not.toHaveBeenCalled();
  });

  // case 10 — attempt to remove /usr (also covers /var and /root via the service blocklist)
  it('10: refuses to delete /usr', async () => {
    await expect(svc.remove('/usr')).rejects.toThrow(ForbiddenException);
    expect(fsMock.rm).not.toHaveBeenCalled();
  });

  it('10b: refuses to delete /var', async () => {
    await expect(svc.remove('/var')).rejects.toThrow(ForbiddenException);
    expect(fsMock.rm).not.toHaveBeenCalled();
  });

  it('10c: refuses to delete /root', async () => {
    await expect(svc.remove('/root')).rejects.toThrow(ForbiddenException);
    expect(fsMock.rm).not.toHaveBeenCalled();
  });

  // sanity — a normal non-critical path proceeds to fs.rm
  it('allows removal of a non-critical path', async () => {
    await svc.remove('/tmp/test-dir');
    expect(fsMock.rm).toHaveBeenCalledWith('/tmp/test-dir', { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// assertWritable — deny-list enforcement for write / mutate operations (cases A1-A8)
// ---------------------------------------------------------------------------

describe('FilesService.assertWritable', () => {
  let svc: FilesService;

  beforeEach(() => {
    svc = makeService();
    vi.clearAllMocks();
    fsMock.mkdir.mockResolvedValue(undefined);
    fsMock.writeFile.mockResolvedValue(undefined);
    fsMock.rename.mockResolvedValue(undefined);
    fsMock.cp.mockResolvedValue(undefined);
    fsMock.chmod.mockResolvedValue(undefined);
    fsMock.chown.mockResolvedValue(undefined);
  });

  // case A1 — write to /etc/passwd must be denied
  it('A1: write() to /etc/passwd throws ForbiddenException', async () => {
    await expect(svc.write('/etc/passwd', 'root:x:0:0:...')).rejects.toThrow(ForbiddenException);
    expect(fsMock.writeFile).not.toHaveBeenCalled();
  });

  // case A2 — write to /var/log/messages must be denied
  it('A2: write() to /var/log/messages throws ForbiddenException', async () => {
    await expect(svc.write('/var/log/messages', '')).rejects.toThrow(ForbiddenException);
    expect(fsMock.writeFile).not.toHaveBeenCalled();
  });

  // case A3 — remove /boot must be denied
  it('A3: remove() /boot throws ForbiddenException', async () => {
    await expect(svc.remove('/boot')).rejects.toThrow(ForbiddenException);
    expect(fsMock.rm).not.toHaveBeenCalled();
  });

  // case A4 — read (resolvePath only) of /etc/hosts must be allowed
  // resolvePath has no deny-list; that belongs to assertWritable
  it('A4: resolvePath() /etc/hosts returns canonical path without throwing', () => {
    expect(() => svc.resolvePath('/etc/hosts')).not.toThrow();
    expect(svc.resolvePath('/etc/hosts')).toBe('/etc/hosts');
  });

  // case A5 — rename where destination triggers assertWritable
  it('A5: rename() with destination inside /etc throws ForbiddenException', async () => {
    await expect(svc.rename('/tmp/foo', '/etc/foo')).rejects.toThrow(ForbiddenException);
    expect(fsMock.rename).not.toHaveBeenCalled();
  });

  // case A6 — write to a descendant of /usr/bin must be denied
  it('A6: write() to /usr/bin/malicious throws ForbiddenException', async () => {
    await expect(svc.write('/usr/bin/malicious', '#!/bin/sh\nrm -rf /')).rejects.toThrow(ForbiddenException);
    expect(fsMock.writeFile).not.toHaveBeenCalled();
  });

  // case A7 — chmod on /sys/kernel path must be denied
  it('A7: chmod() on /sys/kernel/debug throws ForbiddenException', async () => {
    await expect(svc.chmod('/sys/kernel/debug', 0o777)).rejects.toThrow(ForbiddenException);
    expect(fsMock.chmod).not.toHaveBeenCalled();
  });

  // case A8 — write to a safe path (/home/admin/...) must proceed normally
  it('A8: write() to /home/admin/notes.txt succeeds (not in deny-list)', async () => {
    await svc.write('/home/admin/notes.txt', 'hello');
    expect(fsMock.writeFile).toHaveBeenCalledWith('/home/admin/notes.txt', 'hello', 'utf-8');
  });
});

// ---------------------------------------------------------------------------
// saveUpload — v0.5.2-files-upload-write-guard regression suite (cases U1-U3)
// ---------------------------------------------------------------------------

describe('FilesService.saveUpload', () => {
  let svc: FilesService;

  beforeEach(() => {
    svc = makeService();
    vi.clearAllMocks();
    fsMock.mkdir.mockResolvedValue(undefined);
  });

  // case U1 — direct write into a deny-listed prefix is rejected with
  // ForbiddenException before any fs side-effect runs.
  it('U1: saveUpload targeting /etc/ssh throws ForbiddenException; no mkdir / no sink open', async () => {
    const stream = Readable.from(['authorized_keys content']);
    await expect(
      svc.saveUpload('/etc/ssh', 'authorized_keys', stream),
    ).rejects.toThrow(ForbiddenException);
    expect(fsMock.mkdir).not.toHaveBeenCalled();
    expect(streamsMock.createWriteStream).not.toHaveBeenCalled();
  });

  // case U2 — absolute path with ".." segments that resolves back into
  // a deny-listed prefix is canonicalised by resolvePath, then caught
  // by assertWritable. (Bare-relative input like '../../etc/ssh' is
  // rejected one step earlier at resolvePath; this test covers the
  // exploit-relevant absolute-with-traversal vector.)
  it('U2: saveUpload with ../traversal resolving to /etc throws ForbiddenException', async () => {
    const stream = Readable.from(['x']);
    await expect(
      svc.saveUpload('/home/user/../../../etc/ssh', 'authorized_keys', stream),
    ).rejects.toThrow(ForbiddenException);
    expect(fsMock.mkdir).not.toHaveBeenCalled();
    expect(streamsMock.createWriteStream).not.toHaveBeenCalled();
  });

  // case U3 — happy-path regression: uploads to a non-deny-listed
  // directory still proceed and return the resolved absolute path.
  it('U3: saveUpload to /home/admin/uploads writes file and returns resolved path', async () => {
    streamsMock.createWriteStream.mockImplementation(() => new PassThrough());
    const result = await svc.saveUpload(
      '/home/admin/uploads',
      'note.txt',
      Readable.from(['payload']),
    );
    expect(result).toBe('/home/admin/uploads/note.txt');
    expect(fsMock.mkdir).toHaveBeenCalledWith('/home/admin/uploads', { recursive: true });
    expect(streamsMock.createWriteStream).toHaveBeenCalledWith('/home/admin/uploads/note.txt');
  });
});

// ---------------------------------------------------------------------------
// fs errno → HttpException mapping (cases E1-E7)
// ---------------------------------------------------------------------------

function makeErrno(code: string): NodeJS.ErrnoException {
  const err = new Error(code) as NodeJS.ErrnoException;
  err.code = code;
  return err;
}

describe('fs errno mapping via mapFsError', () => {
  let svc: FilesService;

  beforeEach(() => {
    svc = makeService();
    vi.clearAllMocks();
    // common default mocks — individual cases override as needed
    fsMock.stat.mockResolvedValue({ isDirectory: () => true, isFile: () => false });
    fsMock.mkdir.mockResolvedValue(undefined);
    fsMock.writeFile.mockResolvedValue(undefined);
    fsMock.rename.mockResolvedValue(undefined);
    fsMock.chmod.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // E1 — list() fs.readdir EACCES → ForbiddenException(FILE_PERMISSION_DENIED)
  it('E1: list() readdir EACCES → ForbiddenException FILE_PERMISSION_DENIED', async () => {
    fsMock.readdir.mockRejectedValue(makeErrno('EACCES'));
    await expect(svc.list('/tmp/restricted', false)).rejects.toThrow(ForbiddenException);
    await expect(svc.list('/tmp/restricted', false)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'FILE_PERMISSION_DENIED' }),
    });
  });

  // E2 — list() fs.readdir EPERM → same ForbiddenException path
  it('E2: list() readdir EPERM → ForbiddenException FILE_PERMISSION_DENIED', async () => {
    fsMock.readdir.mockRejectedValue(makeErrno('EPERM'));
    await expect(svc.list('/tmp/restricted', false)).rejects.toThrow(ForbiddenException);
    await expect(svc.list('/tmp/restricted', false)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'FILE_PERMISSION_DENIED' }),
    });
  });

  // E3 — write() fs.writeFile ENOSPC → PayloadTooLargeException(FILE_NO_SPACE)
  it('E3: write() writeFile ENOSPC → PayloadTooLargeException FILE_NO_SPACE', async () => {
    fsMock.writeFile.mockRejectedValue(makeErrno('ENOSPC'));
    await expect(svc.write('/home/user/big.txt', 'data')).rejects.toThrow(PayloadTooLargeException);
    await expect(svc.write('/home/user/big.txt', 'data')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'FILE_NO_SPACE' }),
    });
  });

  // E4 — write() fs.writeFile EACCES → ForbiddenException(FILE_PERMISSION_DENIED)
  it('E4: write() writeFile EACCES → ForbiddenException FILE_PERMISSION_DENIED', async () => {
    fsMock.writeFile.mockRejectedValue(makeErrno('EACCES'));
    await expect(svc.write('/home/user/locked.txt', 'data')).rejects.toThrow(ForbiddenException);
    await expect(svc.write('/home/user/locked.txt', 'data')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'FILE_PERMISSION_DENIED' }),
    });
  });

  // E5 — mkdir() fs.mkdir EEXIST → ConflictException(FILE_ALREADY_EXISTS)
  it('E5: mkdir() mkdir EEXIST → ConflictException FILE_ALREADY_EXISTS', async () => {
    fsMock.mkdir.mockRejectedValue(makeErrno('EEXIST'));
    await expect(svc.mkdir('/home/user/newdir', false)).rejects.toThrow(ConflictException);
    await expect(svc.mkdir('/home/user/newdir', false)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'FILE_ALREADY_EXISTS' }),
    });
  });

  // E6 — rename() fs.rename ENOTDIR → BadRequestException(FILE_NOT_A_DIRECTORY)
  it('E6: rename() rename ENOTDIR → BadRequestException FILE_NOT_A_DIRECTORY', async () => {
    fsMock.rename.mockRejectedValue(makeErrno('ENOTDIR'));
    await expect(svc.rename('/home/user/a.txt', '/home/user/b.txt')).rejects.toThrow(BadRequestException);
    await expect(svc.rename('/home/user/a.txt', '/home/user/b.txt')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'FILE_NOT_A_DIRECTORY' }),
    });
  });

  // E7 — chmod() fs.chmod unknown errno EIO → original error rethrown (not an HttpException)
  it('E7: chmod() chmod EIO (unknown) → original Error rethrown', async () => {
    const eio = makeErrno('EIO');
    fsMock.chmod.mockRejectedValue(eio);
    await expect(svc.chmod('/home/user/file.txt', 0o644)).rejects.toBe(eio);
  });

  // E8 — list() preserves existing NotFoundException when fs.stat fails (regression guard)
  it('E8: list() stat failure → NotFoundException FILE_NOT_FOUND (existing behaviour)', async () => {
    fsMock.stat.mockRejectedValue(makeErrno('ENOENT'));
    await expect(svc.list('/tmp/missing', false)).rejects.toThrow(NotFoundException);
    await expect(svc.list('/tmp/missing', false)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'FILE_NOT_FOUND' }),
    });
  });
});

// ---------------------------------------------------------------------------
// FilesService.read-side symlink protection (cases R1-R7)
// ---------------------------------------------------------------------------

describe('FilesService.read-side symlink protection', () => {
  let svc: FilesService;

  beforeEach(() => {
    svc = makeService();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // R1 — symlink in tmpdir resolving to /etc/shadow: readText must reject
  it('R1: readText() via symlink to /etc/shadow rejects with FILE_FORBIDDEN_READ', async () => {
    fsMock.realpath.mockResolvedValue('/etc/shadow');
    await expect(svc.readText('/tmp/uploads/shadow')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'FILE_FORBIDDEN_READ' }),
    });
  });

  // R2 — symlink resolving to /etc/ssh/ssh_host_rsa_key: createDownloadStream must reject
  it('R2: createDownloadStream() via symlink to /etc/ssh/ssh_host_rsa_key rejects with FILE_FORBIDDEN_READ', async () => {
    fsMock.realpath.mockResolvedValue('/etc/ssh/ssh_host_rsa_key');
    await expect(svc.createDownloadStream('/tmp/uploads/sshkey')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'FILE_FORBIDDEN_READ' }),
    });
  });

  // R3 — legitimate read of a regular file under /home/user: must succeed
  it('R3: readText() on a normal /home/user/note.txt succeeds', async () => {
    const content = 'hello world';
    const buf = Buffer.from(content, 'utf-8');
    fsMock.realpath.mockResolvedValue('/home/user/note.txt');
    fsMock.stat.mockResolvedValue(makeFileStat(buf.length));
    fsMock.open.mockResolvedValue(makeFd(buf));
    fsMock.readFile.mockResolvedValue(content);

    const result = await svc.readText('/home/user/note.txt');
    expect(result.content).toBe(content);
  });

  // R4 — chained symlink /tmp/a → /tmp/b → /etc/shadow: realpath returns the final target
  it('R4: readText() via nested symlink chain to /etc/shadow rejects with FILE_FORBIDDEN_READ', async () => {
    fsMock.realpath.mockResolvedValue('/etc/shadow');
    await expect(svc.readText('/tmp/a')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'FILE_FORBIDDEN_READ' }),
    });
  });

  // R5 — broken symlink: realpath rejects with ENOENT → must surface as FILE_NOT_FOUND, not a security error
  it('R5: broken symlink causes readText() to throw NotFoundException FILE_NOT_FOUND', async () => {
    fsMock.realpath.mockRejectedValue(makeErrno('ENOENT'));
    await expect(svc.readText('/tmp/broken-link')).rejects.toThrow(NotFoundException);
    await expect(svc.readText('/tmp/broken-link')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'FILE_NOT_FOUND' }),
    });
  });

  // R6 — FIFO / non-regular file via download: stat.isFile() returns false → FILE_NOT_REGULAR_FILE
  it('R6: createDownloadStream() on a FIFO rejects with FILE_NOT_REGULAR_FILE', async () => {
    fsMock.realpath.mockResolvedValue('/home/user/mypipe');
    fsMock.stat.mockResolvedValue({ isFile: () => false, isDirectory: () => false, size: 0 });
    await expect(svc.createDownloadStream('/home/user/mypipe')).rejects.toThrow(BadRequestException);
    await expect(svc.createDownloadStream('/home/user/mypipe')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'FILE_NOT_REGULAR_FILE' }),
    });
  });

  // R7 — regression guard: a read on a safe path under /home/user is not blocked.
  // Tested indirectly through readText (which calls assertReadable internally)
  // so we exercise the full helper chain rather than a private-method cast.
  it('R7: readText() on a safe path under /home/user is not blocked by the deny-list', async () => {
    const content = 'safe contents';
    const buf = Buffer.from(content, 'utf-8');
    fsMock.realpath.mockResolvedValue('/home/user/notes.txt');
    fsMock.stat.mockResolvedValue(makeFileStat(buf.length));
    fsMock.open.mockResolvedValue(makeFd(buf));
    fsMock.readFile.mockResolvedValue(content);

    const result = await svc.readText('/home/user/notes.txt');
    expect(result.content).toBe(content);
  });

  // R8 — archive download path is a parallel read path; symlink-to-shadow must
  // be rejected before the archive engine reads file content.
  it('R8: createArchiveStream() rejects when any source resolves into the deny-list', async () => {
    fsMock.realpath.mockImplementation((p: string) =>
      p === '/tmp/uploads/shadow-link' ? Promise.resolve('/etc/shadow') : Promise.resolve(p),
    );
    await expect(
      svc.createArchiveStream(['/home/user/safe.txt', '/tmp/uploads/shadow-link'], 'zip'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'FILE_FORBIDDEN_READ' }),
    });
  });

  // R9 — compressToDisk source paths are reads too: a symlink to /etc/shadow
  // in the source list cannot smuggle the file into an on-disk archive.
  it('R9: compressToDisk() rejects when any source resolves into the deny-list', async () => {
    fsMock.realpath.mockImplementation((p: string) =>
      p === '/tmp/uploads/shadow-link' ? Promise.resolve('/etc/shadow') : Promise.resolve(p),
    );
    await expect(
      svc.compressToDisk(
        ['/home/user/safe.txt', '/tmp/uploads/shadow-link'],
        '/tmp/out.zip',
        'zip',
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'FILE_FORBIDDEN_READ' }),
    });
  });
});
