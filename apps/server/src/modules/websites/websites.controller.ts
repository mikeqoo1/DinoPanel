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
  UsePipes,
} from '@nestjs/common';
import {
  siteCreateSchema,
  sitePatchSchema,
  type ReconcileResponse,
  type SiteCreate,
  type SitePatch,
  type SiteResponse,
} from '@dinopanel/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { SitesService } from './sites.service';
import { WebsitesService } from './websites.service';

/**
 * Auth is enforced globally via `APP_GUARD: JwtAuthGuard` registered
 * in `AuthModule`. No `@UseGuards` needed here.
 */
@Controller('websites')
export class WebsitesController {
  constructor(
    private readonly websites: WebsitesService,
    private readonly sites: SitesService,
  ) {}

  @Get()
  list(): Promise<SiteResponse[]> {
    return this.sites.list();
  }

  @Get('status')
  status(): { degraded: boolean; reason: string | null } {
    return this.websites.getStatus();
  }

  @Post()
  @HttpCode(201)
  @UsePipes(new ZodValidationPipe(siteCreateSchema))
  create(@Body() body: SiteCreate): Promise<SiteResponse> {
    return this.sites.create(body);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(sitePatchSchema)) body: SitePatch,
  ): Promise<SiteResponse> {
    return this.sites.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.sites.remove(id);
  }

  @Post('reconcile')
  reconcile(): Promise<ReconcileResponse> {
    return this.sites.reconcile();
  }

  @Get(':id/conf')
  async getConf(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<{ path: string; content: string }> {
    return this.sites.getConf(id);
  }
}
