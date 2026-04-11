/**
 * MavenCacheInjector
 *
 * Before every Docker build, injects a Gradle init script into the project
 * that redirects ALL repository declarations to the offline Maven cache.
 *
 * Result: builds run 100% offline (--network=none) and still resolve deps.
 *
 * Strategy:
 *   1. Write  .gradle/init.d/offline-cache.gradle  into the project workspace
 *   2. That init script adds the local cache as a first-priority repo
 *      and, if MAVEN_OFFLINE=true, removes all remote repos entirely
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '../logger';

const CACHE_CONTAINER_PATH = '/maven-cache'; // inside the build container
const INIT_SCRIPT_FILENAME  = 'apk-factory-offline.gradle';

export class MavenCacheInjector {
  private readonly cacheHostPath: string;
  private readonly offlineMode: boolean;

  constructor() {
    this.cacheHostPath = process.env.MAVEN_CACHE_DIR || '/opt/apk-factory/maven-cache';
    this.offlineMode   = process.env.MAVEN_OFFLINE !== 'false'; // default: true
  }

  /** Check whether the offline cache volume actually exists and has content. */
  async isCacheAvailable(): Promise<boolean> {
    try {
      const stat  = await fs.stat(this.cacheHostPath);
      if (!stat.isDirectory()) return false;
      const items = await fs.readdir(this.cacheHostPath);
      return items.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Write the Gradle init script into the project workspace.
   * Call this just before starting the Docker container.
   *
   * @param projectRoot  Host path of the project (bind-mounted as /workspace)
   */
  async inject(projectRoot: string): Promise<void> {
    const initDir = path.join(projectRoot, '.gradle', 'init.d');
    await fs.mkdir(initDir, { recursive: true });

    const scriptPath = path.join(initDir, INIT_SCRIPT_FILENAME);
    const content    = this.buildInitScript();

    await fs.writeFile(scriptPath, content, 'utf-8');
    logger.info(`[maven] Init script injected → ${scriptPath}`);
  }

  /** Remove the injected init script after the build. */
  async cleanup(projectRoot: string): Promise<void> {
    const scriptPath = path.join(
      projectRoot, '.gradle', 'init.d', INIT_SCRIPT_FILENAME,
    );
    await fs.unlink(scriptPath).catch(() => {});
  }

  /**
   * Returns the Docker volume mount argument for the Maven cache.
   * e.g.  "--volume /opt/apk-factory/maven-cache:/maven-cache:ro"
   */
  volumeMount(): string[] {
    return ['--volume', `${this.cacheHostPath}:${CACHE_CONTAINER_PATH}:ro`];
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private buildInitScript(): string {
    const repoDeclaration = `
        maven {
            url "file://${CACHE_CONTAINER_PATH}"
            metadataSources {
                mavenPom()
                artifact()
                ignoreGradleMetadataRedirection()
            }
        }`;

    const offlineBlock = this.offlineMode
      ? `
    // Remove ALL remote repositories — enforce 100% offline
    // Any dep not in the local cache will fail fast rather than hang
    configurations.all {
        resolutionStrategy.cacheChangingModulesFor 0, 'seconds'
        resolutionStrategy.cacheDynamicVersionsFor  0, 'seconds'
    }
    repositories.removeIf { repo ->
        repo instanceof MavenArtifactRepository &&
        !repo.url.scheme.startsWith("file")
    }`
      : '';

    return `// ─────────────────────────────────────────────────────────────────
// APK Factory — Offline Maven Cache Init Script (auto-generated)
// Injects the local artifact cache as first-priority repository.
// ─────────────────────────────────────────────────────────────────
allprojects {
    buildscript {
        repositories {
            first {${repoDeclaration}
            }
        }
    }
    repositories {
        first {${repoDeclaration}
        }
    }
${offlineBlock}
}

// Also apply to settings-level plugin repositories (Gradle 7+)
settingsEvaluated { settings ->
    settings.pluginManagement {
        repositories {
            first {${repoDeclaration}
            }
        }
    }
    settings.dependencyResolutionManagement {
        repositories {
            first {${repoDeclaration}
            }
        }
    }
}
`;
  }
}
