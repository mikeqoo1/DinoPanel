import {
  Body,
  Controller,
  Delete,
  Get,
  NotImplementedException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UsePipes,
} from '@nestjs/common';
import {
  siteCreateSchema,
  sitePatchSchema,
  type SiteCreate,
  type SitePatch,
} from '@dinopanel/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { WebsitesService } from './websites.service';

/**
 * Phase 1 stub. Mutating endpoints throw `NOT_IMPLEMENTED_YET` so the
 * route surface is visible now but the bodies land with Phase 2. GET
 * endpoints return what's safe to expose at Phase 1 (empty list plus
 * the degraded flag).
 *
 * Auth is enforced globally via `APP_GUARD: JwtAuthGuard` registered
 * in `AuthModule` — no `@UseGuards` here.
 */
@Controller('websites')
export class WebsitesController {
  constructor(private readonly websites: WebsitesService) {}

  @Get()
  list(): Promise<unknown[]> {
    return this.websites.list();
  }

  @Get('status')
  status(): { degraded: boolean; reason: string | null } {
    return this.websites.getStatus();
  }

  @Post()
  @UsePipes(new ZodValidationPipe(siteCreateSchema))
  create(@Body() _body: SiteCreate): never {
    throw new NotImplementedException({
      code: 'NOT_IMPLEMENTED_YET',
      phase: 2,
    });
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) _id: number,
    @Body(new ZodValidationPipe(sitePatchSchema)) _body: SitePatch,
  ): never {
    throw new NotImplementedException({
      code: 'NOT_IMPLEMENTED_YET',
      phase: 2,
    });
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) _id: number): never {
    throw new NotImplementedException({
      code: 'NOT_IMPLEMENTED_YET',
      phase: 2,
    });
  }

  @Post('reconcile')
  reconcile(): never {
    throw new NotImplementedException({
      code: 'NOT_IMPLEMENTED_YET',
      phase: 2,
    });
  }

  @Get(':id/conf')
  getConf(@Param('id', ParseIntPipe) _id: number): never {
    throw new NotImplementedException({
      code: 'NOT_IMPLEMENTED_YET',
      phase: 2,
    });
  }
}
