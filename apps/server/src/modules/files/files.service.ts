import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { promises as fs, constants as fsConst, createReadStream, createWriteStream } from 'node:fs';
import { basename, dirname, isAbsolute, resolve, sep as pathSep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import archiver from 'archiver';
import * as tar from 'tar';
import unzipper from 'unzipper';
import type { FileEntry } from '@dinopanel/shared';

function classifyArchive(path: string): 'zip' | 'tar.gz' | 'tar' | null {
  const lower = path.toLowerCase();
  if (lower.endsWith('.zip')) return 'zip';
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return 'tar.gz';
  if (lower.endsWith('.tar')) return 'tar';
  return null;
}

const MAX_READ_BYTES = 5 * 1024 * 1024;

/**
 * Map a Node.js fs errno to an appropriate NestJS HttpException.
 * Unknown errnos are re-thrown as-is so ApiExceptionFilter catches them as 500.
 */
function mapFsError(err: unknown, op: string): never {
  const e = err as NodeJS.ErrnoException;
  switch (e?.code) {
    case 'EACCES':
    case 'EPERM':
      throw new ForbiddenException({
        code: 'FILE_PERMISSION_DENIED',
        message: `Permission denied: ${op}`,
      });
    case 'ENOENT':
      throw new NotFoundException({
        code: 'FILE_NOT_FOUND',
        message: `Not found: ${op}`,
      });
    case 'ENOTDIR':
      throw new BadRequestException({
        code: 'FILE_NOT_A_DIRECTORY',
        message: op,
      });
    case 'EISDIR':
      throw new BadRequestException({
        code: 'FILE_IS_A_DIRECTORY',
        message: op,
      });
    case 'ELOOP':
      throw new BadRequestException({
        code: 'FILE_SYMLINK_LOOP',
        message: op,
      });
    case 'ENOSPC':
      throw new PayloadTooLargeException({
        code: 'FILE_NO_SPACE',
        message: 'Disk full',
      });
    case 'EEXIST':
      throw new ConflictException({
        code: 'FILE_ALREADY_EXISTS',
        message: op,
      });
    case 'EBUSY':
      throw new ConflictException({
        code: 'FILE_BUSY',
        message: op,
      });
  }
  throw err;
}

/**
 * Paths that must never be written to, deleted, chmod'd, chown'd, or overwritten.
 * Each entry is matched as an exact path OR as a prefix followed by '/'.
 *
 * Rationale:
 *   /            — filesystem root; deleting would nuke the OS
 *   /bin         — essential system binaries
 *   /sbin        — root-only system binaries
 *   /usr         — OS packages; includes /usr/bin, /usr/sbin, /usr/lib
 *   /etc         — system configuration; shadow, sudoers, sshd_config, etc.
 *   /var/log     — audit trail; modification is suspicious / destructive
 *   /var/lib     — package DB and service state; e.g. dpkg, rpm, docker layers
 *   /root        — root home directory; contains .ssh, .bashrc, credentials
 *   /root/.ssh   — root SSH keys; overwrite = full remote-access takeover
 *   /var         — service state, logs, packages; mass-delete is catastrophic
 *   /proc        — kernel process pseudo-fs; writes are dangerous / undefined
 *   /sys         — kernel device pseudo-fs; idem
 *   /boot        — kernel + bootloader; overwrite = unbootable system
 *   /dev         — device nodes; writes can corrupt raw devices
 */
const DANGEROUS_WRITE_PATHS: readonly string[] = [
  '/',
  '/bin',
  '/sbin',
  '/usr',
  '/etc',
  '/root',
  '/var',
  '/proc',
  '/sys',
  '/boot',
  '/dev',
];

/**
 * Paths that must never be read, regardless of how the caller spelled the
 * request (including via symlinks — see resolveAndAssertReadable).
 *
 * This list is TIGHTER than DANGEROUS_WRITE_PATHS: /etc as a whole is NOT
 * blocked for reads (operators legitimately read nginx/php/systemd configs),
 * but specific high-value credential subtrees under /etc are blocked.
 *
 * Matched as an exact path OR as a prefix followed by '/'.
 *
 * Known limitation: the panel's own SQLite DB (DATA_DIR/dinopanel.db) is not
 * listed here because DATA_DIR is configurable and injecting it without a
 * config dependency would require hardcoding — deferred as a follow-up.
 */
const DANGEROUS_READ_PATHS: readonly string[] = [
  '/etc/shadow',
  '/etc/gshadow',
  '/etc/sudoers',
  '/etc/sudoers.d',
  '/etc/ssh',      // whole dir — sshd_config, ssh_host_*_key
  '/root',         // entire homedir (.ssh, .bash_history, .docker, ...)
  '/proc',         // entire tree — /proc/<pid>/environ, /proc/<pid>/mem, etc.
  '/sys',
  '/dev/mem',
  '/dev/kmem',
  '/dev/port',
];

/**
 * Path-handling invariants kept in sync with the v0.5.2 security fixes:
 *
 * Mutating methods (write, mkdir, rename, copyTo, remove, chmod, chown,
 * saveUpload) MUST call `assertWritable(p)` immediately after
 * `resolvePath(input)` on the resolved target. rename/copyTo guard the
 * destination (and rename also guards the source since it's unlinked);
 * saveUpload guards the directory.
 *
 * Read methods that return or stream file CONTENT MUST call
 * `resolveAndAssertReadable(input)` instead of `resolvePath(input)`
 * directly. Currently:
 *   readText / createDownloadStream / createArchiveStream / compressToDisk
 *   sources — all use resolveAndAssertReadable.
 *   list — exempt: returns metadata only (via lstat); symlinks appear in
 *   listings but cannot be traversed through for content.
 *
 * If you add a new method that writes, extend the mutating list above.
 * If you add a new method that reads file content, extend the read list.
 */
@Injectable()
export class FilesService {
  /**
   * Resolve a user-supplied path and reject null-byte / relative inputs.
   * Uses path.resolve() to canonicalise — this natively folds any ".." segments,
   * so a separate segment-scan is unnecessary and would be bypassed by normalize()
   * on absolute paths anyway (the classic path-traversal bypass).
   *
   * Read operations call only this method; write/mutate operations additionally
   * call assertWritable() for deny-list enforcement.
   */
  resolvePath(input: string): string {
    if (typeof input !== 'string' || input.length === 0) {
      throw new BadRequestException({ code: 'FILE_FORBIDDEN_PATH', message: 'Empty path' });
    }
    if (input.includes('\0')) {
      throw new BadRequestException({ code: 'FILE_FORBIDDEN_PATH', message: 'Null byte in path' });
    }
    if (!isAbsolute(input)) {
      throw new BadRequestException({ code: 'FILE_FORBIDDEN_PATH', message: 'Path must be absolute' });
    }
    // resolve() natively collapses ".." and "." segments and returns an absolute
    // canonical path — no need to scan for remaining ".." after the fact.
    return resolve(input);
  }

  /**
   * Guard for mutating operations (write, mkdir, rename, copy-dest, remove,
   * chmod, chown).  Throws ForbiddenException if the resolved path equals or
   * is a descendant of any entry in DANGEROUS_WRITE_PATHS.
   */
  assertWritable(resolvedPath: string): void {
    for (const prefix of DANGEROUS_WRITE_PATHS) {
      if (resolvedPath === prefix || resolvedPath.startsWith(prefix + '/')) {
        throw new ForbiddenException({
          code: 'FILE_FORBIDDEN_PATH',
          message: 'Refusing to modify critical system path',
        });
      }
    }
  }

  /**
   * Guard for read operations. Throws ForbiddenException if the already-resolved
   * (real) path equals or is a descendant of any entry in DANGEROUS_READ_PATHS.
   * Must be called with the output of fs.realpath, not the raw user input.
   */
  private assertReadable(realPath: string): void {
    for (const prefix of DANGEROUS_READ_PATHS) {
      if (realPath === prefix || realPath.startsWith(prefix + '/')) {
        throw new ForbiddenException({
          code: 'FILE_FORBIDDEN_READ',
          message: 'Refusing to read sensitive system path',
        });
      }
    }
  }

  /**
   * Security-critical read helper: resolves the user-supplied path to its
   * canonical real path (following all symlink hops), then asserts the target
   * is not in the read deny-list before returning it.
   *
   * This is the only safe entry-point for read operations because it prevents
   * the symlink-to-sensitive-file exploit: a user can create a symlink in any
   * writable directory pointing at /etc/shadow; without realpath resolution the
   * deny-list check would never see the true target.
   *
   * On ENOENT (broken symlink or missing file) the error is forwarded through
   * mapFsError so callers see the standard FILE_NOT_FOUND / 404.
   */
  private async resolveAndAssertReadable(input: string): Promise<string> {
    const resolved = this.resolvePath(input);
    const real = await fs.realpath(resolved).catch((err): never => mapFsError(err, resolved));
    this.assertReadable(real);
    return real;
  }

  async list(rawPath: string, showHidden: boolean): Promise<{ path: string; entries: FileEntry[] }> {
    const path = this.resolvePath(rawPath);
    let stat;
    try {
      stat = await fs.stat(path);
    } catch {
      throw new NotFoundException({ code: 'FILE_NOT_FOUND', message: path });
    }
    if (!stat.isDirectory()) {
      throw new BadRequestException({ code: 'FILE_OPERATION_FAILED', message: 'Not a directory' });
    }
    const dirents = await fs.readdir(path, { withFileTypes: true }).catch((err) => mapFsError(err, path));
    const entries: FileEntry[] = [];
    for (const d of dirents) {
      if (!showHidden && d.name.startsWith('.')) continue;
      const full = resolve(path, d.name);
      try {
        const st = await fs.lstat(full);
        let linkTarget: string | undefined;
        if (d.isSymbolicLink()) {
          try {
            linkTarget = await fs.readlink(full);
          } catch {
            // ignore
          }
        }
        entries.push({
          name: d.name,
          path: full,
          type: d.isDirectory()
            ? 'directory'
            : d.isFile()
              ? 'file'
              : d.isSymbolicLink()
                ? 'symlink'
                : 'other',
          size: st.size,
          mode: st.mode & 0o7777,
          mtime: st.mtimeMs,
          uid: st.uid,
          gid: st.gid,
          isHidden: d.name.startsWith('.'),
          linkTarget,
        });
      } catch {
        // skip entries we can't stat (e.g. permission denied on broken symlinks)
      }
    }
    entries.sort((a, b) => {
      if (a.type === 'directory' && b.type !== 'directory') return -1;
      if (a.type !== 'directory' && b.type === 'directory') return 1;
      return a.name.localeCompare(b.name);
    });
    return { path, entries };
  }

  async readText(rawPath: string): Promise<{ content: string; size: number }> {
    const path = await this.resolveAndAssertReadable(rawPath);
    const stat = await fs.stat(path).catch(() => null);
    if (!stat) throw new NotFoundException({ code: 'FILE_NOT_FOUND', message: path });
    if (!stat.isFile()) {
      throw new BadRequestException({ code: 'FILE_OPERATION_FAILED', message: 'Not a regular file' });
    }
    if (stat.size > MAX_READ_BYTES) {
      throw new PayloadTooLargeException({
        code: 'FILE_TOO_LARGE',
        message: `File exceeds ${MAX_READ_BYTES} bytes`,
      });
    }

    // simple binary detection: read first 4KB
    const fd = await fs.open(path, 'r').catch((err) => {
      mapFsError(err, path);
    });
    try {
      const buf = Buffer.alloc(Math.min(4096, stat.size));
      await fd!.read(buf, 0, buf.length, 0);
      if (buf.includes(0)) {
        throw new BadRequestException({
          code: 'FILE_BINARY',
          message: 'File appears to be binary',
        });
      }
    } finally {
      await fd!.close();
    }

    const content = await fs.readFile(path, 'utf-8').catch((err) => {
      mapFsError(err, path);
    });
    return { content: content!, size: stat.size };
  }

  async write(rawPath: string, content: string): Promise<void> {
    const path = this.resolvePath(rawPath);
    this.assertWritable(path);
    await fs.mkdir(dirname(path), { recursive: true }).catch((err) => mapFsError(err, path));
    await fs.writeFile(path, content, 'utf-8').catch((err) => mapFsError(err, path));
  }

  async mkdir(rawPath: string, recursive: boolean): Promise<void> {
    const path = this.resolvePath(rawPath);
    this.assertWritable(path);
    await fs.mkdir(path, { recursive }).catch((err) => mapFsError(err, path));
  }

  async rename(from: string, to: string): Promise<void> {
    const fromPath = this.resolvePath(from);
    const toPath = this.resolvePath(to);
    this.assertWritable(fromPath);
    this.assertWritable(toPath);
    await fs.rename(fromPath, toPath).catch((err) => mapFsError(err, fromPath));
  }

  async copy(from: string, to: string): Promise<void> {
    const fromPath = this.resolvePath(from);
    const toPath = this.resolvePath(to);
    // destination is guarded; source is read-only so no assertWritable needed
    this.assertWritable(toPath);
    await fs.cp(fromPath, toPath, { recursive: true, errorOnExist: false }).catch((err) => mapFsError(err, fromPath));
  }

  async remove(rawPath: string): Promise<void> {
    const path = this.resolvePath(rawPath);
    this.assertWritable(path);
    await fs.rm(path, { recursive: true, force: true }).catch((err) => mapFsError(err, path));
  }

  async chmod(rawPath: string, mode: number): Promise<void> {
    const path = this.resolvePath(rawPath);
    this.assertWritable(path);
    await fs.chmod(path, mode).catch((err) => mapFsError(err, path));
  }

  async chown(rawPath: string, uid: number, gid: number): Promise<void> {
    const path = this.resolvePath(rawPath);
    this.assertWritable(path);
    await fs.chown(path, uid, gid).catch((err) => mapFsError(err, path));
  }

  async accessible(rawPath: string): Promise<boolean> {
    try {
      await fs.access(this.resolvePath(rawPath), fsConst.R_OK);
      return true;
    } catch {
      return false;
    }
  }

  async saveUpload(targetDir: string, filename: string, source: NodeJS.ReadableStream): Promise<string> {
    const dir = this.resolvePath(targetDir);
    // v0.5.2-files-upload-write-guard: saveUpload was the one mutating
    // method that missed the deny-list check, letting any authenticated
    // panel user upload into /etc/ssh, /root/.ssh, etc. Reject before
    // fs.mkdir so no empty directory is created on rejection (D2).
    this.assertWritable(dir);
    const safeName = basename(filename).replace(/\0/g, '');
    if (!safeName || safeName === '.' || safeName === '..') {
      throw new BadRequestException({ code: 'FILE_FORBIDDEN_PATH', message: 'Invalid filename' });
    }
    await fs.mkdir(dir, { recursive: true }).catch((err) => mapFsError(err, dir));
    const fullPath = resolve(dir, safeName);
    const sink = createWriteStream(fullPath);
    await pipeline(source as Readable, sink).catch((err) => mapFsError(err, fullPath));
    return fullPath;
  }

  async createDownloadStream(rawPath: string): Promise<{ stream: NodeJS.ReadableStream; size: number; filename: string }> {
    const path = await this.resolveAndAssertReadable(rawPath);
    const stat = await fs.stat(path).catch((err) => mapFsError(err, path));
    if (!stat.isFile()) {
      throw new BadRequestException({
        code: 'FILE_NOT_REGULAR_FILE',
        message: 'Not a regular file',
      });
    }
    // TOCTOU window: between resolveAndAssertReadable's realpath check and
    // the createReadStream call, a concurrent writer could rename the
    // target into a symlink to a sensitive path. Accepted per
    // decisions.md D6 — the panel's threat model is authenticated operator,
    // not multi-tenant root-equal; closing this with O_NOFOLLOW would
    // require dropping the Node createReadStream abstraction.
    return {
      stream: createReadStream(path),
      size: stat.size,
      filename: basename(path),
    };
  }

  async createArchiveStream(
    paths: string[],
    format: 'zip' | 'tar.gz',
  ): Promise<{ stream: NodeJS.ReadableStream; filename: string }> {
    // Each source path is a read; route through resolveAndAssertReadable
    // so the archive endpoint cannot ship sensitive system files through
    // a user-created symlink (parity with createDownloadStream).
    const resolved = await Promise.all(paths.map((p) => this.resolveAndAssertReadable(p)));
    const archive =
      format === 'zip'
        ? archiver('zip', { zlib: { level: 6 } })
        : archiver('tar', { gzip: true, gzipOptions: { level: 6 } });

    for (const path of resolved) {
      const stat = await fs.stat(path).catch((err) => mapFsError(err, path));
      const name = basename(path);
      if (stat.isDirectory()) {
        archive.directory(path, name);
      } else {
        archive.file(path, { name });
      }
    }
    archive.finalize().catch(() => undefined);
    return { stream: archive, filename: `archive.${format === 'zip' ? 'zip' : 'tar.gz'}` };
  }

  /**
   * Build an archive at `dest` from a list of source paths. Files and
   * directories are added at the top level of the archive keyed by their
   * basename — same convention as createArchiveStream so the download
   * and the on-disk archive behave identically.
   */
  async compressToDisk(
    paths: string[],
    rawDest: string,
    format: 'zip' | 'tar.gz',
  ): Promise<void> {
    if (paths.length === 0) {
      throw new BadRequestException({
        code: 'FILE_OPERATION_FAILED',
        message: 'paths must contain at least one entry',
      });
    }

    // Source paths are reads — route through the symlink-safe helper so
    // a malicious symlink in the source list cannot smuggle /etc/shadow
    // into an on-disk archive that the operator can then download.
    const resolvedSources = await Promise.all(
      paths.map((p) => this.resolveAndAssertReadable(p)),
    );
    const destPath = this.resolvePath(rawDest);
    this.assertWritable(destPath);

    await fs.mkdir(dirname(destPath), { recursive: true }).catch((err) => mapFsError(err, destPath));

    const archive =
      format === 'zip'
        ? archiver('zip', { zlib: { level: 6 } })
        : archiver('tar', { gzip: true, gzipOptions: { level: 6 } });
    const sink = createWriteStream(destPath);

    for (const path of resolvedSources) {
      const stat = await fs.stat(path).catch((err) => mapFsError(err, path));
      const name = basename(path);
      if (stat.isDirectory()) {
        archive.directory(path, name);
      } else {
        archive.file(path, { name });
      }
    }

    const pipelinePromise = pipeline(archive as unknown as NodeJS.ReadableStream, sink).catch(
      (err) => mapFsError(err, destPath),
    );
    await archive.finalize();
    await pipelinePromise;
  }

  /**
   * Extract an archive into `dest`. Format is decided by the archive
   * filename extension. `.zip` is iterated explicitly so we can reject
   * entries whose resolved destination escapes `dest` (zip-slip);
   * `.tar` / `.tar.gz` / `.tgz` go through the `tar` package with
   * `strict: true`, which already rejects suspicious entries.
   */
  async extract(rawArchive: string, rawDest: string): Promise<void> {
    const archivePath = this.resolvePath(rawArchive);
    const destPath = this.resolvePath(rawDest);
    this.assertWritable(destPath);

    const archiveStat = await fs.stat(archivePath).catch((err) => mapFsError(err, archivePath));
    if (!archiveStat.isFile()) {
      throw new BadRequestException({
        code: 'FILE_OPERATION_FAILED',
        message: 'Archive must be a regular file',
      });
    }

    const kind = classifyArchive(archivePath);
    if (kind === null) {
      throw new BadRequestException({
        code: 'FILE_UNSUPPORTED_ARCHIVE',
        message: 'Supported archive extensions: .zip, .tar, .tar.gz, .tgz',
      });
    }

    await fs.mkdir(destPath, { recursive: true }).catch((err) => mapFsError(err, destPath));

    if (kind === 'zip') {
      await this.extractZipWithSlipGuard(archivePath, destPath);
    } else {
      // kind === 'tar' or 'tar.gz' — `tar` autodetects gzip when given `.tar.gz`.
      await tar
        .x({ file: archivePath, cwd: destPath, strict: true })
        .catch((err) => mapFsError(err, archivePath));
    }
  }

  /**
   * Stream a zip, validating every entry's resolved path before writing.
   * Any entry that does not equal `dest` and does not start with
   * `dest + path.sep` is treated as a zip-slip attempt and aborts the
   * extraction.
   */
  private async extractZipWithSlipGuard(archivePath: string, destPath: string): Promise<void> {
    const directory = await unzipper.Open.file(archivePath);
    const destPrefix = destPath.endsWith(pathSep) ? destPath : destPath + pathSep;

    // Pre-validate every entry path before touching the filesystem.
    for (const entry of directory.files) {
      const entryDest = resolve(destPath, entry.path);
      if (entryDest !== destPath && !entryDest.startsWith(destPrefix)) {
        throw new BadRequestException({
          code: 'FILE_ARCHIVE_TRAVERSAL',
          message: `Refusing to extract: entry '${entry.path}' escapes destination`,
        });
      }
    }

    for (const entry of directory.files) {
      const entryDest = resolve(destPath, entry.path);
      if (entry.type === 'Directory') {
        await fs.mkdir(entryDest, { recursive: true }).catch((err) => mapFsError(err, entryDest));
        continue;
      }
      await fs.mkdir(dirname(entryDest), { recursive: true }).catch((err) => mapFsError(err, entryDest));
      await pipeline(entry.stream(), createWriteStream(entryDest)).catch((err) =>
        mapFsError(err, entryDest),
      );
    }
  }
}
