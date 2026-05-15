import { Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ContainersService } from './containers.service';

@Controller('containers')
export class ContainersController {
  constructor(private readonly containers: ContainersService) {}

  @Get()
  async list(@Query('all') all?: string) {
    const filters = all === 'true' || all === '1' ? undefined : undefined;
    return this.containers.list(filters);
  }

  @Get(':id')
  async inspect(@Param('id') id: string) {
    return this.containers.inspect(id);
  }

  @Post(':id/start')
  @HttpCode(204)
  async start(@Param('id') id: string) {
    await this.containers.start(id);
  }

  @Post(':id/stop')
  @HttpCode(204)
  async stop(@Param('id') id: string) {
    await this.containers.stop(id);
  }

  @Post(':id/restart')
  @HttpCode(204)
  async restart(@Param('id') id: string) {
    await this.containers.restart(id);
  }

  @Post(':id/pause')
  @HttpCode(204)
  async pause(@Param('id') id: string) {
    await this.containers.pause(id);
  }

  @Post(':id/unpause')
  @HttpCode(204)
  async unpause(@Param('id') id: string) {
    await this.containers.unpause(id);
  }

  @Post(':id/kill')
  @HttpCode(204)
  async kill(@Param('id') id: string) {
    await this.containers.kill(id);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string, @Query('force') force?: string, @Query('v') v?: string) {
    await this.containers.remove(id, {
      force: force === 'true' || force === '1',
      v: v === 'true' || v === '1',
    });
  }
}
