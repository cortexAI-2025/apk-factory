/**
 * Framework detection types.
 *
 * A Framework is the actual build system APK Factory must drive.
 * `ProjectType` (pipeline/types.ts) is the coarser legacy enum stored in
 * Postgres (ANDROID_NATIVE | FLUTTER | REACT_NATIVE | UNKNOWN) — kept as-is
 * to avoid a schema migration; `mapFrameworkToProjectType()` bridges the two.
 */

export type Framework =
  | 'ANDROID_NATIVE'
  | 'REACT_NATIVE_CLI'
  | 'EXPO_MANAGED'
  | 'EXPO_BARE'
  | 'CAPACITOR'
  | 'VITE_WEB'
  | 'NEXTJS_WEB'
  | 'FLUTTER'
  | 'UNKNOWN';

export type PackageManager = 'npm' | 'yarn' | 'pnpm' | null;

/** One piece of evidence that contributed to a framework's score. */
export interface DetectionSignal {
  framework: Framework;
  source: string; // e.g. "package.json dependency: expo", "capacitor.config.ts present"
  weight: number;
}

export interface FrameworkVersions {
  node?: string;
  packageManagerVersion?: string;
  reactNative?: string;
  expoSdk?: string;
  next?: string;
  nextOutputMode?: 'export' | 'default' | 'unknown';
  vite?: string;
  capacitorCore?: string;
  capacitorAndroid?: string;
  kotlin?: string;
  gradle?: string;
  agp?: string;
  compileSdk?: number;
  minSdk?: number;
  buildToolsVersion?: string;
}

export interface BuildSystemInfo {
  hasGradleWrapper: boolean;
  /** Path to the directory containing gradlew, relative to the detected root ('.' or 'android'). */
  gradleRoot?: string;
  /** True only when android/ already contains a real native project (Expo Bare, RN CLI, or post-prebuild). */
  androidGenerated: boolean;
}

export interface DetectionResult {
  framework: Framework;
  confidence: number; // 0..1
  signals: DetectionSignal[];
  /** Other frameworks whose score came within AMBIGUITY_MARGIN of the winner. */
  ambiguousWith: Framework[];
  packageManager: PackageManager;
  versions: FrameworkVersions;
  buildSystem: BuildSystemInfo;
  /** Human-readable diagnosis — always populated, especially for low-confidence/ambiguous/unsupported cases. */
  diagnosis: string;
}
