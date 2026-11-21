/**
 * Framework Detector
 *
 * Multi-signal, confidence-scored detection of the build framework for a
 * project root. Pure filesystem reads only — no side effects, no network.
 *
 * Design notes:
 *  - Every framework accumulates a weighted score from independent signals
 *    (config files, dependencies, directory structure, version catalogs).
 *  - The winner is the highest score; `ambiguousWith` lists any other
 *    framework that scored within AMBIGUITY_RATIO of the winner, so callers
 *    get an explicit diagnosis instead of a silent guess.
 *  - `confidence` reflects the margin between 1st and 2nd place, not just
 *    the absolute score, so a single weak signal never reads as "certain".
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import { DetectionResult, DetectionSignal, Framework, FrameworkVersions, PackageManager } from './types';

const AMBIGUITY_RATIO = 0.7; // a runner-up within 70% of the winner's score is "ambiguous"

async function readFileIfExists(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, 'utf-8');
  } catch {
    return null;
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function firstExisting(root: string, candidates: string[]): Promise<string | null> {
  for (const c of candidates) {
    if (await exists(path.join(root, c))) return c;
  }
  return null;
}

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  engines?: { node?: string };
  packageManager?: string;
}

export async function detectFramework(root: string): Promise<DetectionResult> {
  const signals: DetectionSignal[] = [];
  const scores = new Map<Framework, number>();
  const add = (framework: Framework, weight: number, source: string) => {
    scores.set(framework, (scores.get(framework) || 0) + weight);
    signals.push({ framework, source, weight });
  };

  // ── Load package.json once (used by several JS-based detectors) ───────────
  let pkg: PackageJson | null = null;
  const pkgRaw = await readFileIfExists(path.join(root, 'package.json'));
  if (pkgRaw) {
    try { pkg = JSON.parse(pkgRaw); } catch { /* malformed package.json: treat as absent */ }
  }
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };

  // ── Flutter ──────────────────────────────────────────────────────────────
  if (await exists(path.join(root, 'pubspec.yaml'))) {
    add('FLUTTER', 10, 'pubspec.yaml present at project root');
  }

  // ── Capacitor ────────────────────────────────────────────────────────────
  const capacitorConfig = await firstExisting(root, ['capacitor.config.ts', 'capacitor.config.js', 'capacitor.config.json']);
  if (capacitorConfig) add('CAPACITOR', 8, `${capacitorConfig} present`);
  if (deps['@capacitor/core']) add('CAPACITOR', 5, `package.json dependency: @capacitor/core@${deps['@capacitor/core']}`);
  if (deps['@capacitor/android']) add('CAPACITOR', 4, `package.json dependency: @capacitor/android@${deps['@capacitor/android']}`);

  // ── Cordova (and Ionic-Cordova) ──────────────────────────────────────────
  const configXml = await readFileIfExists(path.join(root, 'config.xml'));
  if (configXml && /<widget[\s>]/.test(configXml)) add('CORDOVA', 10, 'config.xml is a Cordova widget');
  if (deps['cordova'] || deps['cordova-android']) add('CORDOVA', 6, 'package.json dependency: cordova / cordova-android');
  if (await exists(path.join(root, 'platforms', 'android'))) add('CORDOVA', 3, 'platforms/android present');

  // ── Expo ─────────────────────────────────────────────────────────────────
  let expoAppJsonConfig: any = null;
  const appJsonRaw = await readFileIfExists(path.join(root, 'app.json'));
  if (appJsonRaw) {
    try {
      const parsed = JSON.parse(appJsonRaw);
      if (parsed && typeof parsed === 'object' && parsed.expo) {
        expoAppJsonConfig = parsed.expo;
        add('EXPO_MANAGED', 6, 'app.json has an "expo" key');
      }
    } catch { /* malformed app.json: ignore for this signal */ }
  }
  const appConfigFile = await firstExisting(root, ['app.config.ts', 'app.config.js']);
  if (appConfigFile) add('EXPO_MANAGED', 3, `${appConfigFile} present`);
  if (deps['expo']) add('EXPO_MANAGED', 6, `package.json dependency: expo@${deps['expo']}`);
  if (deps['expo-modules-autolinking']) add('EXPO_MANAGED', 2, 'package.json dependency: expo-modules-autolinking');

  // ── React Native CLI (non-Expo) ─────────────────────────────────────────
  if (deps['react-native']) add('REACT_NATIVE_CLI', 6, `package.json dependency: react-native@${deps['react-native']}`);
  if (await exists(path.join(root, 'react-native.config.js'))) add('REACT_NATIVE_CLI', 3, 'react-native.config.js present');
  if (deps['@react-native/gradle-plugin']) add('REACT_NATIVE_CLI', 2, 'package.json dependency: @react-native/gradle-plugin');

  // ── Next.js ──────────────────────────────────────────────────────────────
  if (deps['next']) add('NEXTJS_WEB', 6, `package.json dependency: next@${deps['next']}`);
  const nextConfigFile = await firstExisting(root, ['next.config.js', 'next.config.mjs', 'next.config.ts']);
  if (nextConfigFile) add('NEXTJS_WEB', 3, `${nextConfigFile} present`);

  // ── Vite ─────────────────────────────────────────────────────────────────
  if (deps['vite']) add('VITE_WEB', 5, `package.json dependency: vite@${deps['vite']}`);
  const viteConfigFile = await firstExisting(root, ['vite.config.ts', 'vite.config.js', 'vite.config.mts', 'vite.config.mjs']);
  if (viteConfigFile) add('VITE_WEB', 4, `${viteConfigFile} present`);

  // ── Android Native ───────────────────────────────────────────────────────
  const androidNative = await detectAndroidNative(root);
  if (androidNative.found) {
    add('ANDROID_NATIVE', 8, androidNative.source);
    if (androidNative.hasWrapper) add('ANDROID_NATIVE', 2, 'gradlew wrapper present');
  }

  // ── Pick the winner ──────────────────────────────────────────────────────
  let framework: Framework = 'UNKNOWN';
  let topScore = 0;
  for (const [f, s] of scores) {
    if (s > topScore) { framework = f; topScore = s; }
  }

  // Disambiguate Expo managed vs bare: the dependency signal always fires as
  // EXPO_MANAGED. Once a real native android/ project exists, that score
  // belongs to EXPO_BARE. Leaving it on EXPO_MANAGED made the winner look
  // tied with itself (confidence 0, "Ambiguous with EXPO_MANAGED").
  const androidAppGradle = await firstExisting(root, [
    path.join('android', 'app', 'build.gradle'),
    path.join('android', 'app', 'build.gradle.kts'),
  ]);
  if (framework === 'EXPO_MANAGED' && androidAppGradle) {
    const managed = scores.get('EXPO_MANAGED') || 0;
    scores.set('EXPO_BARE', (scores.get('EXPO_BARE') || 0) + managed);
    scores.delete('EXPO_MANAGED');
    for (const signal of signals) {
      if (signal.framework === 'EXPO_MANAGED') signal.framework = 'EXPO_BARE';
    }
    framework = 'EXPO_BARE';
    topScore = scores.get('EXPO_BARE') || topScore;
  }

  const ambiguousWith: Framework[] = [];
  for (const [f, s] of scores) {
    if (f === framework) continue;
    if (s >= topScore * AMBIGUITY_RATIO && s > 0) ambiguousWith.push(f);
  }

  const secondScore = Math.max(0, ...[...scores.entries()].filter(([f]) => f !== framework).map(([, s]) => s));
  const confidence = topScore === 0
    ? 0
    : secondScore > 0
      ? Math.max(0, Math.min(1, (topScore - secondScore) / topScore))
      : Math.min(1, topScore / 8);

  const packageManager = await detectPackageManager(root, pkg);
  const versions = await detectVersions(root, pkg, deps, framework);
  if (framework === 'ANDROID_NATIVE') {
    versions.nativeLanguage = await detectNativeLanguage(root);
  }
  const gradleRoot = await resolveGradleRoot(root, framework);
  const buildSystem = {
    hasGradleWrapper: gradleRoot !== null,
    gradleRoot: gradleRoot || undefined,
    androidGenerated: androidAppGradle !== null,
  };

  const diagnosis = buildDiagnosis(framework, confidence, ambiguousWith, signals);

  return { framework, confidence, signals, ambiguousWith, packageManager, versions, buildSystem, diagnosis };
}

// ── Android native structural detection ─────────────────────────────────────

async function detectAndroidNative(root: string): Promise<{ found: boolean; source: string; hasWrapper: boolean }> {
  const candidates = ['app/build.gradle', 'app/build.gradle.kts', 'build.gradle', 'build.gradle.kts'];
  for (const rel of candidates) {
    const content = await readFileIfExists(path.join(root, rel));
    if (!content) continue;
    if (
      content.includes('android {') ||
      content.includes('android{') ||
      content.includes('com.android.application') ||
      content.includes('com.android.library')
    ) {
      const hasWrapper = await exists(path.join(root, 'gradlew'));
      return { found: true, source: `${rel} declares an Android plugin`, hasWrapper };
    }
  }
  // Last resort: a settings.gradle(.kts) that includes modules, with no JS signal at all.
  const settings = await readFileIfExists(path.join(root, 'settings.gradle'))
    || await readFileIfExists(path.join(root, 'settings.gradle.kts'));
  if (settings && (settings.includes('include') || settings.includes('rootProject'))) {
    const hasWrapper = await exists(path.join(root, 'gradlew'));
    return { found: true, source: 'settings.gradle(.kts) declares included modules', hasWrapper };
  }
  return { found: false, source: '', hasWrapper: false };
}

async function detectNativeLanguage(root: string): Promise<'kotlin' | 'java' | 'mixed' | undefined> {
  let kt = 0;
  let java = 0;
  const dirs = [path.join(root, 'app', 'src'), path.join(root, 'src')];
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 6 || kt + java > 500) return;
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name === 'build' || entry.name === 'test' || entry.name === 'androidTest') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full, depth + 1);
      else if (entry.name.endsWith('.kt')) kt++;
      else if (entry.name.endsWith('.java')) java++;
    }
  }
  for (const dir of dirs) await walk(dir, 0);
  if (kt && java) return 'mixed';
  if (kt) return 'kotlin';
  if (java) return 'java';
  return undefined;
}

/** Directory (relative to root) containing gradlew, or null if none is found. */
async function resolveGradleRoot(root: string, framework: Framework): Promise<string | null> {
  if (await exists(path.join(root, 'gradlew'))) return '.';
  if (await exists(path.join(root, 'android', 'gradlew'))) return 'android';
  // Expo managed / not-yet-prebuilt projects have no gradlew until BUILD time — not an error.
  return null;
}

// ── Package manager ──────────────────────────────────────────────────────────

async function detectPackageManager(root: string, pkg: PackageJson | null): Promise<PackageManager> {
  if (await exists(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (await exists(path.join(root, 'yarn.lock'))) return 'yarn';
  if (await exists(path.join(root, 'package-lock.json'))) return 'npm';
  const pmField = pkg?.packageManager; // e.g. "pnpm@9.1.0"
  if (pmField) {
    const name = pmField.split('@')[0];
    if (name === 'pnpm' || name === 'yarn' || name === 'npm') return name;
  }
  return pkg ? 'npm' : null; // a JS project with no lockfile still defaults to npm
}

// ── Version extraction ───────────────────────────────────────────────────────

async function detectVersions(
  root: string,
  pkg: PackageJson | null,
  deps: Record<string, string>,
  framework: Framework,
): Promise<FrameworkVersions> {
  const versions: FrameworkVersions = {};

  // Node version: .nvmrc takes priority over package.json#engines.node
  const nvmrc = await readFileIfExists(path.join(root, '.nvmrc'));
  if (nvmrc) versions.node = nvmrc.trim().replace(/^v/, '');
  else if (pkg?.engines?.node) versions.node = pkg.engines.node;

  if (deps['react-native']) versions.reactNative = deps['react-native'];
  if (deps['expo']) versions.expoSdk = deps['expo'];
  if (deps['next']) versions.next = deps['next'];
  if (deps['vite']) versions.vite = deps['vite'];
  if (deps['@capacitor/core']) versions.capacitorCore = deps['@capacitor/core'];
  if (deps['@capacitor/android']) versions.capacitorAndroid = deps['@capacitor/android'];
  if (deps['cordova-android']) versions.cordovaAndroid = deps['cordova-android'];
  const ionic = deps['@ionic/angular'] || deps['@ionic/react'] || deps['@ionic/vue'] || deps['@ionic/core'];
  if (ionic) versions.ionic = ionic;

  if (framework === 'FLUTTER') {
    const pubspec = await readFileIfExists(path.join(root, 'pubspec.yaml'));
    if (pubspec && /sdk:\s*flutter/.test(pubspec)) versions.flutter = 'sdk';
  }

  if (framework === 'NEXTJS_WEB') {
    versions.nextOutputMode = await detectNextOutputMode(root);
  }

  // Gradle / Kotlin / AGP / SDK versions — look wherever the android project lives.
  const gradleRoot = (await resolveGradleRoot(root, framework)) || (framework === 'ANDROID_NATIVE' ? '.' : null);
  if (gradleRoot !== null) {
    await extractGradleVersions(path.join(root, gradleRoot), versions);
  }

  return versions;
}

async function detectNextOutputMode(root: string): Promise<'export' | 'default' | 'unknown'> {
  for (const f of ['next.config.js', 'next.config.mjs', 'next.config.ts']) {
    const content = await readFileIfExists(path.join(root, f));
    if (!content) continue;
    if (/output\s*:\s*['"]export['"]/.test(content)) return 'export';
    return 'default';
  }
  return 'unknown';
}

async function extractGradleVersions(gradleRoot: string, versions: FrameworkVersions): Promise<void> {
  // 1. Gradle wrapper version
  const wrapperProps = await readFileIfExists(path.join(gradleRoot, 'gradle', 'wrapper', 'gradle-wrapper.properties'));
  if (wrapperProps) {
    const m = wrapperProps.match(/gradle-([\d.]+)-/);
    if (m) versions.gradle = m[1];
  }

  // 2. Version catalog (gradle/libs.versions.toml) — covers projects that
  //    declare Kotlin/AGP as catalog aliases instead of literals in build.gradle.
  const catalog = await readFileIfExists(path.join(gradleRoot, 'gradle', 'libs.versions.toml'));
  if (catalog) {
    const kotlin = catalog.match(/^kotlin\s*=\s*["']([\d.]+)["']/m)?.[1];
    const agp = catalog.match(/^agp\s*=\s*["']([\d.]+)["']/m)?.[1]
      || catalog.match(/^androidGradlePlugin\s*=\s*["']([\d.]+)["']/m)?.[1];
    if (kotlin) versions.kotlin = kotlin;
    if (agp) versions.agp = agp;
  }

  // 3. Literal declarations in build.gradle / build.gradle.kts (root + app module)
  const buildFiles = [
    'build.gradle', 'build.gradle.kts',
    path.join('app', 'build.gradle'), path.join('app', 'build.gradle.kts'),
  ];
  for (const rel of buildFiles) {
    const content = await readFileIfExists(path.join(gradleRoot, rel));
    if (!content) continue;

    if (!versions.kotlin) {
      const kotlin = content.match(/kotlin[_-]version\s*[=:]\s*["']?([\d.]+)/i)?.[1]
        || content.match(/kotlinVersion\s*=\s*["']?([\d.]+)/i)?.[1]
        || content.match(/org\.jetbrains\.kotlin[.\w]*["']?\s*version\s*["']([\d.]+)["']/)?.[1];
      if (kotlin) versions.kotlin = kotlin;
    }
    if (!versions.agp) {
      const agp = content.match(/com\.android\.tools\.build:gradle:([\d.]+)/)?.[1]
        || content.match(/com\.android\.(?:application|library)["']?\s*version\s*["']([\d.]+)["']/)?.[1];
      if (agp) versions.agp = agp;
    }
    if (!versions.compileSdk) {
      const sdk = content.match(/compileSdkVersion\s+(\d+)/)?.[1] || content.match(/compileSdk\s*=?\s*(\d+)/)?.[1];
      if (sdk) versions.compileSdk = parseInt(sdk, 10);
    }
    if (!versions.minSdk) {
      const sdk = content.match(/minSdkVersion\s+(\d+)/)?.[1] || content.match(/minSdk\s*=?\s*(\d+)/)?.[1];
      if (sdk) versions.minSdk = parseInt(sdk, 10);
    }
    if (!versions.buildToolsVersion) {
      const bt = content.match(/buildToolsVersion\s+["']([\d.]+)["']/)?.[1];
      if (bt) versions.buildToolsVersion = bt;
    }
  }
}

// ── Diagnosis text ───────────────────────────────────────────────────────────

/**
 * Bridges the precise `Framework` to the legacy, Prisma-backed `ProjectType`
 * enum (ANDROID_NATIVE | FLUTTER | REACT_NATIVE | UNKNOWN) so existing DB
 * rows, the frontend and `pipeline/types.ts` keep working without a schema
 * migration. The precise framework is preserved separately on the pipeline
 * context (`ctx.framework`) and in the Build's `environment` JSON column.
 */
export function mapFrameworkToProjectType(framework: Framework): 'ANDROID_NATIVE' | 'FLUTTER' | 'REACT_NATIVE' | 'UNKNOWN' {
  switch (framework) {
    case 'ANDROID_NATIVE':
    case 'CAPACITOR':
    case 'CORDOVA': return 'ANDROID_NATIVE';
    case 'FLUTTER': return 'FLUTTER';
    case 'REACT_NATIVE_CLI':
    case 'EXPO_MANAGED':
    case 'EXPO_BARE': return 'REACT_NATIVE';
    default: return 'UNKNOWN';
  }
}

function buildDiagnosis(
  framework: Framework,
  confidence: number,
  ambiguousWith: Framework[],
  signals: DetectionSignal[],
): string {
  if (framework === 'UNKNOWN') {
    return 'No recognizable framework signal found (no package.json, no Gradle build file, no pubspec.yaml).';
  }
  const own = signals.filter((s) => s.framework === framework).map((s) => s.source);
  let text = `Detected ${framework} (confidence ${(confidence * 100).toFixed(0)}%) from: ${own.join('; ')}.`;
  if (ambiguousWith.length > 0) {
    text += ` Ambiguous with: ${ambiguousWith.join(', ')} — verify before relying on an automatic build.`;
  }
  return text;
}
