import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

const ACTIVE_STATUSES = ['PENDING', 'QUEUED', 'BUILDING', 'FIXING'] as const;

/**
 * Data lifecycle — implements the retention / deletion promises of the privacy policy:
 *   - build artifacts (APK/AAB, QR codes) and project sources are purged after
 *     RETENTION_HOURS (default 24h) of inactivity
 *   - users can delete their build history + files, or their whole account
 */
@Injectable()
export class LifecycleService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LifecycleService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    if (this.config.get('RETENTION_ENABLED', 'true') === 'false') return;
    const everyMs = parseInt(this.config.get('RETENTION_SWEEP_MINUTES', '30'), 10) * 60_000;
    this.timer = setInterval(() => this.sweep().catch((e) => this.logger.error(e.message)), everyMs);
    this.timer.unref();
    setTimeout(() => this.sweep().catch((e) => this.logger.error(e.message)), 15_000).unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private get retentionMs(): number {
    return parseFloat(this.config.get('RETENTION_HOURS', '24')) * 3_600_000;
  }

  /** Purge expired artifacts and idle project sources. Returns counts. */
  async sweep(now = new Date()): Promise<{ artifacts: number; sources: number }> {
    const cutoff = new Date(now.getTime() - this.retentionMs);

    const builds = await this.prisma.build.findMany({
      where: { apkUrl: { not: null }, finishedAt: { lt: cutoff } },
      select: { id: true },
    });
    for (const b of builds) await this.purgeBuildArtifacts(b.id);

    const projects = await this.prisma.project.findMany({
      where: {
        sourcePath: { not: null },
        createdAt: { lt: cutoff },
        builds: {
          none: {
            OR: [{ createdAt: { gte: cutoff } }, { status: { in: [...ACTIVE_STATUSES] } }],
          },
        },
      },
      select: { id: true },
    });
    for (const p of projects) {
      await this.storage.deleteDir(this.storage.getProjectDir(p.id));
      await this.prisma.project.update({ where: { id: p.id }, data: { sourcePath: null } });
    }

    if (builds.length || projects.length) {
      this.logger.log(`Retention sweep: ${builds.length} artifact(s), ${projects.length} source dir(s) purged`);
    }
    return { artifacts: builds.length, sources: projects.length };
  }

  /** Delete the APK/AAB + QR files of a build and clear the links in the DB. */
  async purgeBuildArtifacts(buildId: string): Promise<void> {
    await this.storage.deleteFile(this.storage.getApkPath(buildId, '.apk'));
    await this.storage.deleteFile(this.storage.getApkPath(buildId, '.aab'));
    await this.storage.deleteFile(path.join(this.storage.uploadsPath, 'qr', `${buildId}.png`));
    await this.prisma.build
      .update({
        where: { id: buildId },
        data: {
          apkUrl: null, apkPath: null, publicLink: null, publicLinkExpiry: null, qrCodeUrl: null,
        },
      })
      .catch(() => {});
  }

  /** Delete a project: its source dir, all build artifacts, then the DB rows. */
  async deleteProject(projectId: string): Promise<void> {
    const builds = await this.prisma.build.findMany({ where: { projectId }, select: { id: true } });
    for (const b of builds) await this.purgeBuildArtifacts(b.id);
    await this.storage.deleteDir(this.storage.getProjectDir(projectId));
    await this.prisma.project.delete({ where: { id: projectId } }).catch(() => {});
  }

  /** Delete all of a user's projects, builds, logs, fixes and files (and optionally the account). */
  async deleteUserData(userId: string, deleteAccount: boolean) {
    const projects = await this.prisma.project.findMany({ where: { userId }, select: { id: true } });
    for (const p of projects) await this.deleteProject(p.id);
    // Keystores uploaded by the user (if any) live under keystores/<userId>
    await this.storage.deleteDir(path.join(this.storage.uploadsPath, 'keystores', userId));

    if (deleteAccount) {
      await this.prisma.user.delete({ where: { id: userId } });
    } else {
      await this.prisma.user.update({ where: { id: userId }, data: { buildsUsed: 0 } });
    }
    return { deletedProjects: projects.length, accountDeleted: deleteAccount };
  }
}
