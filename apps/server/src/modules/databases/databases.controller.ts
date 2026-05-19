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
} from '@nestjs/common';
import {
  createDbInstanceSchema,
  patchDbInstanceSchema,
  removeDbInstanceSchema,
  type CreateDbInstance,
  type DbInstanceResponse,
  type DbReconcileResponse,
  type PatchDbInstance,
  type RemoveDbInstance,
} from '@dinopanel/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { DatabasesService } from './databases.service';

/**
 * Auth enforced globally via `APP_GUARD: JwtAuthGuard` in
 * `AuthModule`. Mutating endpoints throw `NOT_IMPLEMENTED_YET
 * (phase: 2)` from the service for Phase 1 — controller surface is
 * stable from day one.
 */
@Controller('databases')
export class DatabasesController {
  constructor(private readonly databases: DatabasesService) {}

  @Get()
  list(): Promise<DbInstanceResponse[]> {
    return this.databases.list();
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
    return this.databases.create(body);
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number): Promise<DbInstanceResponse> {
    return this.databases.get(id);
  }

  @Patch(':id')
  patch(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(patchDbInstanceSchema)) body: PatchDbInstance,
  ): Promise<DbInstanceResponse> {
    return this.databases.patch(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(removeDbInstanceSchema)) body: RemoveDbInstance,
  ): Promise<void> {
    await this.databases.remove(id, body);
  }

  @Post(':id/start')
  @HttpCode(204)
  async start(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.databases.start(id);
  }

  @Post(':id/stop')
  @HttpCode(204)
  async stop(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.databases.stop(id);
  }

  @Post(':id/restart')
  @HttpCode(204)
  async restart(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.databases.restart(id);
  }

  @Post(':id/rotate-password')
  rotatePassword(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<DbInstanceResponse> {
    return this.databases.rotatePassword(id);
  }

  @Post('reconcile')
  reconcile(): Promise<DbReconcileResponse> {
    return this.databases.reconcile();
  }
}
