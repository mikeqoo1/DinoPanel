import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UsePipes,
} from '@nestjs/common';
import {
  createNexusInstanceSchema,
  nexusRangeSchema,
  type CreateNexusInstance,
  type NexusInstance,
  type NexusMetrics,
  type NexusRepository,
  type NexusSeries,
} from '@dinopanel/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { NexusService } from './nexus.service';

@Controller('nexus')
export class NexusController {
  constructor(private readonly nexus: NexusService) {}

  @Get()
  list(): Promise<NexusInstance[]> {
    return this.nexus.list();
  }

  @Post()
  @UsePipes(new ZodValidationPipe(createNexusInstanceSchema))
  add(@Body() body: CreateNexusInstance): Promise<NexusInstance[]> {
    return this.nexus.add(body);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string): Promise<void> {
    await this.nexus.remove(id);
  }

  /** Live scrape — also the credential check used by the UI's "test" button. */
  @Post(':id/test')
  test(@Param('id') id: string): Promise<NexusMetrics> {
    return this.nexus.scrape(id);
  }

  @Get(':id/series')
  series(@Param('id') id: string, @Query('range') range?: string): Promise<NexusSeries> {
    return this.nexus.getSeries(id, nexusRangeSchema.catch('1h').parse(range));
  }

  @Get(':id/repositories')
  repositories(@Param('id') id: string): Promise<NexusRepository[]> {
    return this.nexus.getRepositories(id);
  }
}
