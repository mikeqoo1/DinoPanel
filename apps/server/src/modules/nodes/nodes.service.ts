import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { Logger } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import type {
  CreateNode,
  RemoteContainersResponse,
  RemoteNode,
  RemoteNodeMetrics,
} from '@dinopanel/shared';
import { DRIZZLE_DB, type Db } from '../../database/db.module';
import { settings } from '../../database/schema';
import { DOCKER_PS_CMD, METRICS_CMD, sshExec } from './ssh';
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
    try {
      return JSON.parse(rows[0].value) as RemoteNode[];
    } catch {
      this.logger.warn({ key: NODES_KEY }, 'nodes.list_parse_error — returning empty');
      return [];
    }
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
    if (result.exitCode !== 0) {
      this.logger.warn(
        { node: id, exitCode: result.exitCode },
        'nodes.metrics_command_failed',
      );
      throw new HttpException(
        { code: 'NODES_COMMAND_FAILED', message: 'Remote metrics command failed' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    return parseMetricsOutput(result.stdout);
  }

  async getContainers(id: string): Promise<RemoteContainersResponse> {
    const nodes = await this.readList();
    const node = this.findNode(nodes, id);
    const result = await sshExec(node, DOCKER_PS_CMD, this.logger);
    // docker absent on remote: exit 127 or stderr 'command not found' → not an error
    if (result.exitCode === 127 || /command not found/i.test(result.stderr)) {
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
    const containers = parseDockerPsJson(result.stdout, (line, err) =>
      this.logger.warn({ line, err }, 'nodes.docker_ps_parse_error'),
    );
    return { dockerAvailable: true, containers };
  }
}
