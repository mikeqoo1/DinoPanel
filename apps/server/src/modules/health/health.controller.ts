import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';

@Controller('health')
export class HealthController {
  @Public()
  @Get()
  check() {
    return {
      status: 'ok',
      ts: Date.now(),
      uptime: process.uptime(),
      version: process.env.npm_package_version ?? '0.1.0-dev',
    };
  }
}
