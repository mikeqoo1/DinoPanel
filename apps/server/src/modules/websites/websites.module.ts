import { Module } from '@nestjs/common';
import { NginxService } from './nginx.service';
import { SitesService } from './sites.service';
import { WebsitesController } from './websites.controller';
import { WebsitesService } from './websites.service';

@Module({
  controllers: [WebsitesController],
  providers: [NginxService, SitesService, WebsitesService],
  exports: [NginxService, SitesService, WebsitesService],
})
export class WebsitesModule {}
