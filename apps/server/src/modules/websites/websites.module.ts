import { Module } from '@nestjs/common';
import { ContainersModule } from '../containers/containers.module';
import { NginxService } from './nginx.service';
import { PhpFpmService } from './php-fpm.service';
import { SitesService } from './sites.service';
import { WebsitesController } from './websites.controller';
import { WebsitesService } from './websites.service';

@Module({
  // v0.4: PhpFpmService injects the dockerode token re-exported here.
  imports: [ContainersModule],
  controllers: [WebsitesController],
  providers: [NginxService, PhpFpmService, SitesService, WebsitesService],
  exports: [NginxService, PhpFpmService, SitesService, WebsitesService],
})
export class WebsitesModule {}
