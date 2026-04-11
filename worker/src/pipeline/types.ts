export type PipelineStage =
  | 'EXTRACTING'
  | 'DETECTING'
  | 'VALIDATING'
  | 'SCANNING'
  | 'BUILDING'
  | 'FIXING'
  | 'OUTPUTTING'
  | 'DONE';

export interface PipelineContext {
  // Identifiers
  buildId: string;
  projectId: string;
  userId: string;

  // Input
  sourceZipPath?: string;     // if ZIP upload
  sourceRepoPath?: string;    // if already cloned
  buildType: 'DEBUG' | 'RELEASE' | 'AAB';
  autoFix: boolean;

  // Computed during pipeline
  workspaceDir: string;       // host path of isolated workspace
  projectRoot: string;        // actual root with build.gradle (may differ from workspaceDir)
  gradleCommand: string;

  // Detection results
  projectType?: 'ANDROID_NATIVE' | 'FLUTTER' | 'REACT_NATIVE' | 'UNKNOWN';
  gradleVersion?: string;
  sdkVersion?: number;
  kotlinVersion?: string;
  hasGradleWrapper: boolean;

  // Security scan
  scanClean: boolean;
  scanThreats: string[];

  // Build results
  apkHostPath?: string;
  apkSize?: number;
  autoFixAttempts: number;
  buildOutput: string;
  buildDurationMs?: number;

  // Logging callback
  log: (level: 'info' | 'warn' | 'error' | 'debug', message: string) => Promise<void>;
  reportFix: (attempt: number, description: string, files: string[], summary: string, success: boolean, patches?: any[]) => Promise<void>;
  updateStatus: (status: string, extra?: Record<string, unknown>) => Promise<void>;
  updateProgress: (percent: number, phase: string) => Promise<void>;
}

export interface StageResult {
  ok: boolean;
  error?: string;
  fatal?: boolean;    // if true, skip remaining stages
}
