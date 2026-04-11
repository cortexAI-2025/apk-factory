/**
 * Stage 3 — VALIDATE
 * Check that the project structure is buildable:
 *   - gradlew present and executable
 *   - build.gradle (or .kts) present
 *   - AndroidManifest.xml accessible
 *   - No obviously broken SDK version constraints
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import { PipelineContext, StageResult } from '../types';

const MIN_SUPPORTED_SDK = 16;
const MAX_SUPPORTED_SDK = 35;

export async function stageValidate(ctx: PipelineContext): Promise<StageResult> {
  await ctx.log('info', '─── Stage 3/6: VALIDATE ────────────────────────────');

  const root = ctx.projectRoot;
  const errors: string[] = [];
  const warnings: string[] = [];

  // ── 1. gradlew ────────────────────────────────────────────────────────────
  const gradlewPath = path.join(root, 'gradlew');
  let hasWrapper = false;
  try {
    await fs.access(gradlewPath);
    await fs.chmod(gradlewPath, 0o755);
    hasWrapper = true;
    await ctx.log('info', '✓ gradlew found and made executable');
  } catch {
    errors.push('gradlew not found — cannot run Gradle build without wrapper');
    await ctx.log('error', '✗ gradlew not found');
  }

  // ── 2. gradle-wrapper.properties ─────────────────────────────────────────
  if (hasWrapper) {
    const wrapperProps = path.join(root, 'gradle', 'wrapper', 'gradle-wrapper.properties');
    try {
      await fs.access(wrapperProps);
      await ctx.log('info', '✓ gradle-wrapper.properties found');
    } catch {
      warnings.push('gradle-wrapper.properties missing — Gradle may download or fail');
      await ctx.log('warn', '⚠ gradle-wrapper.properties not found');
    }
  }

  // ── 3. Root build.gradle ──────────────────────────────────────────────────
  const rootBuildFiles = ['build.gradle', 'build.gradle.kts'];
  let rootBuildFound = false;
  for (const f of rootBuildFiles) {
    try {
      await fs.access(path.join(root, f));
      rootBuildFound = true;
      await ctx.log('info', `✓ ${f} found at project root`);
      break;
    } catch {}
  }
  if (!rootBuildFound) {
    errors.push('No build.gradle / build.gradle.kts found at project root');
    await ctx.log('error', '✗ Root build.gradle not found');
  }

  // ── 4. App module build.gradle ───────────────────────────────────────────
  const appBuildFiles = ['app/build.gradle', 'app/build.gradle.kts'];
  let appBuildContent = '';
  let appBuildFound = false;
  for (const f of appBuildFiles) {
    try {
      appBuildContent = await fs.readFile(path.join(root, f), 'utf-8');
      appBuildFound = true;
      await ctx.log('info', `✓ ${f} found`);
      break;
    } catch {}
  }
  if (!appBuildFound) {
    warnings.push('app/build.gradle not found — single-module project?');
    await ctx.log('warn', '⚠ app/build.gradle not found (may be single-module)');
  }

  // ── 5. AndroidManifest.xml ────────────────────────────────────────────────
  try {
    await fs.access(path.join(root, 'app', 'src', 'main', 'AndroidManifest.xml'));
    await ctx.log('info', '✓ AndroidManifest.xml found');
  } catch {
    warnings.push('AndroidManifest.xml not found at standard path');
    await ctx.log('warn', '⚠ AndroidManifest.xml not found at app/src/main/');
  }

  // ── 6. SDK version sanity checks ─────────────────────────────────────────
  if (appBuildContent) {
    const compileSdkMatch = appBuildContent.match(/compileSdkVersion\s+(\d+)/)?.[1]
      || appBuildContent.match(/compileSdk\s*=\s*(\d+)/)?.[1];
    const minSdkMatch = appBuildContent.match(/minSdkVersion\s+(\d+)/)?.[1]
      || appBuildContent.match(/minSdk\s*=\s*(\d+)/)?.[1];
    const targetSdkMatch = appBuildContent.match(/targetSdkVersion\s+(\d+)/)?.[1]
      || appBuildContent.match(/targetSdk\s*=\s*(\d+)/)?.[1];

    if (compileSdkMatch) {
      const sdk = parseInt(compileSdkMatch);
      if (sdk < MIN_SUPPORTED_SDK) {
        warnings.push(`compileSdkVersion ${sdk} is very old (min supported: ${MIN_SUPPORTED_SDK})`);
      } else if (sdk > MAX_SUPPORTED_SDK) {
        warnings.push(`compileSdkVersion ${sdk} may require a newer Android SDK than available (max: ${MAX_SUPPORTED_SDK})`);
      } else {
        await ctx.log('info', `✓ compileSdkVersion ${sdk} is within supported range`);
      }
    }

    if (minSdkMatch && targetSdkMatch) {
      const min = parseInt(minSdkMatch);
      const target = parseInt(targetSdkMatch);
      if (min > target) {
        errors.push(`minSdkVersion (${min}) > targetSdkVersion (${target}) — invalid configuration`);
        await ctx.log('error', `✗ minSdkVersion ${min} > targetSdkVersion ${target}`);
      }
    }
  }

  // ── 7. settings.gradle ────────────────────────────────────────────────────
  try {
    await fs.access(path.join(root, 'settings.gradle'));
    await ctx.log('info', '✓ settings.gradle found');
  } catch {
    try {
      await fs.access(path.join(root, 'settings.gradle.kts'));
      await ctx.log('info', '✓ settings.gradle.kts found');
    } catch {
      warnings.push('settings.gradle not found');
      await ctx.log('warn', '⚠ settings.gradle not found');
    }
  }

  // ── Resolve Gradle command ────────────────────────────────────────────────
  ctx.gradleCommand = resolveGradleCommand(ctx.buildType, hasWrapper);
  await ctx.log('info', `Gradle command: ${ctx.gradleCommand}`);

  // ── Result ────────────────────────────────────────────────────────────────
  for (const w of warnings) {
    await ctx.log('warn', `⚠ ${w}`);
  }

  if (errors.length > 0) {
    return { ok: false, fatal: true, error: errors.join('; ') };
  }

  await ctx.log('info', `Validation passed (${warnings.length} warning(s))`);
  return { ok: true };
}

function resolveGradleCommand(buildType: 'DEBUG' | 'RELEASE' | 'AAB', hasWrapper: boolean): string {
  const exe = hasWrapper ? './gradlew' : 'gradle';
  switch (buildType) {
    case 'RELEASE': return `${exe} assembleRelease`;
    case 'AAB':     return `${exe} bundleRelease`;
    default:        return `${exe} assembleDebug`;
  }
}
