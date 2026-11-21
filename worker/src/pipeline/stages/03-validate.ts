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
const MAX_SUPPORTED_SDK = 37;

const JS_FRAMEWORKS = new Set(['REACT_NATIVE_CLI', 'EXPO_MANAGED', 'EXPO_BARE']);

export async function stageValidate(ctx: PipelineContext): Promise<StageResult> {
  await ctx.log('info', '─── Stage 3/6: VALIDATE ────────────────────────────');

  if (ctx.framework === 'FLUTTER') return stageValidateFlutter(ctx);
  if (ctx.framework === 'CAPACITOR') return stageValidateCapacitor(ctx);
  if (ctx.framework === 'CORDOVA') return stageValidateCordova(ctx);
  if (ctx.framework && JS_FRAMEWORKS.has(ctx.framework)) return stageValidateJs(ctx);
  return stageValidateAndroidNative(ctx);
}

async function stageValidateFlutter(ctx: PipelineContext): Promise<StageResult> {
  const root = ctx.projectRoot;
  try {
    await fs.access(path.join(root, 'pubspec.yaml'));
    await ctx.log('info', '✓ pubspec.yaml found');
  } catch {
    return { ok: false, fatal: true, error: 'pubspec.yaml not found — not a Flutter project' };
  }
  try {
    await fs.access(path.join(root, 'android', 'gradlew'));
    await ctx.log('info', '✓ android/gradlew found');
  } catch {
    await ctx.log('info', 'android/ not generated yet — flutter create will add it during BUILD');
  }
  ctx.gradleCommand = resolveGradleCommand(ctx.buildType, true);
  await ctx.log('info', `Validation passed — Flutter will run: ${ctx.buildType}`);
  return { ok: true };
}

async function stageValidateCapacitor(ctx: PipelineContext): Promise<StageResult> {
  const root = ctx.projectRoot;
  const errors: string[] = [];
  try {
    await fs.access(path.join(root, 'package.json'));
    await ctx.log('info', '✓ package.json found');
  } catch {
    errors.push('package.json not found at project root');
  }
  const config = ['capacitor.config.ts', 'capacitor.config.js', 'capacitor.config.json'];
  let found = false;
  for (const name of config) {
    try {
      await fs.access(path.join(root, name));
      found = true;
      await ctx.log('info', `✓ ${name} found`);
      break;
    } catch { /* next */ }
  }
  if (!found) errors.push('capacitor.config.ts/js/json not found');
  await warnIfLockfileMissing(ctx, root);
  if (errors.length) return { ok: false, fatal: true, error: errors.join('; ') };
  ctx.gradleCommand = resolveGradleCommand(ctx.buildType, true);
  await ctx.log('info', `Validation passed — Capacitor Gradle task from ${ctx.gradleRoot || 'android'}/`);
  return { ok: true };
}

async function stageValidateCordova(ctx: PipelineContext): Promise<StageResult> {
  const root = ctx.projectRoot;
  try {
    const xml = await fs.readFile(path.join(root, 'config.xml'), 'utf-8');
    if (!/<widget[\s>]/.test(xml)) {
      return { ok: false, fatal: true, error: 'config.xml does not contain a Cordova <widget>' };
    }
    await ctx.log('info', '✓ config.xml Cordova widget found');
  } catch {
    return { ok: false, fatal: true, error: 'config.xml not found — not a Cordova project' };
  }
  try {
    await fs.access(path.join(root, 'package.json'));
    await ctx.log('info', '✓ package.json found');
  } catch {
    await ctx.log('warn', '⚠ package.json missing — cordova platform add may fail without a local CLI');
  }
  await warnIfLockfileMissing(ctx, root);
  ctx.gradleCommand = resolveGradleCommand(ctx.buildType, true);
  await ctx.log('info', 'Validation passed — Cordova Android build');
  return { ok: true };
}

async function warnIfLockfileMissing(ctx: PipelineContext, root: string): Promise<void> {
  const lockfiles: Record<string, string> = { npm: 'package-lock.json', yarn: 'yarn.lock', pnpm: 'pnpm-lock.yaml' };
  const expected = ctx.packageManager ? lockfiles[ctx.packageManager] : undefined;
  if (!expected) return;
  try {
    await fs.access(path.join(root, expected));
    await ctx.log('info', `✓ ${expected} found`);
  } catch {
    await ctx.log('warn', `⚠ ${expected} missing — dependencies will be resolved with a non-frozen install`);
  }
}

/**
 * React Native CLI / Expo: package.json + lockfile must be reproducible.
 * gradlew is NOT required yet for Expo managed (expo prebuild generates it
 * during BUILD); React Native CLI must already have committed android/, so
 * its gradlew is required here.
 */
async function stageValidateJs(ctx: PipelineContext): Promise<StageResult> {
  const root = ctx.projectRoot;
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    await fs.access(path.join(root, 'package.json'));
    await ctx.log('info', '✓ package.json found');
  } catch {
    errors.push('package.json not found at project root');
    await ctx.log('error', '✗ package.json not found');
  }

  const lockfiles: Record<string, string> = { npm: 'package-lock.json', yarn: 'yarn.lock', pnpm: 'pnpm-lock.yaml' };
  const expectedLockfile = ctx.packageManager ? lockfiles[ctx.packageManager] : undefined;
  if (expectedLockfile) {
    try {
      await fs.access(path.join(root, expectedLockfile));
      await ctx.log('info', `✓ ${expectedLockfile} found (reproducible install: ${ctx.packageManager} ci)`);
    } catch {
      errors.push(`${expectedLockfile} not found — a lockfile is required for a reproducible install`);
      await ctx.log('error', `✗ ${expectedLockfile} not found`);
    }
  }

  if (ctx.framework === 'REACT_NATIVE_CLI') {
    const gradleRoot = ctx.gradleRoot || 'android';
    try {
      await fs.access(path.join(root, gradleRoot, 'gradlew'));
      await fs.chmod(path.join(root, gradleRoot, 'gradlew'), 0o755);
      await ctx.log('info', `✓ ${gradleRoot}/gradlew found and made executable`);
    } catch {
      errors.push(`${gradleRoot}/gradlew not found — React Native CLI projects must commit their android/ wrapper`);
      await ctx.log('error', `✗ ${gradleRoot}/gradlew not found`);
    }
  } else {
    await ctx.log('info', ctx.buildSystemInfo?.androidGenerated
      ? `✓ android/ already present — expo prebuild will be skipped`
      : 'android/ not present yet — expo prebuild will generate it during BUILD');
    await validateExpoConfig(ctx, root, warnings);
  }

  for (const w of warnings) await ctx.log('warn', `⚠ ${w}`);
  if (errors.length > 0) return { ok: false, fatal: true, error: errors.join('; ') };

  ctx.gradleCommand = resolveGradleCommand(ctx.buildType, true);
  await ctx.log('info', `Gradle command: ${ctx.gradleCommand} (run from ${ctx.gradleRoot || 'android'}/ after install${ctx.framework !== 'REACT_NATIVE_CLI' ? '/prebuild' : ''})`);
  await ctx.log('info', `Validation passed (${warnings.length} warning(s))`);
  return { ok: true };
}

/**
 * Soft validation of the Expo config (app.json's "expo" key): a missing
 * android.package only warns, since `expo prebuild` fills in a default from
 * the project slug — but that default is rarely what should ship to Play
 * Store, so surface it explicitly rather than silently building with it.
 * app.config.js/.ts is not statically parsed here (arbitrary JS) — its
 * presence alone was already enough for 02-detect.ts to classify the
 * framework as Expo.
 */
async function validateExpoConfig(ctx: PipelineContext, root: string, warnings: string[]): Promise<void> {
  const appJsonRaw = await fs.readFile(path.join(root, 'app.json'), 'utf-8').catch(() => null);
  if (!appJsonRaw) return; // app.config.js/ts in use instead — nothing to statically check

  let expoConfig: any;
  try {
    expoConfig = JSON.parse(appJsonRaw)?.expo;
  } catch {
    warnings.push('app.json is not valid JSON — expo prebuild will fail to read it');
    await ctx.log('warn', '⚠ app.json is not valid JSON');
    return;
  }
  if (!expoConfig) return;

  if (!expoConfig.android?.package) {
    warnings.push('app.json has no expo.android.package — expo prebuild will derive a default from the slug, unlikely to be the intended Play Store applicationId');
    await ctx.log('warn', '⚠ expo.android.package not set in app.json');
  } else {
    await ctx.log('info', `✓ expo.android.package: ${expoConfig.android.package}`);
  }
}

async function stageValidateAndroidNative(ctx: PipelineContext): Promise<StageResult> {
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
