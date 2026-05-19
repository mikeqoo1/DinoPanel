import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  createDbInstanceSchema,
  patchDbInstanceSchema,
  removeDbInstanceSchema,
  type CreateDbInstance,
  type DbInstanceResponse,
  type DbMetricsSummary,
  type DbReconcileResponse,
  type PatchDbInstance,
  type RemoveDbInstance,
} from '@dinopanel/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { DatabasesService } from './databases.service';
import { DbInstancesService } from './db-instances.service';
import { DbMetricsService } from './db-metrics.service';

@Controller('databases')
export class DatabasesController {
  constructor(
    private readonly databases: DatabasesService,
    private readonly instances: DbInstancesService,
    private readonly dbMetrics: DbMetricsService,
  ) {}

  @Get()
  list(): Promise<DbInstanceResponse[]> {
    return this.instances.list();
  }

  @Get('status')
  status(): { degraded: boolean; reason: string | null } {
    return this.databases.getStatus();
  }

  @Post()
  @HttpCode(201)
  create(
    @Body(new ZodValidationPipe(createDbInstanceSchema)) body: CreateDbInstance,
  ): Promise<DbInstanceResponse> {
    return this.instances.create(body);
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number): Promise<DbInstanceResponse> {
    return this.instances.get(id);
  }

  @Patch(':id')
  patch(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(patchDbInstanceSchema)) body: PatchDbInstance,
  ): Promise<DbInstanceResponse> {
    return this.instances.patch(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(removeDbInstanceSchema)) body: RemoveDbInstance,
  ): Promise<void> {
    await this.instances.remove(id, body);
  }

  @Post(':id/start')
  @HttpCode(204)
  async start(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.instances.start(id);
  }

  @Post(':id/stop')
  @HttpCode(204)
  async stop(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.instances.stop(id);
  }

  @Post(':id/restart')
  @HttpCode(204)
  async restart(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.instances.restart(id);
  }

  @Post(':id/rotate-password')
  rotatePassword(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<DbInstanceResponse> {
    return this.instances.rotatePassword(id);
  }

  @Post('reconcile')
  reconcile(): Promise<DbReconcileResponse> {
    return this.instances.reconcile();
  }

  /**
   * PMM PromQL summary for the instance. `?refresh=1` bypasses the
   * 30 s cache (spec.md §summaryFor WARN-3 fix).
   */
  @Get(':id/metrics')
  metrics(
    @Param('id', ParseIntPipe) id: number,
    @Query('refresh') refresh?: string,
  ): Promise<DbMetricsSummary> {
    return this.dbMetrics.summaryFor(id, { refresh: refresh === '1' });
  }
}
