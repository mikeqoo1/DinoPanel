import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { Logger } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import {
  remoteNodeSchema,
  type CreateNode,
  type RemoteContainersResponse,
  type RemoteNode,
  type RemoteNodeMetrics,
} from '@dinopanel/shared';
import { DRIZZLE_DB, type Db } from '../../database/db.module';
import { settings } from '../../database/schema';
import { CONTAINER_PS_CMD, METRICS_CMD, isDockerAbsent, sshExec } from './ssh';
import { parseDockerPsJson, parseMetricsOutput } from './remote-parsers';

// ponytail: no Unavailable-driver layer — ssh availability is per-request/per-node,
// not boot-probe-able; commandErrorToHttp(err,'NODES') covers TOOL_MISSING naturally (D6)

const NODES_KEY = 'nodes.list';

@Injectable()
export class NodesService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Db,
    private readonly logger: Logger,
  ) {}

  private async readList(): Promise<RemoteNode[]> {
    const rows = await this.db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, NODES_KEY))
      .limit(1);
    if (!rows[0]?.value) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(rows[0].value);
    } catch {
      this.logger.warn({ key: NODES_KEY }, 'nodes.list_parse_error — returning empty');
      return [];
    }
    if (!Array.isArray(parsed)) {
      this.logger.warn({ key: NODES_KEY, type: typeof parsed }, 'nodes.list_not_array — returning empty');
      return [];
    }
    // Validate each stored entry — drops any that fail host/user/port constraints
    // so a corrupted or tampered KV row never reaches ssh argv.
    return parsed.flatMap((entry) => {
      const r = remoteNodeSchema.safeParse(entry);
      if (!r.success) {
        this.logger.warn({ entry, error: r.error.message }, 'nodes.list_invalid_entry — dropped');
        return [];
      }
      return [r.data];
    });
  }

  private async writeList(nodes: RemoteNode[]): Promise<void> {
    const value = JSON.stringify(nodes);
    await this.db
      .insert(settings)
      .values({ key: NODES_KEY, value })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value, updatedAt: Date.now() },
      });
  }

  async list(): Promise<RemoteNode[]> {
    return this.readList();
  }

  async add(input: CreateNode): Promise<RemoteNode[]> {
    // ponytail: unserialized read-modify-write; two concurrent POSTs can both pass
    // the duplicate check. Single-admin panel makes this low-probability — use a
    // per-key serialized writer or mutex if multi-writer concurrency ever matters.
    const nodes = await this.readList();
    if (nodes.some((n) => n.host === input.host && n.port === input.port)) {
      throw new HttpException(
        { code: 'NODES_DUPLICATE', message: 'A node with this host:port already exists' },
        HttpStatus.CONFLICT,
      );
    }
    const node: RemoteNode = { id: randomUUID(), ...input };
    nodes.push(node);
    await this.writeList(nodes);
    return nodes;
  }

  async remove(id: string): Promise<void> {
    const nodes = await this.readList();
    await this.writeList(nodes.filter((n) => n.id !== id));
  }

  private findNode(nodes: RemoteNode[], id: string): RemoteNode {
    const node = nodes.find((n) => n.id === id);
    if (!node) {
      throw new HttpException(
        { code: 'NODES_NOT_FOUND', message: 'Node not found' },
        HttpStatus.NOT_FOUND,
      );
    }
    return node;
  }

  async testNode(id: string): Promise<{ ok: true; latencyMs: number }> {
    const nodes = await this.readList();
    const node = this.findNode(nodes, id);
    const start = Date.now();
    const result = await sshExec(node, 'true', this.logger);
    if (result.exitCode !== 0) {
      this.logger.warn(
        { node: id, exitCode: result.exitCode },
        'nodes.test_command_failed',
      );
      throw new HttpException(
        { code: 'NODES_COMMAND_FAILED', message: 'Remote command failed' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    return { ok: true, latencyMs: Date.now() - start };
  }

  async getMetrics(id: string): Promise<RemoteNodeMetrics> {
    const nodes = await this.readList();
    const node = this.findNode(nodes, id);
    const result = await sshExec(node, METRICS_CMD, this.logger);
    // GNU df exits 1 on any statfs failure (stale NFS / dead FUSE) while still
    // printing valid rows for healthy filesystems. Tolerate this: if parsing
    // yields at least one disk row and non-zero mem.total the data is usable.
    const metrics = parseMetricsOutput(result.stdout);
    if (result.exitCode !== 0 && !(metrics.mem.total > 0 && metrics.disks.length > 0)) {
      this.logger.warn(
        { node: id, exitCode: result.exitCode },
        'nodes.metrics_command_failed',
      );
      throw new HttpException(
        { code: 'NODES_COMMAND_FAILED', message: 'Remote metrics command failed' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    return metrics;
  }

  async getContainers(id: string): Promise<RemoteContainersResponse> {
    const nodes = await this.readList();
    const node = this.findNode(nodes, id);
    const result = await sshExec(node, CONTAINER_PS_CMD, this.logger);
    // Single source of truth for docker-absent — same predicate as sshExec's warn-skip.
    if (isDockerAbsent(result)) {
      return { dockerAvailable: false, containers: [] };
    }
    if (result.exitCode !== 0) {
      this.logger.warn(
        { node: id, exitCode: result.exitCode },
        'nodes.containers_command_failed',
      );
      throw new HttpException(
        { code: 'NODES_COMMAND_FAILED', message: 'Remote containers command failed' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    // Log the first bad line only (truncated), then one aggregate count for the rest.
    // A hostile node returning megabytes of non-JSON stdout could otherwise trigger
    // tens of thousands of pino serializations per poll + a log flood.
    let badLineCount = 0;
    const containers = parseDockerPsJson(result.stdout, (line, err) => {
      if (badLineCount === 0) {
        this.logger.warn(
          { line: line.slice(0, 200), err },
          'nodes.docker_ps_parse_error',
        );
      }
      badLineCount++;
    });
    if (badLineCount > 1) {
      this.logger.warn(
        { count: badLineCount - 1 },
        'nodes.docker_ps_parse_error_aggregate',
      );
    }
    return { dockerAvailable: true, containers };
  }
}
