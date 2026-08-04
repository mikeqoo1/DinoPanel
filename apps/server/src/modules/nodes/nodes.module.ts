import { Module } from '@nestjs/common';
import { NodesController } from './nodes.controller';
import { NodesService } from './nodes.service';

// ponytail: no boot probe / driver factory — DatabaseModule is @Global(),
// ssh tool-missing handled per-request by commandErrorToHttp(err,'NODES') (D6)
@Module({
  controllers: [NodesController],
  providers: [NodesService],
})
export class NodesModule {}
