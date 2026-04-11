import {
  Controller,
  Post,
  Patch,
  Param,
  Body,
  Headers,
  UnauthorizedException,
  HttpCode,
  HttpStatus,
  Logger,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiExcludeController } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { BuildsGateway } from '../gateway/builds.gateway';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import * as fs from 'fs/promises';

@ApiExcludeController()
@Controller('internal/builds')
export class InternalBuildsController {
  private readonly logger = new Logger(InternalBuildsController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly gateway: BuildsGateway,
    private readonly config: ConfigService,
  ) {}

  private authorize(secret: string) {
    const expected = this.config.get('WORKER_SECRET', 'worker-secret');
    if (secret !== expected) throw new UnauthorizedException('Invalid worker secret');
  }

  @Patch(':buildId/status')
  @HttpCode(HttpStatus.OK)
  async updateStatus(
    @Param('buildId') buildId: string,
    @Headers('x-worker-secret') secret: string,
    @Body() body: { status: string; apkUrl?: string; apkSize?: number; errorMessage?: string },
  ) {
    this.authorize(secret);

    const now = new Date();
    const build = await this.prisma.build.findUnique({
      where: { id: buildId },
      select: { startedAt: true },
    });

    const duration =
      build?.startedAt
        ? Math.floor((now.getTime() - build.startedAt.getTime()) / 1000)
        : undefined;

    const updated = await this.prisma.build.update({
      where: { id: buildId },
      data: {
        status: body.status as any,
        apkUrl: body.apkUrl,
        apkSize: body.apkSize,
        errorMessage: body.errorMessage,
        ...(body.status === 'BUILDING' && !build?.startedAt ? { startedAt: now } : {}),
        ...(['SUCCESS', 'FAILED', 'CANCELLED', 'TIMEOUT'].includes(body.status)
          ? { finishedAt: now, duration }
          : {}),
      },
    });

    this.gateway.emitBuildStatus(buildId, body.status);

    if (['SUCCESS', 'FAILED', 'CANCELLED', 'TIMEOUT'].includes(body.status)) {
      this.gateway.emitBuildComplete(buildId, {
        status: body.status,
        apkUrl: body.apkUrl,
        duration,
        errorMessage: body.errorMessage,
      });
    }

    return updated;
  }

  @Post(':buildId/logs')
  @HttpCode(HttpStatus.CREATED)
  async addLog(
    @Param('buildId') buildId: string,
    @Headers('x-worker-secret') secret: string,
    @Body() body: { level: string; message: string },
  ) {
    this.authorize(secret);

    const log = await this.prisma.buildLog.create({
      data: {
        buildId,
        level: body.level,
        message: body.message,
      },
    });

    this.gateway.emitBuildLog(buildId, {
      level: body.level,
      message: body.message,
      timestamp: log.timestamp.toISOString(),
    });

    return { ok: true };
  }

  @Post(':buildId/fixes')
  @HttpCode(HttpStatus.CREATED)
  async recordFix(
    @Param('buildId') buildId: string,
    @Headers('x-worker-secret') secret: string,
    @Body()
    body: {
      attempt: number;
      description: string;
      filesModified: string[];
      errorSummary: string;
      success: boolean;
    },
  ) {
    this.authorize(secret);

    const fix = await this.prisma.buildFix.create({
      data: {
        buildId,
        attempt: body.attempt,
        errorSummary: body.errorSummary,
        fixDescription: body.description,
        filesModified: body.filesModified,
        success: body.success,
      },
    });

    this.gateway.emitFixApplied(buildId, {
      attempt: body.attempt,
      description: body.description,
      filesModified: body.filesModified,
    });

    return fix;
  }

  @Post(':buildId/apk')
  @HttpCode(HttpStatus.OK)
  async uploadApk(
    @Param('buildId') buildId: string,
    @Headers('x-worker-secret') secret: string,
    @Req() req: Request,
  ) {
    this.authorize(secret);

    const apkPath = this.storage.getApkPath(buildId);
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);

    await this.storage.saveFile(apkPath, buffer);
    const apkSize = buffer.length;

    const apkUrl = `${this.config.get('API_BASE_URL')}/files/apks/${buildId}.apk`;
    await this.prisma.build.update({
      where: { id: buildId },
      data: { apkUrl, apkSize },
    });

    return { apkUrl, apkSize };
  }
}
