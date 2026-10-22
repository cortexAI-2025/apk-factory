import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { LifecycleService } from './lifecycle.service';
import { MeController } from './me.controller';

@Module({
  imports: [StorageModule],
  providers: [LifecycleService],
  controllers: [MeController],
  exports: [LifecycleService],
})
export class LifecycleModule {}
