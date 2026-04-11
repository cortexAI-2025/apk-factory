export interface ContainerRunOptions {
  buildId:       string;
  projectPath:   string;
  gradleCommand: string;
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
