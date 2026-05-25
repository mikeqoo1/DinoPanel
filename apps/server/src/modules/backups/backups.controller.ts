import { Controller, Get } from '@nestjs/common';
import { BackupsService } from './backups.service';

/**
 * Phase 1 stub controller — only `GET /api/backups` exists and returns
 * an empty array. Per-instance / create / delete / restore / download
 * land in Phase 3 (spec.md §Phase 3).
 */
@Controller('backups')
export class BackupsController {
  constructor(private readonly backups: BackupsService) {}

  @Get()
  list(): Promise<unknown[]> {
    return this.backups.list();
  }
}
