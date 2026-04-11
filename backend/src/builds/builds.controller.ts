import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  Query,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { BuildsService } from './builds.service';
import { CreateBuildDto } from './dto/create-build.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('builds')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('projects/:projectId/builds')
export class BuildsController {
  constructor(private readonly buildsService: BuildsService) {}

  @Post()
  @ApiOperation({ summary: 'Trigger a new build' })
  async create(
    @CurrentUser('id') userId: string,
    @Param('projectId') projectId: string,
    @Body() dto: CreateBuildDto,
  ) {
    return this.buildsService.create(userId, projectId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List builds for a project' })
  async findAll(
    @CurrentUser('id') userId: string,
    @Param('projectId') projectId: string,
  ) {
    return this.buildsService.findAll(userId, projectId);
  }

  @Get(':buildId')
  @ApiOperation({ summary: 'Get build details' })
  async findOne(
    @CurrentUser('id') userId: string,
    @Param('buildId') buildId: string,
  ) {
    return this.buildsService.findOne(userId, buildId);
  }

  @Get(':buildId/logs')
  @ApiOperation({ summary: 'Get build logs (paginated)' })
  async getLogs(
    @CurrentUser('id') userId: string,
    @Param('buildId') buildId: string,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
    @Query('limit', new DefaultValuePipe(500), ParseIntPipe) limit: number,
  ) {
    return this.buildsService.getLogs(userId, buildId, offset, limit);
  }

  @Post(':buildId/public-link')
  @ApiOperation({ summary: 'Generate public download link & QR code' })
  async generatePublicLink(
    @CurrentUser('id') userId: string,
    @Param('buildId') buildId: string,
  ) {
    return this.buildsService.generatePublicLink(userId, buildId);
  }

  @Post(':buildId/cancel')
  @ApiOperation({ summary: 'Cancel a running build' })
  async cancel(
    @CurrentUser('id') userId: string,
    @Param('buildId') buildId: string,
  ) {
    return this.buildsService.cancel(userId, buildId);
  }
}
