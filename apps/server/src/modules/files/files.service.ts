import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { promises as fs, constants as fsConst, createReadStream, createWriteStream } from 'node:fs';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import archiver from 'archiver';
import type { FileEntry } from '@dinopanel/shared';

const MAX_READ_BYTES = 5 * 1024 * 1024;

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
    const dirents = await fs.readdir(path, { withFileTypes: true });
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
    const fd = await fs.open(path, 'r');
    try {
      const buf = Buffer.alloc(Math.min(4096, stat.size));
      await fd.read(buf, 0, buf.length, 0);
      if (buf.includes(0)) {
        throw new BadRequestException({
          code: 'FILE_BINARY',
          message: 'File appears to be binary',
        });
      }
    } finally {
      await fd.close();
    }

    const content = await fs.readFile(path, 'utf-8');
    return { content, size: stat.size };
  }

  async write(rawPath: string, content: string): Promise<void> {
    const path = this.resolvePath(rawPath);
    this.assertWritable(path);
    await fs.mkdir(dirname(path), { recursive: true });
    await fs.writeFile(path, content, 'utf-8');
  }

  async mkdir(rawPath: string, recursive: boolean): Promise<void> {
    const path = this.resolvePath(rawPath);
    this.assertWritable(path);
    await fs.mkdir(path, { recursive });
  }

  async rename(from: string, to: string): Promise<void> {
    const fromPath = this.resolvePath(from);
    const toPath = this.resolvePath(to);
    this.assertWritable(fromPath);
    this.assertWritable(toPath);
    await fs.rename(fromPath, toPath);
  }

  async copy(from: string, to: string): Promise<void> {
    const fromPath = this.resolvePath(from);
    const toPath = this.resolvePath(to);
    // destination is guarded; source is read-only so no assertWritable needed
    this.assertWritable(toPath);
    await fs.cp(fromPath, toPath, { recursive: true, errorOnExist: false });
  }

  async remove(rawPath: string): Promise<void> {
    const path = this.resolvePath(rawPath);
    this.assertWritable(path);
    await fs.rm(path, { recursive: true, force: true });
  }

  async chmod(rawPath: string, mode: number): Promise<void> {
    const path = this.resolvePath(rawPath);
    this.assertWritable(path);
    await fs.chmod(path, mode);
  }

  async chown(rawPath: string, uid: number, gid: number): Promise<void> {
    const path = this.resolvePath(rawPath);
    this.assertWritable(path);
    await fs.chown(path, uid, gid);
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
    const safeName = basename(filename).replace(/\0/g, '');
    if (!safeName || safeName === '.' || safeName === '..') {
      throw new BadRequestException({ code: 'FILE_FORBIDDEN_PATH', message: 'Invalid filename' });
    }
    await fs.mkdir(dir, { recursive: true });
    const fullPath = resolve(dir, safeName);
    const sink = createWriteStream(fullPath);
    await pipeline(source as Readable, sink);
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
      const stat = await fs.stat(path);
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
}
