/**
 * BuildExecutor — thin adapter between BullMQ and the build pipeline.
 *
 * Receives the raw job payload, resolves source paths, and hands off
 * execution to the pipeline orchestrator.
 */
import { Job } from 'bullmq';
import * as path from 'path';
import { logger } from './logger';
import { runPipeline } from './pipeline/index';

export interface BuildJobData {
  buildId:       string;
  projectId:     string;
  userId:        string;
  projectPath:   string;    // root path of already-extracted project (or zip path)
  gradleCommand: string;    // e.g. './gradlew assembleDebug'
  buildType:     string;    // DEBUG | RELEASE | AAB
  autoFix:       boolean;
  sourceZipPath?: string;   // set when source comes from a ZIP upload
}

export class BuildExecutor {
  async run(job: Job<BuildJobData>): Promise<void> {
    const { buildId, projectId, userId, projectPath, buildType, autoFix, sourceZipPath } = job.data;

    logger.info(`[${buildId}] BuildExecutor.run — type=${buildType} autoFix=${autoFix}`);

    // Determine whether we're working with a zip or an already-extracted dir
    const isZipPath = sourceZipPath || projectPath?.endsWith('.zip');

    await runPipeline(
      {
        buildId,
        projectId,
        userId,
        sourceZipPath: isZipPath ? (sourceZipPath || projectPath) : undefined,
        sourceRepoPath: isZipPath ? undefined : projectPath,
        buildType: buildType as 'DEBUG' | 'RELEASE' | 'AAB',
        autoFix,
      },
      job,
    );
  }
}
