import { Body, Controller, Delete, Get, HttpCode, Param, Post, UsePipes } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { NetworksService } from './networks.service';

const createNetworkSchema = z.object({
  name: z.string().min(1),
  driver: z.string().optional(),
  internal: z.boolean().optional(),
});
type CreateNetworkBody = z.infer<typeof createNetworkSchema>;

const connectBodySchema = z.object({
  containerId: z.string().min(1),
});
type ConnectBody = z.infer<typeof connectBodySchema>;

const disconnectBodySchema = z.object({
  containerId: z.string().min(1),
  force: z.boolean().optional(),
});
type DisconnectBody = z.infer<typeof disconnectBodySchema>;

@Controller('networks')
export class NetworksController {
  constructor(private readonly networks: NetworksService) {}

  @Get()
  async list() {
    return this.networks.list();
  }

  @Get(':id')
  async inspect(@Param('id') id: string) {
    return this.networks.inspect(id);
  }

  @Post()
  @HttpCode(201)
  @UsePipes(new ZodValidationPipe(createNetworkSchema))
  async create(@Body() body: CreateNetworkBody) {
    return this.networks.create(body);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string) {
    await this.networks.remove(id);
  }

  @Post(':id/connect')
  @HttpCode(204)
  @UsePipes(new ZodValidationPipe(connectBodySchema))
  async connect(@Param('id') id: string, @Body() body: ConnectBody) {
    await this.networks.connect(id, body.containerId);
  }

  @Post(':id/disconnect')
  @HttpCode(204)
  @UsePipes(new ZodValidationPipe(disconnectBodySchema))
  async disconnect(@Param('id') id: string, @Body() body: DisconnectBody) {
    await this.networks.disconnect(id, body.containerId, body.force);
  }
}
