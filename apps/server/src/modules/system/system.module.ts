import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SystemController } from './system.controller';
import { SystemService } from './system.service';
import { MetricsGateway } from './metrics.gateway';

@Module({
  imports: [AuthModule],
  controllers: [SystemController],
  providers: [SystemService, MetricsGateway],
  exports: [SystemService, MetricsGateway],
})
export class SystemModule {}
