import { Module } from '@nestjs/common';
import { BuildsService } from './builds.service';
import { BuildsController } from './builds.controller';
import { InternalBuildsController } from './internal.controller';
import { QueueModule } from '../queue/queue.module';
import { StorageModule } from '../storage/storage.module';
import { GatewayModule } from '../gateway/gateway.module';

@Module({
  imports: [QueueModule, StorageModule, GatewayModule],
  providers: [BuildsService],
  controllers: [BuildsController, InternalBuildsController],
  exports: [BuildsService],
})
export class BuildsModule {}
