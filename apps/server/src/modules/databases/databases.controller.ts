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
import { Throttle } from '@nestjs/throttler';
import {
  createDbInstanceSchema,
  patchDbInstanceSchema,
  removeDbInstanceSchema,
  revealDbPasswordBodySchema,
  type CreateDbInstance,
  type DbInstanceResponse,
  type DbInstanceRevealResponse,
  type DbMetricsSummary,
  type DbReconcileResponse,
  type PatchDbInstance,
  type PmmExternalServicesResponse,
  type RemoveDbInstance,
  type RevealDbPassword,
} from '@dinopanel/shared';
import { CurrentUser, type AuthUserContext } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { DatabasesService } from './databases.service';
import { DbInstancesService } from './db-instances.service';
import { DbMetricsService } from './db-metrics.service';
import { ExternalPmmService } from './external-pmm.service';

@Controller('databases')
export class DatabasesController {
  constructor(
    private readonly databases: DatabasesService,
    private readonly instances: DbInstancesService,
    private readonly dbMetrics: DbMetricsService,
    private readonly externalPmm: ExternalPmmService,
  ) {}

  @Get()
  list(): Promise<DbInstanceResponse[]> {
    return this.instances.list();
  }

  @Get('status')
  status(): { degraded: boolean; reason: string | null } {
    return this.databases.getStatus();
  }

  /**
   * Read-only inventory of PMM-monitored DBs that are NOT managed
   * by DinoPanel (dedup against `db_instances.containerName`).
   * `?refresh=1` bypasses the 30 s cache (mirrors the `:id/metrics`
   * refresh contract).
   */
  @Get('external-pmm')
  listExternalPmm(
    @Query('refresh') refresh?: string,
  ): Promise<PmmExternalServicesResponse> {
    return this.externalPmm.list({ refresh: refresh === '1' });
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

  // TODO: switch to user-keyed throttle once a custom tracker exists (D3).
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post(':id/reveal-password')
  revealPassword(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(revealDbPasswordBodySchema)) body: RevealDbPassword,
    @CurrentUser() user: AuthUserContext,
  ): Promise<DbInstanceRevealResponse> {
    return this.instances.revealPassword(id, user.id, body.currentPassword);
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
