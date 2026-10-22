import { Controller, Delete, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { LifecycleService } from './lifecycle.service';

@ApiTags('me')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('me')
export class MeController {
  constructor(private readonly lifecycle: LifecycleService) {}

  @Delete('data')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete all my projects, build history, logs and files' })
  deleteData(@CurrentUser('id') userId: string) {
    return this.lifecycle.deleteUserData(userId, false);
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete my account and everything attached to it' })
  deleteAccount(@CurrentUser('id') userId: string) {
    return this.lifecycle.deleteUserData(userId, true);
  }
}
