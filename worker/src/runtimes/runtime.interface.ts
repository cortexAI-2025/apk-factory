export interface ContainerRunOptions {
  buildId:       string;
  projectPath:   string;
  /**
   * The in-container command. For Android Native (shell=false, the default)
   * this is a bare Gradle invocation ("./gradlew assembleDebug") that the
   * runtime splits and runs directly, appending --no-daemon/--stacktrace.
   * For multi-step engines (React Native CLI, Expo — shell=true) this is a
   * full bash script (install deps, prebuild, cd android, run gradlew) run
   * via `bash -lc`, since those steps precede Gradle and gradlew may not
   * exist at the workspace root yet.
   */
  gradleCommand: string;
  shell?:        boolean;
  extraVolumes?: string[];   // additional "--volume host:ctr:ro" entries
  extraEnv?:     string[];   // additional "--env KEY=VALUE" entries
  onLog:         (line: string, stream: 'stdout' | 'stderr') => void;
  onProgress?:   (percent: number, phase: string) => void;
  timeoutMs?:    number;
}

export interface ContainerRunResult {
  exitCode:    number;
  success:     boolean;
  output:      string;
  durationMs:  number;
  runtime:     string;
  containerId?: string;
  /** Set when the worker itself stopped the container (never inferred from the exit code). */
  stoppedBy?: 'timeout' | 'disk';
}

export interface RuntimeInfo {
  name:        string;    // 'docker' | 'gvisor' | 'firecracker'
  available:   boolean;
  version?:    string;
  securityLevel: 'process' | 'gvisor' | 'vm';
  description: string;
}

export interface IRuntime {
  readonly name: string;
  readonly securityLevel: RuntimeInfo['securityLevel'];

  /** Check if this runtime is available on the current host. */
  isAvailable(): Promise<boolean>;

  /** Return runtime metadata. */
  info(): Promise<RuntimeInfo>;

  /** Run a build container and stream logs. */
  run(opts: ContainerRunOptions): Promise<ContainerRunResult>;

  /** Force-stop a running build by buildId. */
  stop(buildId: string): Promise<void>;
}
