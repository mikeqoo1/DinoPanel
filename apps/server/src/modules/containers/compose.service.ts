import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  type OnModuleInit,
} from '@nestjs/common';
import { execFile, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { eq } from 'drizzle-orm';
import { Logger } from 'nestjs-pino';
import Dockerode from 'dockerode';
import { DOCKER } from './docker.token';
import { DRIZZLE_DB, type Db } from '../../database/db.module';
import { composeStacks } from '../../database/schema';
import type { ComposeStack, ComposeFile, ComposeValidation } from '@dinopanel/shared';

const execFileAsync = promisify(execFile);

// Candidate compose file names in priority order.
const COMPOSE_FILE_CANDIDATES = [
  'compose.yaml',
  'compose.yml',
  'docker-compose.yaml',
  'docker-compose.yml',
];

@Injectable()
export class ComposeService implements OnModuleInit {
  private isV2Available = false;

  constructor(
    @Inject(DOCKER) private readonly docker: Dockerode,
    @Inject(DRIZZLE_DB) private readonly db: Db,
    private readonly logger: Logger,
  ) {}

  async onModuleInit() {
    try {
      await execFileAsync('docker', ['compose', 'version'], { timeout: 3000 });
      this.isV2Available = true;
      this.logger.log('docker compose v2 detected');
    } catch {
      this.logger.warn(
        'docker compose v2 not found — Compose features will be unavailable; install docker-compose-plugin',
      );
    }
  }

  private assertV2() {
    if (!this.isV2Available) {
      throw new ServiceUnavailableException({
        code: 'COMPOSE_UNAVAILABLE',
        message:
          'docker compose v2 is not available. Install docker-compose-plugin and restart DinoPanel.',
      });
    }
  }

  // ---------------------------------------------------------------------------
  // List all stacks: merge discovered (via labels) + registered (SQLite)
  // ---------------------------------------------------------------------------

  async listStacks(): Promise<ComposeStack[]> {
    this.assertV2();

    // 1. Discover via labels
    const rawContainers = await this.docker.listContainers({
      all: true,
      filters: JSON.stringify({ label: ['com.docker.compose.project'] }),
    });

    // Group by project name
    const discoveredMap = new Map<
      string,
      { path: string; services: Set<string>; containerCount: number; runningCount: number }
    >();

    for (const c of rawContainers) {
      const project = c.Labels['com.docker.compose.project'];
      const workingDir = c.Labels['com.docker.compose.working_dir'] ?? '';
      const service = c.Labels['com.docker.compose.service'] ?? '';
      if (!project) continue;

      if (!discoveredMap.has(project)) {
        discoveredMap.set(project, {
          path: workingDir,
          services: new Set(),
          containerCount: 0,
          runningCount: 0,
        });
      }
      const entry = discoveredMap.get(project)!;
      if (service) entry.services.add(service);
      entry.containerCount++;
      if (c.State === 'running') entry.runningCount++;
      // Prefer populated working_dir
      if (!entry.path && workingDir) entry.path = workingDir;
    }

    // 2. Load registered stacks from SQLite
    const registered = await this.db.select().from(composeStacks);
    const registeredByName = new Map(registered.map((r) => [r.name, r]));

    // 3. Merge: registered wins on id/path; discovered-only gets null id
    const result: ComposeStack[] = [];

    // Start with registered; augment with discovered runtime data
    for (const row of registered) {
      const disc = discoveredMap.get(row.name);
      result.push({
        id: row.id,
        name: row.name,
        path: row.path,
        source: 'registered',
        services: disc ? [...disc.services] : [],
        containerCount: disc?.containerCount ?? 0,
        runningCount: disc?.runningCount ?? 0,
      });
      // Remove from discovered so we don't double-add
      discoveredMap.delete(row.name);
    }

    // Remaining discovered stacks (not in SQLite)
    for (const [name, disc] of discoveredMap) {
      if (registeredByName.has(name)) continue; // already added above
      result.push({
        id: null,
        name,
        path: disc.path,
        source: 'discovered',
        services: [...disc.services],
        containerCount: disc.containerCount,
        runningCount: disc.runningCount,
      });
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // Get single stack by numeric id (DB row) or name string
  // ---------------------------------------------------------------------------

  async getStack(idOrName: string): Promise<ComposeStack> {
    this.assertV2();

    const all = await this.listStacks();
    const asNum = Number(idOrName);
    const found = isNaN(asNum)
      ? all.find((s) => s.name === idOrName)
      : all.find((s) => s.id === asNum);

    if (!found) {
      throw new NotFoundException({ code: 'COMPOSE_NOT_FOUND', message: `Stack '${idOrName}' not found` });
    }
    return found;
  }

  // ---------------------------------------------------------------------------
  // Read compose file
  // ---------------------------------------------------------------------------

  async readComposeFile(stackId: number | string): Promise<ComposeFile> {
    this.assertV2();
    const stack = await this.getStack(String(stackId));
    const filePath = await this.requireComposeFilePath(stack);
    const st = await stat(filePath);
    const content = await readFile(filePath, 'utf8');
    return { path: filePath, content, modifiedAt: st.mtimeMs };
  }

  // ---------------------------------------------------------------------------
  // Write compose file
  // ---------------------------------------------------------------------------

  async writeComposeFile(stackId: number | string, content: string): Promise<void> {
    this.assertV2();
    const stack = await this.getStack(String(stackId));
    this.requireStackPath(stack);
    const filePath = await this.resolveComposeFilePath(stack.path).catch(
      () => join(stack.path, 'compose.yml'),
    );
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content, 'utf8');
  }

  // ---------------------------------------------------------------------------
  // Register new stack
  // ---------------------------------------------------------------------------

  async createStack(opts: { name: string; path: string; content?: string }): Promise<ComposeStack> {
    this.assertV2();

    // Check for name conflict in DB
    const existing = await this.db
      .select()
      .from(composeStacks)
      .where(eq(composeStacks.name, opts.name))
      .limit(1);

    if (existing.length > 0) {
      throw new ConflictException({
        code: 'COMPOSE_NAME_CONFLICT',
        message: `A stack named '${opts.name}' is already registered`,
      });
    }

    await mkdir(opts.path, { recursive: true });

    if (opts.content !== undefined) {
      const filePath = join(opts.path, 'compose.yml');
      await writeFile(filePath, opts.content, 'utf8');
    }

    const [row] = await this.db
      .insert(composeStacks)
      .values({ name: opts.name, path: opts.path })
      .returning();

    if (!row) throw new Error('Insert failed — no row returned');

    return {
      id: row.id,
      name: row.name,
      path: row.path,
      source: 'registered',
      services: [],
      containerCount: 0,
      runningCount: 0,
    };
  }

  // ---------------------------------------------------------------------------
  // Unregister stack (delete SQLite row; does NOT delete files)
  // ---------------------------------------------------------------------------

  async unregisterStack(stackId: number): Promise<void> {
    this.assertV2();
    const deleted = await this.db
      .delete(composeStacks)
      .where(eq(composeStacks.id, stackId))
      .returning();

    if (deleted.length === 0) {
      throw new NotFoundException({
        code: 'COMPOSE_NOT_FOUND',
        message: `Stack with id ${stackId} not found`,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Validate: runs `docker compose config`
  // ---------------------------------------------------------------------------

  async validate(stackId: number | string): Promise<ComposeValidation> {
    this.assertV2();
    const stack = await this.getStack(String(stackId));
    const filePath = await this.requireComposeFilePath(stack);

    return new Promise((resolve) => {
      const child = spawn('docker', ['compose', '-f', filePath, 'config'], {
        cwd: stack.path,
        timeout: 15_000,
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

      child.on('close', (code) => {
        if (code === 0) {
          resolve({
            valid: true,
            resolvedYaml: Buffer.concat(stdoutChunks).toString('utf8'),
          });
        } else {
          const stderr = Buffer.concat(stderrChunks).toString('utf8');
          const errors = parseComposeErrors(stderr);
          resolve({ valid: false, errors });
        }
      });

      child.on('error', (err) => {
        resolve({
          valid: false,
          errors: [{ message: err.message }],
        });
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Spawn action (used by WS gateway)
  // ---------------------------------------------------------------------------

  spawnAction(
    stackPath: string,
    action: 'up' | 'down' | 'restart' | 'pull',
  ): ChildProcess {
    const args = actionArgs(action);
    return spawn('docker', ['compose', ...args], {
      cwd: stackPath,
    });
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /** Find the compose file inside a directory; throws if none found. */
  private async resolveComposeFilePath(dir: string): Promise<string> {
    for (const candidate of COMPOSE_FILE_CANDIDATES) {
      const p = join(dir, candidate);
      const s = await stat(p).catch(() => null);
      if (s?.isFile()) return p;
    }
    throw new NotFoundException({
      code: 'COMPOSE_FILE_NOT_FOUND',
      message: `No compose file found in ${dir}`,
    });
  }

  /**
   * Reject with COMPOSE_FILE_UNAVAILABLE (409) when the stack has no
   * recorded directory on disk — typical for stacks that were only
   * discovered from running container labels and never registered.
   */
  private requireStackPath(stack: ComposeStack): void {
    if (!stack.path) {
      throw new ConflictException({
        code: 'COMPOSE_FILE_UNAVAILABLE',
        message: `Stack '${stack.name}' has no recorded compose directory — it was discovered from running containers but has no editable file on disk.`,
      });
    }
  }

  /**
   * Resolve the path to an existing compose file for this stack, or
   * throw COMPOSE_FILE_UNAVAILABLE (409). Collapses both the
   * "no directory recorded" and "no file in directory" cases into a
   * single error consumers can act on uniformly.
   */
  private async requireComposeFilePath(stack: ComposeStack): Promise<string> {
    this.requireStackPath(stack);
    try {
      return await this.resolveComposeFilePath(stack.path);
    } catch {
      throw new ConflictException({
        code: 'COMPOSE_FILE_UNAVAILABLE',
        message: `No compose file found in ${stack.path} for stack '${stack.name}'.`,
      });
    }
  }

  /** Default stack directory under ~/dinopanel-stacks/<name>/ */
  static defaultStackPath(name: string): string {
    return join(homedir(), 'dinopanel-stacks', name);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function actionArgs(action: 'up' | 'down' | 'restart' | 'pull'): string[] {
  switch (action) {
    case 'up':
      return ['up', '-d', '--remove-orphans'];
    case 'down':
      return ['down'];
    case 'restart':
      return ['restart'];
    case 'pull':
      return ['pull'];
  }
}

/** Parse docker compose config stderr into structured error list. */
function parseComposeErrors(
  stderr: string,
): Array<{ line?: number; message: string }> {
  if (!stderr.trim()) return [];

  return stderr
    .split('\n')
    .filter((l) => l.trim())
    .map((line) => {
      // Try to extract line number from patterns like "line 12:" or "(line 12)"
      const lineMatch = /(?:line\s+|:)(\d+)/i.exec(line);
      return {
        line: lineMatch ? parseInt(lineMatch[1]!, 10) : undefined,
        message: line.trim(),
      };
    });
}
