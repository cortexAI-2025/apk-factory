import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BuildsGateway } from './builds.gateway';

// Single shared gateway instance (needs JwtService from AuthModule)
@Module({
  imports: [AuthModule],
  providers: [BuildsGateway],
  exports: [BuildsGateway],
})
export class GatewayModule {}
