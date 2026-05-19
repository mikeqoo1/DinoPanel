import { Module } from '@nestjs/common';
import { NginxService } from './nginx.service';
import { WebsitesController } from './websites.controller';
import { WebsitesService } from './websites.service';

@Module({
  controllers: [WebsitesController],
  providers: [NginxService, WebsitesService],
  exports: [NginxService, WebsitesService],
})
export class WebsitesModule {}
