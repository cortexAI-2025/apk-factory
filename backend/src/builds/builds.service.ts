import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import { StorageService } from '../storage/storage.service';
import { CreateBuildDto } from './dto/create-build.dto';
import { BuildStatus, BuildType } from '@prisma/client';
import * as QRCode from 'qrcode';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';

@Injectable()
export class BuildsService {
  private readonly logger = new Logger(BuildsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly storage: StorageService,
  ) {}

  async create(userId: string, projectId: string, dto: CreateBuildDto) {
    // Verify project ownership
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project not found');
    if (project.userId !== userId) throw new ForbiddenException();

    // Check build limits for free plan
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (user.plan === 'FREE' && user.buildsUsed >= user.buildsLimit) {
      throw new BadRequestException(
        `Build limit reached (${user.buildsLimit} builds on Free plan). Upgrade to Pro for unlimited builds.`,
      );
    }

    const gradleCmd = this.resolveGradleCommand(dto.buildType);

    const build = await this.prisma.build.create({
      data: {
        projectId,
        buildType: dto.buildType,
        gradleCommand: gradleCmd,
        environment: { autoFix: dto.autoFix ?? true },
      },
    });

    // Enqueue build job
    const jobId = await this.queue.enqueueBuild({
      buildId: build.id,
      projectId,
      projectPath: project.sourcePath,
      gradleCommand: gradleCmd,
      buildType: dto.buildType,
      autoFix: dto.autoFix ?? true,
      userId,
    });

    // Increment builds used counter
    await this.prisma.user.update({
      where: { id: userId },
      data: { buildsUsed: { increment: 1 } },
    });

    return this.prisma.build.update({
      where: { id: build.id },
      data: { status: BuildStatus.QUEUED, queueJobId: jobId },
    });
  }

  async findAll(userId: string, projectId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project not found');
    if (project.userId !== userId) throw new ForbiddenException();

    return this.prisma.build.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      include: {
        fixes: { orderBy: { attempt: 'asc' } },
        _count: { select: { logs: true } },
      },
    });
  }

  async findOne(userId: string, buildId: string) {
    const build = await this.prisma.build.findUnique({
      where: { id: buildId },
      include: {
        project: { select: { id: true, name: true, userId: true } },
        fixes: { orderBy: { attempt: 'asc' } },
        _count: { select: { logs: true } },
      },
    });

    if (!build) throw new NotFoundException('Build not found');
    if (build.project.userId !== userId) throw new ForbiddenException();
    return build;
  }

  async getLogs(userId: string, buildId: string, offset = 0, limit = 500) {
    const build = await this.prisma.build.findUnique({
      where: { id: buildId },
      include: { project: { select: { userId: true } } },
    });

    if (!build) throw new NotFoundException('Build not found');
    if (build.project.userId !== userId) throw new ForbiddenException();

    const logs = await this.prisma.buildLog.findMany({
      where: { buildId },
      orderBy: { timestamp: 'asc' },
      skip: offset,
      take: Math.min(limit, 1000),
    });

    const total = await this.prisma.buildLog.count({ where: { buildId } });
    return { logs, total, offset, limit };
  }

  async generatePublicLink(userId: string, buildId: string) {
    const build = await this.findOne(userId, buildId);

    if (build.status !== BuildStatus.SUCCESS) {
      throw new BadRequestException('Build must be successful to generate a public link');
    }

    const token = uuidv4().replace(/-/g, '');
    const expiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    const publicLink = `${process.env.API_BASE_URL}/api/v1/download/${token}`;

    // Generate QR code
    const qrDataUrl = await QRCode.toDataURL(publicLink, { width: 300 });
    const qrPath = path.join(
      process.env.UPLOADS_PATH || 'uploads',
      'qr',
      `${buildId}.png`,
    );

    const qrBuffer = Buffer.from(qrDataUrl.split(',')[1], 'base64');
    await this.storage.saveFile(qrPath, qrBuffer);

    const qrUrl = `${process.env.API_BASE_URL}/files/qr/${buildId}.png`;

    return this.prisma.build.update({
      where: { id: buildId },
      data: {
        publicLink,
        publicLinkExpiry: expiry,
        qrCodeUrl: qrUrl,
      },
      select: { publicLink: true, publicLinkExpiry: true, qrCodeUrl: true },
    });
  }

  async cancel(userId: string, buildId: string) {
    const build = await this.findOne(userId, buildId);

    if (![BuildStatus.PENDING, BuildStatus.QUEUED, BuildStatus.BUILDING].includes(build.status)) {
      throw new BadRequestException('Cannot cancel a build that is not in progress');
    }

    if (build.queueJobId) {
      await this.queue.cancelJob(build.queueJobId);
    }

    return this.prisma.build.update({
      where: { id: buildId },
      data: { status: BuildStatus.CANCELLED },
    });
  }

  private resolveGradleCommand(buildType: BuildType): string {
    switch (buildType) {
      case BuildType.DEBUG:
        return './gradlew assembleDebug';
      case BuildType.RELEASE:
        return './gradlew assembleRelease';
      case BuildType.AAB:
        return './gradlew bundleRelease';
      default:
        return './gradlew assembleDebug';
    }
  }
}
