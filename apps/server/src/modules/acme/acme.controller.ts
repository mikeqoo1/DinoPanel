import {
  Body,
  Controller,
  Get,
  NotImplementedException,
  Param,
  ParseIntPipe,
  Post,
  UsePipes,
} from '@nestjs/common';
import {
  acmeIssueRequestSchema,
  type AcmeIssueRequest,
  type AcmeStatusResponse,
} from '@dinopanel/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';

/**
 * Phase 1 stub. Mounted under the parent `/api/websites/:id/ssl` so the
 * route surface is visible now. Bodies land with Phase 4.
 *
 * Auth is enforced globally via `APP_GUARD: JwtAuthGuard`.
 */
@Controller('websites/:id/ssl')
export class AcmeController {
  @Post('issue')
  @UsePipes(new ZodValidationPipe(acmeIssueRequestSchema))
  issue(
    @Param('id', ParseIntPipe) _id: number,
    @Body() _body: AcmeIssueRequest,
  ): never {
    throw new NotImplementedException({
      code: 'NOT_IMPLEMENTED_YET',
      phase: 4,
    });
  }

  @Post('renew')
  renew(@Param('id', ParseIntPipe) _id: number): never {
    throw new NotImplementedException({
      code: 'NOT_IMPLEMENTED_YET',
      phase: 4,
    });
  }

  @Get('status')
  status(@Param('id', ParseIntPipe) _id: number): AcmeStatusResponse {
    throw new NotImplementedException({
      code: 'NOT_IMPLEMENTED_YET',
      phase: 4,
    });
  }
}
