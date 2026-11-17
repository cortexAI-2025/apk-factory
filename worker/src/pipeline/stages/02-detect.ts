/**
 * Stage 2 — DETECT
 * Identify project framework, package manager and SDK versions using the
 * multi-signal framework-detector. Produces compatibility metadata used by
 * later stages and selects which build engine (05-build.ts) will run.
 */
import { PipelineContext, StageResult } from '../types';
import { detectFramework, mapFrameworkToProjectType } from '../../detection/framework-detector';
import { Framework } from '../../detection/types';

const MIN_CONFIDENCE = 0.5;

// Frameworks with an implemented build engine (worker/src/engines/). Everything
// else is detected but rejected with an explicit, distinct message — never
// silently attempted and never confused with "ambiguous detection".
const ENGINE_SUPPORTED: Record<Framework, boolean> = {
  ANDROID_NATIVE: true,
  REACT_NATIVE_CLI: true,
  EXPO_MANAGED: true,
  EXPO_BARE: true,
  CAPACITOR: false,
  VITE_WEB: false,
  NEXTJS_WEB: false,
  FLUTTER: false,
  UNKNOWN: false,
};

export async function stageDetect(ctx: PipelineContext): Promise<StageResult> {
  await ctx.log('info', '─── Stage 2/6: DETECT ──────────────────────────────');

  const result = await detectFramework(ctx.projectRoot);

  ctx.framework = result.framework;
  ctx.frameworkConfidence = result.confidence;
  ctx.frameworkSignals = result.signals.map((s) => `[${s.framework}] ${s.source} (+${s.weight})`);
  ctx.packageManager = result.packageManager;
  ctx.frameworkVersions = result.versions;
  ctx.buildSystemInfo = result.buildSystem;
  ctx.gradleRoot = result.buildSystem.gradleRoot;
  ctx.hasGradleWrapper = result.buildSystem.hasGradleWrapper;
  ctx.gradleVersion = result.versions.gradle;
  ctx.sdkVersion = result.versions.compileSdk;
  ctx.kotlinVersion = result.versions.kotlin;
  ctx.projectType = mapFrameworkToProjectType(result.framework);

  await ctx.log('info', `Framework        : ${result.framework} (confidence ${(result.confidence * 100).toFixed(0)}%)`);
  await ctx.log('info', `Package manager  : ${result.packageManager ?? 'n/a'}`);
  if (result.versions.gradle)    await ctx.log('info', `Gradle version   : ${result.versions.gradle}`);
  if (result.versions.kotlin)    await ctx.log('info', `Kotlin version   : ${result.versions.kotlin}`);
  if (result.versions.agp)       await ctx.log('info', `AGP version      : ${result.versions.agp}`);
  if (result.versions.compileSdk) await ctx.log('info', `compileSdkVersion: ${result.versions.compileSdk}`);
  if (result.versions.minSdk)    await ctx.log('info', `minSdkVersion    : ${result.versions.minSdk}`);
  if (result.versions.reactNative) await ctx.log('info', `React Native     : ${result.versions.reactNative}`);
  if (result.versions.expoSdk)   await ctx.log('info', `Expo             : ${result.versions.expoSdk}`);
  if (result.versions.node)      await ctx.log('info', `Node (declared)  : ${result.versions.node}`);

  for (const signal of ctx.frameworkSignals) await ctx.log('debug', `  signal: ${signal}`);

  if (result.ambiguousWith.length > 0) {
    await ctx.log('warn', `Ambiguous detection — also matched: ${result.ambiguousWith.join(', ')}`);
  }
  await ctx.log('info', result.diagnosis);

  // ── Unsupported framework (detected, but no engine yet) ───────────────────
  if (!ENGINE_SUPPORTED[result.framework]) {
    const reason = result.framework === 'UNKNOWN'
      ? 'Could not identify a supported framework (no package.json, no Gradle build file, no pubspec.yaml).'
      : `${result.framework} is detected but not yet supported by a build engine.`;
    await ctx.log('error', reason);
    return { ok: false, fatal: true, error: reason };
  }

  // ── Low-confidence match on a supported framework: warn, do not block ─────
  if (result.confidence < MIN_CONFIDENCE) {
    await ctx.log('warn', `Low detection confidence (${(result.confidence * 100).toFixed(0)}%) for ${result.framework} — attempting build anyway`);
  }

  // ── React Native CLI requires an already-committed android/ project ──────
  if (result.framework === 'REACT_NATIVE_CLI' && !result.buildSystem.androidGenerated) {
    const reason = 'React Native CLI project has no android/ directory — this engine does not run "react-native init" to generate one.';
    await ctx.log('error', reason);
    return { ok: false, fatal: true, error: reason };
  }

  return { ok: true };
}
