import { Module } from '@nestjs/common';
import { AuditInterceptor } from './audit.interceptor';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

@Module({
  controllers: [AuditController],
  providers: [AuditInterceptor, AuditService],
  exports: [AuditInterceptor, AuditService],
})
export class AuditModule {}
