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
 * Mutating-method invariant: every method that writes, creates, renames,
 * removes, or changes metadata on a path MUST call `assertWritable(p)`
 * immediately after `resolvePath(input)` on the resolved target. Read
 * operations call only `resolvePath()`.
 *
 * Audit (kept in sync with v0.5.2-files-upload-write-guard):
 *   write / mkdir / chmod / chown / remove  — assertWritable on target
 *   rename / copyTo                          — assertWritable on destination
 *                                              (and source for rename, since
 *                                              the source is unlinked)
 *   saveUpload                               — assertWritable on directory
 *
 * If you add a new mutating method, extend this list and call
 * `assertWritable()` on every path you will touch.
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
    const path = this.resolvePath(rawPath);
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

  createDownloadStream(rawPath: string): { stream: NodeJS.ReadableStream; size: number; filename: string } {
    const path = this.resolvePath(rawPath);
    return {
      stream: createReadStream(path),
      size: 0,
      filename: basename(path),
    };
  }

  async createArchiveStream(
    paths: string[],
    format: 'zip' | 'tar.gz',
  ): Promise<{ stream: NodeJS.ReadableStream; filename: string }> {
    const resolved = paths.map((p) => this.resolvePath(p));
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

    const resolvedSources = paths.map((p) => this.resolvePath(p));
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
