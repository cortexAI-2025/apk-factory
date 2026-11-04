// Sandbox security constants — single source of truth for all resource limits

export const SANDBOX = {
  // ── Docker image ──────────────────────────────────────────────────────────
  IMAGE: process.env.BUILDER_IMAGE || 'apk-factory/android-builder:latest',

  // ── Resource limits ───────────────────────────────────────────────────────
  MEMORY_LIMIT: process.env.BUILD_MEMORY || '4g',          // 4 GB RAM hard cap (includes the /tmp tmpfs)
  CPU_LIMIT: process.env.BUILD_CPUS || '2',                // 2 vCPUs
  PIDS_LIMIT: 512,                                          // max processes
  NOFILE_LIMIT: 4096,                                       // max open files
  NPROC_LIMIT: 512,                                         // max user processes

  // ── Timeouts ──────────────────────────────────────────────────────────────
  BUILD_TIMEOUT_MS: parseInt(process.env.BUILD_TIMEOUT_MS || '1500000'),  // 25 min
  CONTAINER_STOP_TIMEOUT_S: 10,

  // ── Filesystem ────────────────────────────────────────────────────────────
  WORKSPACE_DIR: process.env.WORKSPACE_DIR || '/tmp/apk-factory/workspaces',
  MAX_PROJECT_SIZE_BYTES: 500 * 1024 * 1024,   // 500 MB uncompressed
  MAX_EXTRACTED_BYTES:    2 * 1024 * 1024 * 1024, // 2 GB total extracted
  MAX_ZIP_RATIO:          50,                     // anti-bomb: ratio limit
  APK_MAX_SIZE_BYTES:     200 * 1024 * 1024,      // 200 MB per APK
  // Disk quota for a build workspace (bind mount): enforced by a watchdog that kills the container
  MAX_WORKSPACE_BYTES:    parseInt(process.env.BUILD_MAX_WORKSPACE_MB || '4096', 10) * 1024 * 1024,
  MAX_FILE_BYTES:         2 * 1024 * 1024 * 1024, // ulimit -f inside the sandbox

  ANDROID_SDK_HOST: process.env.ANDROID_HOME || '/opt/android-sdk',
  ANDROID_SDK_CTR: '/opt/android-sdk',
  GRADLE_CACHE_HOST: process.env.GRADLE_CACHE_DIR || '/opt/gradle-home',
  GRADLE_CACHE_CTR: '/opt/gradle-home',

  // ── Network ───────────────────────────────────────────────────────────────
  //   restricted : internal Docker network, egress only through an allow-list
  //                proxy (Maven/Gradle/Google hosts). Recommended.
  //   none       : no network at all (needs a pre-seeded Maven cache)
  //   bridge     : unrestricted internet access (development only)
  NETWORK_MODE: (process.env.BUILD_NETWORK_MODE || 'bridge') as 'restricted' | 'none' | 'bridge',
  NETWORK_NAME: process.env.BUILD_NETWORK_NAME || 'apk-build-net',
  PROXY_URL: process.env.BUILD_PROXY_URL || 'http://apk-egress-proxy:3128',

  // V1 scope: debug APKs only. Release/AAB need ENABLE_RELEASE_BUILDS=true.
  ALLOW_RELEASE_BUILDS: process.env.ENABLE_RELEASE_BUILDS === 'true',

  // ── Security flags ────────────────────────────────────────────────────────
  NO_NEW_PRIVILEGES: true,
  READ_ONLY_ROOT: true,
  SECCOMP_PROFILE: process.env.SECCOMP_PROFILE || '/etc/apk-factory/seccomp.json',
} as const;

// Per-stage timeouts (all in ms)
export const STAGE_TIMEOUTS = {
  EXTRACT:  60_000,   // 1 min
  DETECT:   15_000,   // 15 s
  VALIDATE: 15_000,   // 15 s
  SCAN:     30_000,   // 30 s
  BUILD:    SANDBOX.BUILD_TIMEOUT_MS,
  OUTPUT:   30_000,   // 30 s
} as const;
