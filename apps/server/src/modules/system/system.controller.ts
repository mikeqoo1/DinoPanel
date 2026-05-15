import { Controller, Get } from '@nestjs/common';
import { SystemService } from './system.service';

@Controller('system')
export class SystemController {
  constructor(private readonly system: SystemService) {}

  @Get('info')
  info() {
    return this.system.getInfo();
  }

  @Get('process-info')
  processInfo() {
    return this.system.getProcessInfo();
  }

  @Get('metrics')
  metrics() {
    return this.system.getLatest() ?? { error: 'metrics not yet available' };
  }
}
