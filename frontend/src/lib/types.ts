export type UserPlan = 'FREE' | 'PRO' | 'ENTERPRISE';
export type ProjectType = 'ANDROID_NATIVE' | 'FLUTTER' | 'REACT_NATIVE' | 'UNKNOWN';
export type ProjectSourceType = 'ZIP_UPLOAD' | 'GITHUB_URL' | 'GITHUB_OAUTH' | 'AI_GENERATED';
export type BuildStatus = 'PENDING' | 'QUEUED' | 'BUILDING' | 'FIXING' | 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'TIMEOUT';
export type BuildType = 'DEBUG' | 'RELEASE' | 'AAB';

export interface User {
  id: string;
  email: string;
  name: string;
  plan: UserPlan;
  buildsUsed: number;
  buildsLimit: number;
  avatarUrl?: string;
  createdAt: string;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  sourceType: ProjectSourceType;
  sourceUrl?: string;
  projectType: ProjectType;
  gradleVersion?: string;
  sdkVersion?: number;
  kotlinVersion?: string;
  compatibilityScore?: number;
  createdAt: string;
  builds?: Build[];
  _count?: { builds: number };
}

export interface Build {
  id: string;
  status: BuildStatus;
  buildType: BuildType;
  startedAt?: string;
  finishedAt?: string;
  duration?: number;
  apkUrl?: string;
  apkSize?: number;
  publicLink?: string;
  qrCodeUrl?: string;
  errorMessage?: string;
  autoFixAttempts: number;
  createdAt: string;
  fixes?: BuildFix[];
  project?: { id: string; name: string };
}

export interface BuildLog {
  id: string;
  level: string;
  message: string;
  timestamp: string;
}

export interface BuildFix {
  id: string;
  attempt: number;
  errorSummary: string;
  fixDescription: string;
  filesModified: string[];
  patches?: FilePatch[];
  success: boolean;
  createdAt: string;
}

export interface FilePatch {
  file: string;
  before: string;
  after: string;
  diff: string;
}

// ── Metrics ──────────────────────────────────────────────────────────────────

export interface BuildStats {
  totalBuilds: number;
  successBuilds: number;
  failedBuilds: number;
  activeBuilds: number;
  successRate: number;
  avgDurationSec: number;
  buildsLastHour: number;
  totalCredits: number;
  mavenCacheHits: number;
  aiFixesApplied: number;
}

export interface LiveBuildItem {
  id: string;
  status: string;
  buildType: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  duration?: number;
  errorMessage?: string;
  costCredits?: number;
  runtime?: string;
  project: { id: string; name: string };
}

export interface ChartPoint {
  date: string;
  total: number;
  success: number;
  failed: number;
}
