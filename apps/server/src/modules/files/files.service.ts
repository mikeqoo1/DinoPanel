import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { promises as fs, constants as fsConst, createReadStream, createWriteStream } from 'node:fs';
import { basename, dirname, isAbsolute, normalize, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import archiver from 'archiver';
import type { FileEntry } from '@dinopanel/shared';

const MAX_READ_BYTES = 5 * 1024 * 1024;

@Injectable()
export class FilesService {
  /**
   * Resolve a user-supplied path and reject traversal/null-byte/relative inputs.
   * Returns a canonical absolute path that callers may use against the filesystem.
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
    const norm = normalize(input);
    if (norm.split(sep).some((seg) => seg === '..')) {
      throw new BadRequestException({ code: 'FILE_FORBIDDEN_PATH', message: 'Path traversal not allowed' });
    }
    return resolve(norm);
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
    await fs.mkdir(dirname(path), { recursive: true });
    await fs.writeFile(path, content, 'utf-8');
  }

  async mkdir(rawPath: string, recursive: boolean): Promise<void> {
    const path = this.resolvePath(rawPath);
    await fs.mkdir(path, { recursive });
  }

  async rename(from: string, to: string): Promise<void> {
    const fromPath = this.resolvePath(from);
    const toPath = this.resolvePath(to);
    await fs.rename(fromPath, toPath);
  }

  async copy(from: string, to: string): Promise<void> {
    const fromPath = this.resolvePath(from);
    const toPath = this.resolvePath(to);
    await fs.cp(fromPath, toPath, { recursive: true, errorOnExist: false });
  }

  async remove(rawPath: string): Promise<void> {
    const path = this.resolvePath(rawPath);
    if (path === '/' || path === '/root' || path === '/etc' || path === '/usr' || path === '/var') {
      throw new ForbiddenException({
        code: 'FILE_FORBIDDEN_PATH',
        message: 'Refusing to delete critical system path',
      });
    }
    await fs.rm(path, { recursive: true, force: true });
  }

  async chmod(rawPath: string, mode: number): Promise<void> {
    const path = this.resolvePath(rawPath);
    await fs.chmod(path, mode);
  }

  async chown(rawPath: string, uid: number, gid: number): Promise<void> {
    const path = this.resolvePath(rawPath);
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
