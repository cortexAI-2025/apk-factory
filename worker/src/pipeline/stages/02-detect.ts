/**
 * Stage 2 — DETECT
 * Identify project type, SDK versions, Gradle configuration.
 * Produces compatibility metadata used by later stages.
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import { PipelineContext, StageResult } from '../types';

interface Versions {
  projectType: PipelineContext['projectType'];
  gradleVersion?: string;
  sdkVersion?: number;
  kotlinVersion?: string;
  hasGradleWrapper: boolean;
  mainBuildFile?: string;
  appName?: string;
  minSdkVersion?: number;
  buildToolsVersion?: string;
}

export async function stageDetect(ctx: PipelineContext): Promise<StageResult> {
  await ctx.log('info', '─── Stage 2/6: DETECT ──────────────────────────────');

  const root = ctx.projectRoot;
  const info = await detectProject(root);

  ctx.projectType = info.projectType;
  ctx.gradleVersion = info.gradleVersion;
  ctx.sdkVersion = info.sdkVersion;
  ctx.kotlinVersion = info.kotlinVersion;
  ctx.hasGradleWrapper = info.hasGradleWrapper;

  await ctx.log('info', `Project type    : ${info.projectType}`);
  await ctx.log('info', `Gradle wrapper  : ${info.hasGradleWrapper}`);
  if (info.gradleVersion) await ctx.log('info', `Gradle version  : ${info.gradleVersion}`);
  if (info.sdkVersion)    await ctx.log('info', `compileSdkVersion: ${info.sdkVersion}`);
  if (info.minSdkVersion) await ctx.log('info', `minSdkVersion   : ${info.minSdkVersion}`);
  if (info.kotlinVersion) await ctx.log('info', `Kotlin          : ${info.kotlinVersion}`);
  if (info.appName)       await ctx.log('info', `App name        : ${info.appName}`);
  if (info.buildToolsVersion) await ctx.log('info', `Build tools     : ${info.buildToolsVersion}`);

  if (info.projectType === 'UNKNOWN') {
    await ctx.log('warn', 'Could not definitively detect project type — attempting build anyway');
  }

  if (info.projectType === 'FLUTTER' || info.projectType === 'REACT_NATIVE') {
    await ctx.log('warn', `${info.projectType} detected — only Android native builds are supported in MVP`);
    return {
      ok: false,
      fatal: true,
      error: `${info.projectType} is not yet supported. Only Android Native projects are supported.`,
    };
  }

  return { ok: true };
}

async function detectProject(root: string): Promise<Versions> {
  const result: Versions = {
    projectType: 'UNKNOWN',
    hasGradleWrapper: false,
  };

  // ── Flutter ──────────────────────────────────────────────────────────────
  try {
    await fs.access(path.join(root, 'pubspec.yaml'));
    result.projectType = 'FLUTTER';
    return result;
  } catch {}

  // ── React Native ─────────────────────────────────────────────────────────
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf-8'));
    if (pkg.dependencies?.['react-native'] || pkg.devDependencies?.['react-native']) {
      result.projectType = 'REACT_NATIVE';
      return result;
    }
  } catch {}

  // ── Android Native ───────────────────────────────────────────────────────
  const gradleCandidates = [
    'app/build.gradle',
    'app/build.gradle.kts',
    'build.gradle',
    'build.gradle.kts',
  ];

  for (const rel of gradleCandidates) {
    try {
      const content = await fs.readFile(path.join(root, rel), 'utf-8');
      if (
        content.includes('android {') ||
        content.includes('com.android.application') ||
        content.includes('com.android.library')
      ) {
        result.projectType = 'ANDROID_NATIVE';
        result.mainBuildFile = rel;

        // Extract versions
        const compileSdk = content.match(/compileSdkVersion\s+(\d+)/)?.[1]
          || content.match(/compileSdk\s*=\s*(\d+)/)?.[1];
        if (compileSdk) result.sdkVersion = parseInt(compileSdk);

        const minSdk = content.match(/minSdkVersion\s+(\d+)/)?.[1]
          || content.match(/minSdk\s*=\s*(\d+)/)?.[1];
        if (minSdk) result.minSdkVersion = parseInt(minSdk);

        const buildTools = content.match(/buildToolsVersion\s+["']([\d.]+)["']/)?.[1];
        if (buildTools) result.buildToolsVersion = buildTools;

        const kotlin = content.match(/kotlin[_-]version\s*[=:]\s*["']?([\d.]+)/i)?.[1]
          || content.match(/kotlinVersion\s*=\s*["']?([\d.]+)/i)?.[1];
        if (kotlin) result.kotlinVersion = kotlin;

        break;
      }
    } catch {}
  }

  // ── Gradle Wrapper ────────────────────────────────────────────────────────
  try {
    await fs.access(path.join(root, 'gradlew'));
    result.hasGradleWrapper = true;
    const props = await fs.readFile(
      path.join(root, 'gradle', 'wrapper', 'gradle-wrapper.properties'),
      'utf-8',
    );
    const ver = props.match(/gradle-([\d.]+)-/)?.[1];
    if (ver) result.gradleVersion = ver;
  } catch {}

  // ── App name ─────────────────────────────────────────────────────────────
  try {
    const manifest = await fs.readFile(
      path.join(root, 'app', 'src', 'main', 'AndroidManifest.xml'),
      'utf-8',
    );
    const name = manifest.match(/android:label="([^"@]+)"/)?.[1];
    if (name) result.appName = name;
  } catch {}

  if (result.projectType === 'UNKNOWN') {
    // Last chance: settings.gradle?
    try {
      const s = await fs.readFile(path.join(root, 'settings.gradle'), 'utf-8');
      if (s.includes('include') || s.includes('rootProject')) {
        result.projectType = 'ANDROID_NATIVE';
      }
    } catch {}
  }

  return result;
}
