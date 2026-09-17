import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  UsePipes,
} from '@nestjs/common';
import {
  createNodeSchema,
  type CreateNode,
  type RemoteContainersResponse,
  type RemoteNode,
  type RemoteNodeMetrics,
} from '@dinopanel/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { NodesService } from './nodes.service';

@Controller('nodes')
export class NodesController {
  constructor(private readonly nodes: NodesService) {}

  @Get()
  list(): Promise<RemoteNode[]> {
    return this.nodes.list();
  }

  @Post()
  @UsePipes(new ZodValidationPipe(createNodeSchema))
  add(@Body() body: CreateNode): Promise<RemoteNode[]> {
    return this.nodes.add(body);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string): Promise<void> {
    await this.nodes.remove(id);
  }

  @Post(':id/test')
  test(@Param('id') id: string): Promise<{ ok: true; latencyMs: number; sudoOk?: boolean }> {
    return this.nodes.testNode(id);
  }

  @Get(':id/metrics')
  metrics(@Param('id') id: string): Promise<RemoteNodeMetrics> {
    return this.nodes.getMetrics(id);
  }

  @Get(':id/containers')
  containers(@Param('id') id: string): Promise<RemoteContainersResponse> {
    return this.nodes.getContainers(id);
  }
}
