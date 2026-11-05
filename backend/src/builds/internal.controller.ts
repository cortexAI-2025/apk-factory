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
import { createWriteStream } from 'fs';
import { createHash, randomUUID, timingSafeEqual } from 'crypto';
import { BadRequestException, ConflictException, NotFoundException, PayloadTooLargeException, Query } from '@nestjs/common';

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
    const expected = this.config.get<string>('WORKER_SECRET');
    // Fail closed: no default secret. The endpoint stays unusable until configured.
    if (!expected || typeof secret !== 'string') throw new UnauthorizedException('Invalid worker secret');
    const a = Buffer.from(secret);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedException('Invalid worker secret');
  }

  @Patch(':buildId/status')
  @HttpCode(HttpStatus.OK)
  async updateStatus(
    @Param('buildId') buildId: string,
    @Headers('x-worker-secret') secret: string,
    @Body()
    body: {
      status: string;
      apkUrl?: string;
      apkSize?: number;
      errorMessage?: string;
      runtime?: string;
      mavenCacheHit?: boolean;
      autoFixAttempts?: number;
    },
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

    // Compute billable CPU-seconds and credit cost on terminal states
    const CREDIT_RATE  = 0.001; // 1 credit per 1000 cpu-seconds
    const cpuCount     = parseFloat(this.config.get('BUILD_CPUS', '2'));
    const cpuSeconds   = duration !== undefined ? duration * cpuCount : undefined;
    const costCredits  = cpuSeconds !== undefined
      ? Math.round(cpuSeconds * CREDIT_RATE * 1000) / 1000
      : undefined;

    const updated = await this.prisma.build.update({
      where: { id: buildId },
      data: {
        status: body.status as any,
        apkUrl: body.apkUrl,
        apkSize: body.apkSize,
        errorMessage: body.errorMessage,
        ...(body.runtime ? { runtime: body.runtime } : {}),
        ...(body.autoFixAttempts ? { autoFixAttempts: body.autoFixAttempts } : {}),
        ...(body.mavenCacheHit !== undefined ? { mavenCacheHit: body.mavenCacheHit } : {}),
        ...(body.status === 'BUILDING' && !build?.startedAt ? { startedAt: now } : {}),
        ...(['SUCCESS', 'FAILED', 'CANCELLED', 'TIMEOUT'].includes(body.status)
          ? { finishedAt: now, duration, cpuSeconds, costCredits }
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
      patches?: any[];
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
        patches: body.patches || [],
      },
    });

    this.gateway.emitFixApplied(buildId, {
      attempt: body.attempt,
      description: body.description,
      filesModified: body.filesModified,
    });

    return fix;
  }

  /**
   * Receives one build artifact as a raw byte stream. The SHA-256 and size are
   * computed here (never trusted from the worker), the file is stored under an
   * opaque id, and only the build owner can later download it.
   */
  @Post(':buildId/artifacts')
  @HttpCode(HttpStatus.CREATED)
  async uploadArtifact(
    @Param('buildId') buildId: string,
    @Headers('x-worker-secret') secret: string,
    @Query() q: Record<string, string>,
    @Req() req: Request,
  ) {
    this.authorize(secret);

    const build = await this.prisma.build.findUnique({ where: { id: buildId } });
    if (!build) throw new NotFoundException('Build not found');
    if (!['BUILDING', 'FIXING', 'QUEUED'].includes(build.status)) {
      throw new ConflictException('Build is not accepting artifacts');
    }

    const allowRelease = this.config.get('ENABLE_RELEASE_BUILDS') === 'true';
    const m = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.(apk|aab)$/.exec(q.fileName || '');
    if (!m || (m[1] === 'aab' && !allowRelease)) throw new BadRequestException('Invalid artifact file name');
    const variant = /^[A-Za-z0-9_-]{1,60}$/.test(q.variant || '') ? q.variant : 'debug';
    const abi = ['universal', 'arm64-v8a', 'armeabi-v7a', 'x86_64', 'x86'].includes(q.abi) ? q.abi : 'universal';
    const moduleName = /^[A-Za-z0-9_./-]{0,80}$/.test(q.module || '') ? q.module || '' : '';
    const recommended = q.recommended === 'true';
    const expectedSha = /^[a-f0-9]{64}$/.test(q.sha256 || '') ? q.sha256 : undefined;

    const maxBytes = parseInt(this.config.get('ARTIFACT_MAX_MB', '200'), 10) * 1024 * 1024;
    const artifactId = randomUUID();
    const target = this.storage.getArtifactPath(buildId, artifactId, `.${m[1]}`);
    await fs.mkdir(this.storage.getArtifactDir(buildId), { recursive: true });

    // stream to disk, hashing and counting as we go
    const hash = createHash('sha256');
    let size = 0;
    try {
      await new Promise<void>((resolve, reject) => {
        const out = createWriteStream(target, { flags: 'wx', mode: 0o640 });
        req.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            reject(new PayloadTooLargeException('Artifact exceeds the size limit'));
            req.destroy();
            out.destroy();
            return;
          }
          hash.update(chunk);
        });
        req.on('error', reject);
        out.on('error', reject);
        out.on('finish', resolve);
        req.pipe(out);
      });
    } catch (err) {
      await fs.rm(target, { force: true });
      throw err;
    }

    const sha256 = hash.digest('hex');
    if (size === 0 || (expectedSha && expectedSha !== sha256)) {
      await fs.rm(target, { force: true });
      throw new BadRequestException(size === 0 ? 'Empty artifact' : 'Checksum mismatch');
    }

    const artifact = await this.prisma.buildArtifact.create({
      data: {
        id: artifactId, buildId, fileName: m[0], variant, abi, module: moduleName,
        sizeBytes: size, sha256, recommended, storagePath: target,
      },
    });

    const apkUrl = `${this.config.get('API_BASE_URL')}/api/v1/projects/${build.projectId}/builds/${buildId}/artifacts/${artifactId}/download`;
    if (recommended) {
      await this.prisma.build.update({ where: { id: buildId }, data: { apkUrl, apkSize: size } });
    }
    return { id: artifact.id, apkUrl, apkSize: size, sha256 };
  }
}
