import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface BuildStats {
  totalBuilds: number;
  successBuilds: number;
  failedBuilds: number;
  activeBuilds: number;
  successRate: number;
  avgDurationSec: number;
  buildsLastHour: number;
  totalCredits: number;
  mavenCacheHits: number;
  aiFixesApplied: number;
}

export interface LiveBuildItem {
  id: string;
  status: string;
  buildType: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  duration?: number;
  errorMessage?: string;
  costCredits?: number;
  runtime?: string;
  project: { id: string; name: string };
}

export interface ChartPoint {
  date: string;  // YYYY-MM-DD
  total: number;
  success: number;
  failed: number;
}

@Injectable()
export class MetricsService {
  constructor(private readonly prisma: PrismaService) {}

  async getStats(userId: string): Promise<BuildStats> {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const [total, success, failed, active, buildsLastHour, creditAgg, mavenHits, aiFixCount] =
      await Promise.all([
        this.prisma.build.count({
          where: { project: { userId } },
        }),
        this.prisma.build.count({
          where: { project: { userId }, status: 'SUCCESS' },
        }),
        this.prisma.build.count({
          where: { project: { userId }, status: { in: ['FAILED', 'TIMEOUT'] } },
        }),
        this.prisma.build.count({
          where: { project: { userId }, status: { in: ['QUEUED', 'BUILDING', 'FIXING'] } },
        }),
        this.prisma.build.count({
          where: { project: { userId }, createdAt: { gte: oneHourAgo } },
        }),
        this.prisma.build.aggregate({
          where: { project: { userId }, costCredits: { not: null } },
          _sum: { costCredits: true },
        }),
        this.prisma.build.count({
          where: { project: { userId }, mavenCacheHit: true },
        }),
        this.prisma.buildFix.count({
          where: { build: { project: { userId } }, success: true },
        }),
      ]);

    // Average duration from completed builds
    const durationAgg = await this.prisma.build.aggregate({
      where: {
        project: { userId },
        status: { in: ['SUCCESS', 'FAILED'] },
        duration: { not: null },
      },
      _avg: { duration: true },
    });

    return {
      totalBuilds:    total,
      successBuilds:  success,
      failedBuilds:   failed,
      activeBuilds:   active,
      successRate:    total > 0 ? Math.round((success / total) * 100) : 0,
      avgDurationSec: Math.round(durationAgg._avg.duration ?? 0),
      buildsLastHour,
      totalCredits:   Math.round((creditAgg._sum.costCredits ?? 0) * 100) / 100,
      mavenCacheHits: mavenHits,
      aiFixesApplied: aiFixCount,
    };
  }

  async getLiveFeed(userId: string, limit = 20): Promise<LiveBuildItem[]> {
    const builds = await this.prisma.build.findMany({
      where: { project: { userId } },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 50),
      select: {
        id:           true,
        status:       true,
        buildType:    true,
        createdAt:    true,
        startedAt:    true,
        finishedAt:   true,
        duration:     true,
        errorMessage: true,
        costCredits:  true,
        runtime:      true,
        project: { select: { id: true, name: true } },
      },
    });

    return builds.map((b) => ({
      id:           b.id,
      status:       b.status,
      buildType:    b.buildType,
      createdAt:    b.createdAt.toISOString(),
      startedAt:    b.startedAt?.toISOString(),
      finishedAt:   b.finishedAt?.toISOString(),
      duration:     b.duration ?? undefined,
      errorMessage: b.errorMessage ?? undefined,
      costCredits:  b.costCredits ?? undefined,
      runtime:      b.runtime ?? undefined,
      project:      b.project,
    }));
  }

  async getChartData(userId: string, days = 30): Promise<ChartPoint[]> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const builds = await this.prisma.build.findMany({
      where: { project: { userId }, createdAt: { gte: since } },
      select: { createdAt: true, status: true },
      orderBy: { createdAt: 'asc' },
    });

    // Group by date
    const byDate = new Map<string, { total: number; success: number; failed: number }>();

    // Pre-fill all days with zeroes so chart has no gaps
    for (let d = 0; d < days; d++) {
      const dt = new Date(since.getTime() + d * 24 * 60 * 60 * 1000);
      const key = dt.toISOString().slice(0, 10);
      byDate.set(key, { total: 0, success: 0, failed: 0 });
    }

    for (const b of builds) {
      const key = b.createdAt.toISOString().slice(0, 10);
      const entry = byDate.get(key) ?? { total: 0, success: 0, failed: 0 };
      entry.total++;
      if (b.status === 'SUCCESS') entry.success++;
      if (b.status === 'FAILED' || b.status === 'TIMEOUT') entry.failed++;
      byDate.set(key, entry);
    }

    return Array.from(byDate.entries()).map(([date, counts]) => ({ date, ...counts }));
  }
}
