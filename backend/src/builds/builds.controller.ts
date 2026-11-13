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
  Res,
  ParseUUIDPipe,
} from '@nestjs/common';
import { Response } from 'express';
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

  @Get(':buildId/artifacts/:artifactId/download')
  @ApiOperation({ summary: 'Download a build artifact (owner only)' })
  async download(
    @CurrentUser('id') userId: string,
    @Param('buildId', ParseUUIDPipe) buildId: string,
    @Param('artifactId', ParseUUIDPipe) artifactId: string,
    @Res() res: Response,
  ) {
    const a = await this.buildsService.getArtifactForDownload(userId, buildId, artifactId);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Artifact-SHA256', a.sha256);
    res.type(a.fileName.endsWith('.aab') ? 'application/octet-stream' : 'application/vnd.android.package-archive');
    res.download(a.storagePath, a.fileName);
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
