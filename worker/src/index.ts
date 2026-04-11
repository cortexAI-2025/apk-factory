import 'dotenv/config';
import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { logger } from './logger';
import { BuildExecutor } from './build-executor';

const connection = new IORedis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,
  maxRetriesPerRequest: null,
});

const executor = new BuildExecutor();

const worker = new Worker(
  'builds',
  async (job: Job) => {
    logger.info(`Processing build job ${job.id}`, { buildId: job.data.buildId });
    return executor.run(job);
  },
  {
    connection,
    concurrency: parseInt(process.env.WORKER_CONCURRENCY || '2'),
    limiter: { max: 10, duration: 60000 },
  },
);

worker.on('completed', (job) => {
  logger.info(`Job ${job.id} completed successfully`);
});

worker.on('failed', (job, err) => {
  logger.error(`Job ${job?.id} failed: ${err.message}`, { stack: err.stack });
});

worker.on('error', (err) => {
  logger.error('Worker error', { error: err.message });
});

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down worker...');
  await worker.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down worker...');
  await worker.close();
  process.exit(0);
});

logger.info('APK Factory Worker started', {
  concurrency: process.env.WORKER_CONCURRENCY || '2',
  redis: `${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || '6379'}`,
});
