/**
 * DockerRuntime — standard runc-based containers.
 * Security: process-level isolation (Linux namespaces + cgroups).
 */
import { BaseDockerRuntime } from './base.runtime';
import { RuntimeInfo } from './runtime.interface';

export class DockerRuntime extends BaseDockerRuntime {
  readonly name           = 'docker';
  readonly securityLevel: RuntimeInfo['securityLevel'] = 'process';

  protected runtimeFlags(): string[] {
    return []; // default runtime — no extra flags needed
  }

  protected describe(): string {
    return 'Standard Docker (runc) — Linux namespaces + cgroups + seccomp';
  }
}
