import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, Job } from 'bullmq';
import IORedis from 'ioredis';

export interface BuildJobData {
  buildId: string;
  projectId: string;
  projectPath: string;
  gradleCommand: string;
  buildType: string;
  autoFix: boolean;
  userId: string;
}

@Injectable()
export class QueueService implements OnModuleInit {
  private readonly logger = new Logger(QueueService.name);
  private buildQueue: Queue;
  private connection: IORedis;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    this.connection = new IORedis({
      host: this.config.get('REDIS_HOST', 'localhost'),
      port: this.config.get('REDIS_PORT', 6379),
      password: this.config.get('REDIS_PASSWORD'),
      maxRetriesPerRequest: null,
    });

    this.buildQueue = new Queue('builds', {
      connection: this.connection,
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
        timeout: 30 * 60 * 1000, // 30 minutes max
      },
    });

    this.logger.log('Build queue initialized');
  }

  async enqueueBuild(data: BuildJobData): Promise<string> {
    const job = await this.buildQueue.add('android-build', data, {
      priority: 1,
    });
    this.logger.log(`Build job enqueued: ${job.id} for build ${data.buildId}`);
    return job.id;
  }

  async cancelJob(jobId: string): Promise<void> {
    const job = await this.buildQueue.getJob(jobId);
    if (job) {
      await job.remove();
      this.logger.log(`Job ${jobId} cancelled`);
    }
  }

  async getJobStatus(jobId: string) {
    const job = await this.buildQueue.getJob(jobId);
    if (!job) return null;
    const state = await job.getState();
    return { id: job.id, state, progress: job.progress, data: job.data };
  }

  getQueue(): Queue {
    return this.buildQueue;
  }
}
