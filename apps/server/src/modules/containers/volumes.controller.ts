import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, UsePipes } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { VolumesService } from './volumes.service';

const createVolumeSchema = z.object({
  name: z.string().min(1),
  driver: z.string().optional(),
  labels: z.record(z.string()).optional(),
});
type CreateVolumeBody = z.infer<typeof createVolumeSchema>;

@Controller('volumes')
export class VolumesController {
  constructor(private readonly volumes: VolumesService) {}

  @Get()
  async list() {
    return this.volumes.list();
  }

  @Post('prune')
  @HttpCode(200)
  async prune() {
    return this.volumes.prune();
  }

  @Get(':name')
  async inspect(@Param('name') name: string) {
    return this.volumes.inspect(name);
  }

  @Post()
  @HttpCode(201)
  @UsePipes(new ZodValidationPipe(createVolumeSchema))
  async create(@Body() body: CreateVolumeBody) {
    return this.volumes.create(body);
  }

  @Delete(':name')
  @HttpCode(204)
  async remove(@Param('name') name: string, @Query('force') force?: string) {
    await this.volumes.remove(name, force === 'true' || force === '1');
  }
}
